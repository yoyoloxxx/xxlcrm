// Стор живой части сайта. Архитектура «не переделывать»:
// — все изменения данных идут ТОЛЬКО через экшены A.* (на шаге Supabase они станут писать в общую базу);
// — персист изолирован в адаптере `persistence` (localStorage сейчас → Supabase позже);
// — id полей и стадий стабильные строковые — переезд в Postgres сохранит данные как есть.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Field, Rec, Task, Activity, Chat, ChatExt, Channel, ReplyTemplate, Integrations, User, EntityCfg, Stage, Rule, Route, InboundSource } from "./model";
import { uid, now, plural, displayValue, defaultIntegrations, channelName, defaultStages, defaultRules, defaultRoutes, sourceName, OWNER_ROUND, PALETTE } from "./model";
import { ENTITIES, USERS, seed, DEFAULT_TEMPLATES } from "./data";
import { markSetup } from "./setup";
import { parseRuDate as parseRu } from "./rudate";
import { parseNumCell } from "./csv";
import { resolvePreset, buildPresetData, saveCustomPreset, deleteCustomPreset } from "./presets";

interface DataState { entities: EntityCfg[]; automations: Rule[]; routes: Route[]; records: Rec[]; tasks: Task[]; activities: Activity[]; chats: Chat[]; replyTemplates: ReplyTemplate[]; integrations: Integrations }
interface State extends DataState {
  currentUserId: string;
  drawerRecordId: string | null;
  activeChatId: string | null;
  users: User[];                   // команда: в демо — статичная, в облаке — участники пространства
  mode: "local" | "cloud";         // local = демо в localStorage, cloud = общая база Supabase
  wsId: string | null;
  wsName: string;
  inviteCode: string;
  authStage: "auth" | "ws" | null; // оверлей входа/регистрации и создания/вступления в пространство
  pendingDraft: { chatId: string; text: string } | null; // заготовка ответа, ждущая открытия Входящих
  nav: { page: string; tick: number } | null; // просьба сменить экран (из карточки → Входящие)
}

// ---------- адаптер персистентности (при Supabase заменяется целиком этот объект) ----------
const LS_KEY = "xxlcrm-site-v1";
const persistence = {
  load(): DataState | null {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      // Проверяем ФОРМУ, а не только наличие: подпорченный ключ раньше ронял модуль
      // до первого рендера — экран оставался белым, и починить его из интерфейса было нечем.
      const arr = (v: unknown) => (Array.isArray(v) ? v : null);
      if (!arr(d?.records) || !arr(d?.entities)) {
        try {
          window.localStorage.setItem(LS_KEY + "-broken", raw.slice(0, 2_000_000));
          window.localStorage.removeItem(LS_KEY);
        } catch { /* места нет — просто стартуем заново */ }
        queueMicrotask(() => toast.error("Сохранённая база оказалась повреждена", {
          duration: 30000,
          description: "Начал с чистого листа. Испорченная копия отложена — напишите, если нужно её разобрать.",
        }));
        return null;
      }
      for (const k of ["tasks", "activities", "chats", "automations", "routes", "replyTemplates"]) {
        if (d[k] !== undefined && !Array.isArray(d[k])) d[k] = undefined;
      }
      const ints = { ...defaultIntegrations(), ...(d.integrations ?? {}) } as Integrations;
      // после перезагрузки поднимаем сохранённые подключения обратно в ok
      ints.tg.status = ints.tg.token ? "ok" : "off";
      ints.wa.status = ints.wa.idInstance && ints.wa.apiToken ? "ok" : "off";
      ints.max.status = ints.max.token ? "ok" : "off";
      ints.tilda.status = ints.tilda.hookId ? "ok" : "off";
      // личный Telegram: сессия есть → подключимся в фоне при старте
      ints.tgUser.status = ints.tgUser.session ? "connecting" : "off";
      ints.tgUser.stage = undefined; ints.tgUser.error = undefined;
      return {
        entities: Array.isArray(d.entities) && d.entities.length ? d.entities : clone(ENTITIES), // миграция v2→v3
        automations: Array.isArray(d.automations) ? d.automations : defaultRules(),
        // маршруты приёма появились в v0.10: старый общий тумблер «автолид» становится полем auto у всех маршрутов
        routes: Array.isArray(d.routes) && d.routes.length ? d.routes : defaultRoutes().map(r => ({ ...r, auto: ints.autoLead })),
        records: d.records, tasks: d.tasks ?? [], activities: d.activities ?? [],
        chats: d.chats ?? [], // миграция со старой версии: инбокс начнётся пустым
        replyTemplates: Array.isArray(d.replyTemplates) && d.replyTemplates.length ? d.replyTemplates : DEFAULT_TEMPLATES,
        integrations: ints,
      };
    } catch { return null; }
  },
  save(s: DataState) {
    let blob: string;
    try {
      // сериализация тоже может сорваться — и это ровно та же тихая потеря, что и переполнение
      blob = JSON.stringify({
        v: 3, entities: s.entities, automations: s.automations, routes: s.routes, records: s.records, tasks: s.tasks, activities: s.activities,
        chats: s.chats, replyTemplates: s.replyTemplates, integrations: s.integrations,
      });
    } catch (e) {
      if (!storageBroken) {
        storageBroken = true; emit();
        queueMicrotask(() => toast.error("Не удалось подготовить базу к сохранению", { duration: 30000, description: String(e).slice(0, 120) }));
      }
      return;
    }
    try {
      window.localStorage.setItem(LS_KEY, blob);
      if (storageBroken) { storageBroken = false; storageBytes = blob.length; emit(); }
      else storageBytes = blob.length;
    } catch {
      // Раньше здесь стоял пустой catch — и человек, загрузив 10 000 клиентов, видел зелёный
      // «Загружено», работал полдня, а после F5 не находил ничего. Молчать тут нельзя.
      storageBytes = blob.length;
      if (!storageBroken) {
        storageBroken = true;
        emit();
        queueMicrotask(() => toast.error("Браузер отказался сохранять базу — она слишком большая", {
          duration: 30000,
          description: "Всё, что вы делаете сейчас, живёт только до закрытия вкладки. Выгрузите разделы в CSV и переходите в облако.",
        }));
      }
    }
  },
  reset() { try { window.localStorage.removeItem(LS_KEY); } catch { /* ignore */ } },
};

// ---------- две вкладки ----------
// Обе вкладки писали в один ключ целым блобом: та, что сохранила последней, стирала работу
// другой без единого слова. Договариваемся по хранилищу: первая вкладка — ведущая, вторая
// честно предупреждает и не пишет, пока человек сам не решит перехватить.
const TAB_KEY = "xxl-tab-owner";
const TAB_ID = Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
let tabFollower = false;
const tabAlive = (v: string | null) => {
  if (!v) return false;
  const [, ts] = v.split("|");
  return Date.now() - Number(ts || 0) < 9000;          // ведущая вкладка отмечается раз в 4 секунды
};
export const tabState = () => ({ follower: tabFollower, id: TAB_ID });
export function tabTakeOver() {
  try { window.localStorage.setItem(TAB_KEY, `${TAB_ID}|${Date.now()}`); } catch { /* ignore */ }
  tabFollower = false;
  emit();
  location.reload();                                    // перечитываем то, что успела записать соседка
}
function tabBeat() {
  let cur: string | null = null;
  try { cur = window.localStorage.getItem(TAB_KEY); } catch { return; }
  const mine = cur?.startsWith(TAB_ID + "|");
  if (mine || !tabAlive(cur)) {
    try { window.localStorage.setItem(TAB_KEY, `${TAB_ID}|${Date.now()}`); } catch { /* ignore */ }
    if (tabFollower) { tabFollower = false; emit(); }
    return;
  }
  if (!tabFollower) { tabFollower = true; emit(); }
}
if (typeof window !== "undefined") {
  // Первую проверку откладываем на такт: emit объявлен ниже по файлу, и вызов на этапе
  // инициализации модуля ронял всё приложение в белый экран у ВТОРОЙ вкладки.
  window.setTimeout(tabBeat, 0);
  window.setInterval(tabBeat, 4000);
  window.addEventListener("pagehide", () => {
    try { if (window.localStorage.getItem(TAB_KEY)?.startsWith(TAB_ID + "|")) window.localStorage.removeItem(TAB_KEY); } catch { /* ignore */ }
  });
}

// Состояние хранилища браузера: если запись не прошла, приложение обязано сказать это вслух
let storageBroken = false;
let storageBytes = 0;
export const storageState = () => ({ broken: storageBroken, bytes: storageBytes });
/** Влезет ли ещё столько символов. Нужен ДО импорта, чтобы не создавать записи, которые не переживут F5. */
export function storageFits(extraChars: number): boolean {
  if (storageBroken) return false;
  const LIMIT = 4_300_000; // ~5 МБ квоты на origin минус чужие ключи и запас
  let used = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)!;
      used += k.length + (window.localStorage.getItem(k)?.length ?? 0);
    }
  } catch { return true; }
  return used + extraChars < LIMIT;
}

// миграция: раздать ручные позиции записям, у которых их ещё нет (сохраняя видимый порядок)
function ensurePos(records: Rec[]) {
  const groups = new Map<string, Rec[]>();
  for (const r of records) {
    const k = r.entityId + "|" + (r.stageId ?? "");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  for (const g of groups.values()) {
    if (g.every(r => typeof r.pos === "number")) continue;
    g.sort((a, b) => (b.stageAt ?? b.createdAt) - (a.stageAt ?? a.createdAt));
    g.forEach((r, i) => { r.pos = (i + 1) * 1000; });
  }
}

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const INT_KEY = "xxlcrm-ints-v1"; // интеграции живут на устройстве отдельно: данные в облаке общие, каналы личные
function normalizeInts(raw: unknown): Integrations {
  const ints = { ...defaultIntegrations(), ...((raw as Integrations) ?? {}) } as Integrations;
  ints.tg.status = ints.tg.token ? "ok" : "off";
  ints.wa.status = ints.wa.idInstance && ints.wa.apiToken ? "ok" : "off";
  ints.max.status = ints.max.token ? "ok" : "off";
  ints.tilda.status = ints.tilda.hookId ? "ok" : "off";
  ints.tgUser.status = ints.tgUser.session ? "connecting" : "off";
  ints.tgUser.stage = undefined; ints.tgUser.error = undefined;
  return ints;
}
// «День рождения» у Контактов появился в v0.8 — дораздаём конфигам, где его ещё нет
export function ensureBdayField(entities: EntityCfg[]) {
  const c = entities.find(e => e.id === "contacts");
  if (c && !c.fields.some(f => f.type === "date" && /рожде|birth/i.test(f.label))) {
    c.fields.push({ id: "bday", label: "День рождения", type: "date", inTable: false });
  }
}
const initial: DataState = persistence.load() ?? { entities: clone(ENTITIES), automations: defaultRules(), routes: defaultRoutes(), ...seed(), replyTemplates: DEFAULT_TEMPLATES, integrations: defaultIntegrations() };
ensureBdayField(initial.entities);
try { const rawInts = window.localStorage.getItem(INT_KEY); if (rawInts) initial.integrations = normalizeInts(JSON.parse(rawInts)); } catch { /* берём integrations из основного пейлоада */ }
ensurePos(initial.records);
const st: State = {
  ...initial, currentUserId: "u1", drawerRecordId: null, activeChatId: null,
  users: USERS, mode: "local", wsId: null, wsName: "Digital Loft", inviteCode: "", authStage: null, pendingDraft: null, nav: null,
};

let version = 0;
const listeners = new Set<() => void>();
let saveTimer: number | undefined;
// Ключи каналов и сессия личного Telegram — тоже данные: их молчаливая потеря значит,
// что после перезагрузки бот «отключился» без объяснений.
const saveInts = () => {
  try { window.localStorage.setItem(INT_KEY, JSON.stringify(st.integrations)); }
  catch {
    if (!storageBroken) {
      storageBroken = true; emit();
      queueMicrotask(() => toast.error("Настройки каналов не сохранились — в браузере нет места", { duration: 20000 }));
    }
  }
};
// маршрут сохранения: демо — блоб в localStorage; облако — диф в Supabase (cloudHooks.save назначает cloud.ts)
export const cloudHooks: { save?: () => void } = {};
// события для движка автоматизаций (устанавливает automations.ts)
export const ruleHooks: { created?: (recId: string) => void; stage?: (recId: string, stageId: string) => void } = {};
const dispatchSave = () => {
  // Ведомая вкладка не сохраняет: иначе она затрёт базу целиком тем, что видит у себя
  if (tabFollower && st.mode === "local") return;
  saveInts();
  if (st.mode === "local") persistence.save(st);
  else cloudHooks.save?.();
};
const emit = () => {
  version++;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(dispatchSave, 300);
  listeners.forEach(l => l());
};
// Закрытие/перезагрузка вкладки не должны терять последние 300 мс изменений — сбрасываем отложенное сохранение сразу
window.addEventListener("pagehide", () => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; dispatchSave(); }
});
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useApp(): State { useSyncExternalStore(subscribe, () => version); return st; }
export const getState = () => st;
function mut(fn: (s: State) => void) { fn(st); emit(); }

// ---------- undo (отмена ОДНОГО действия, а не всей работы) ----------
// Раньше здесь лежали полные снимки состояния, и Ctrl+Z откатывал базу целиком: вместе с
// удалённой записью исчезала заявка, пришедшая минуту назад, а в общем пространстве — работа
// коллег. Теперь запоминаем РАЗНИЦУ: что действие добавило, что убрало, что изменило, — и
// отменяем только это. Всё, что случилось параллельно, остаётся на месте.
type Coll = "entities" | "records" | "tasks" | "activities" | "automations" | "routes" | "chats" | "replyTemplates";
const COLLS: Coll[] = ["entities", "records", "tasks", "activities", "automations", "routes", "chats", "replyTemplates"];
type Shot = Record<Coll, Map<string, string>>;                     // id → JSON
type Delta = { added: string[]; removed: [number, string][]; changed: [string, string][] };
type Step = { label: string; delta: Partial<Record<Coll, Delta>> };

const idOf = (x: unknown) => String((x as { id?: string })?.id ?? "");
function shot(): Shot {
  const out = {} as Shot;
  for (const c of COLLS) {
    const m = new Map<string, string>();
    for (const it of (st[c] as unknown[]) ?? []) m.set(idOf(it), JSON.stringify(it));
    out[c] = m;
  }
  return out;
}
function deltaOf(before: Shot): Partial<Record<Coll, Delta>> {
  const out: Partial<Record<Coll, Delta>> = {};
  for (const c of COLLS) {
    const b = before[c];
    const list = (st[c] as unknown[]) ?? [];
    const now = new Map<string, string>();
    list.forEach(it => now.set(idOf(it), JSON.stringify(it)));
    const added: string[] = [];
    const changed: [string, string][] = [];
    for (const [id, json] of now) {
      const was = b.get(id);
      if (was === undefined) added.push(id);
      else if (was !== json) changed.push([id, was]);
    }
    const removed: [number, string][] = [];
    let i = 0;
    for (const [id, json] of b) { if (!now.has(id)) removed.push([i, json]); i++; }
    if (added.length || changed.length || removed.length) out[c] = { added, removed, changed };
  }
  return out;
}

const history: Step[] = [];
let openShot: Shot | null = null;
let openLabel = "";
/** Открыть шаг отмены. Вложенные вызовы присоединяются к уже открытому. */
function pushHistory(label = "") {
  if (openShot) { if (label && !openLabel) openLabel = label; return; }
  openShot = shot();
  openLabel = label;
  // Закрываем в конце такта: правила ставят задачи через queueMicrotask, и они должны
  // попасть в тот же шаг — иначе отмена создания записи оставит её задачу сиротой.
  window.setTimeout(closeStep, 0);
}
function closeStep() {
  const before = openShot;
  openShot = null;
  if (!before) return;
  const delta = deltaOf(before);
  // Действие, которое ничего не изменило, не должно съедать шаг истории
  if (!Object.keys(delta).length) return;
  history.push({ label: openLabel, delta });
  if (history.length > 60) history.shift();
}
export const undoDepth = () => history.length + (openShot ? 1 : 0);
export const undoLabel = () => history[history.length - 1]?.label ?? "";

export function undo(): boolean {
  closeStep();                                   // если жмут Ctrl+Z в том же такте
  const step = history.pop();
  if (!step) { toast("Отменять нечего", { description: "С открытия вкладки отменять пока нечего" }); return false; }
  mut(s => {
    for (const c of COLLS) {
      const d = step.delta[c];
      if (!d) continue;
      const arr = s[c] as unknown[];
      if (d.added.length) {
        const kill = new Set(d.added);
        for (let i = arr.length - 1; i >= 0; i--) if (kill.has(idOf(arr[i]))) arr.splice(i, 1);
      }
      for (const [id, json] of d.changed) {
        const i = arr.findIndex(x => idOf(x) === id);
        if (i >= 0) arr[i] = JSON.parse(json);
        else arr.push(JSON.parse(json));          // изменённое успели удалить — возвращаем
      }
      for (const [pos, json] of d.removed) arr.splice(Math.min(pos, arr.length), 0, JSON.parse(json));
    }
    if (s.drawerRecordId && !s.records.some(r => r.id === s.drawerRecordId)) s.drawerRecordId = null;
    if (s.activeChatId && !s.chats.some(c => c.id === s.activeChatId)) s.activeChatId = null;
  });
  toast(step.label ? `Отменено: ${step.label}` : "Действие отменено");
  return true;
}

// ---------- селекторы ----------
export const entityCfg = (id: string): EntityCfg => st.entities.find(e => e.id === id) ?? st.entities[0];
export const allEntities = () => st.entities;
export const recById = (id?: string | null) => st.records.find(r => r.id === id);
export const recordsOf = (entityId: string) => st.records.filter(r => r.entityId === entityId);
export const userName = (id?: string) => st.users.find(u => u.id === id)?.name ?? "";
export const userById = (id?: string) => st.users.find(u => u.id === id);
export const allUsers = () => st.users;
export const openTasksFor = (recordId: string) => st.tasks.filter(t => t.recordId === recordId && !t.done);
// Ключ склейки по телефону. Один порог на весь продукт: раньше импорт склеивал людей по
// трёхзначному «101», пустой телефон совпадал с пустым, и заявка приклеивалась к случайному
// чужому клиенту, затирая ему данные. Меньше семи цифр — не телефон, склеивать нельзя.
export function phoneKey(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 7) return null;
  return d.length >= 10 ? d.slice(-10) : d;   // длинные — по последним 10 (без кода страны)
}
const phoneDigits = (v: unknown) => phoneKey(v) ?? "\u0000нет";   // заведомо не совпадёт ни с чем
// Один человек = одна карточка. Ищем в справочниках (разделы без воронки): сделка — не человек,
// и «узнавать» клиента по телефону, записанному в сделке, нельзя.
export function findRecordByPhone(phoneRaw?: string, preferEntity = "contacts"): Rec | undefined {
  const d = phoneKey(phoneRaw);
  if (!d) return undefined;
  const match = (r: Rec) => {
    const e = st.entities.find(x => x.id === r.entityId);
    return !!e?.fields.some(f => f.type === "phone" && phoneKey(r.values[f.id]) === d);
  };
  const isBook = (r: Rec) => !st.entities.find(x => x.id === r.entityId)?.stages?.length;
  return st.records.find(r => r.entityId === preferEntity && match(r))
    ?? st.records.find(r => isBook(r) && match(r));
}
// всё связанное с записью: записи, ссылающиеся на неё связью, и её диалоги
export function relatedOf(recId: string): { records: Rec[]; chats: Chat[] } {
  const records = st.records.filter(r => {
    if (r.id === recId) return false;
    const e = st.entities.find(x => x.id === r.entityId);
    return !!e?.fields.some(f => f.type === "relation" && r.values[f.id] === recId);
  });
  const rec = recById(recId);
  const phoneOf = () => {
    const e = rec && st.entities.find(x => x.id === rec.entityId);
    const pf = e?.fields.find(f => f.type === "phone");
    return pf && rec ? phoneDigits(rec.values[pf.id]) : "";
  };
  const d = phoneOf();
  const ids = new Set([recId, ...records.map(r => r.id)]);
  const chats = st.chats.filter(c => (c.recordId && ids.has(c.recordId)) || (!!phoneKey(d) && phoneKey(c.phone) === phoneKey(d)));
  return { records, chats };
}

// ---------- маршруты приёма: «откуда пришло → куда упало» ----------
// Раздел-воронка и раздел-справочник вычисляются из текущей структуры, поэтому маршрут не ломается,
// когда разделы переименованы, пересобраны пресетом или созданы с нуля в конструкторе.
export const pipelineEntity = (): EntityCfg | undefined =>
  st.entities.find(e => e.id === "deals" && e.stages?.length) ?? st.entities.find(e => e.stages?.length);
export const clientEntity = (): EntityCfg | undefined =>
  st.entities.find(e => e.id === "contacts") ?? st.entities.find(e => !e.stages?.length && e.fields.some(f => f.type === "phone"));
export const routeOf = (source: InboundSource): Route =>
  st.routes.find(r => r.source === source) ?? { source, auto: true, entityId: pipelineEntity()?.id ?? "", createClient: true };
export interface ResolvedRoute { route: Route; entity?: EntityCfg; stage?: Stage; ownerId?: string }
export function resolveRoute(source: InboundSource): ResolvedRoute {
  const route = routeOf(source);
  const entity = st.entities.find(e => e.id === route.entityId) ?? pipelineEntity() ?? st.entities[0];
  const stage = entity?.stages?.find(x => x.id === route.stageId) ?? entity?.stages?.[0];
  return { route, entity, stage, ownerId: pickRouteOwner(route, entity?.id) };
}
// «по очереди» = тому, у кого сейчас меньше активных записей в этом разделе: детерминированно, без счётчика в базе
function pickRouteOwner(route: Route, entityId?: string): string | undefined {
  if (!route.ownerId) return undefined;                                   // «кто принял» — останется текущий пользователь
  if (route.ownerId !== OWNER_ROUND) return st.users.some(u => u.id === route.ownerId) ? route.ownerId : undefined;
  const load = (userId: string) => st.records.filter(r => r.entityId === entityId && r.ownerId === userId
    && (entityCfg(r.entityId).stages?.find(x => x.id === r.stageId)?.kind ?? "open") === "open").length;
  return [...st.users].sort((a, b) => load(a.id) - load(b.id) || a.id.localeCompare(b.id))[0]?.id;
}
// короткая подпись «куда упадёт» — для настроек, Входящих и подсказок на кнопках
export function routeSummary(source: InboundSource): string {
  const { entity, stage, route } = resolveRoute(source);
  if (!route.auto) return "только диалог, заявку создаёте вы";
  if (!entity) return "раздел не выбран";
  return `${entity.name} · ${stage?.label ?? "без стадии"}`;
}

// Обязательные поля, которые не заполнены. Не запрещаем сохранять — CRM должна принимать
// заявку с одним телефоном; но перед «выиграно» и в карточке честно показываем, чего не хватает.
export const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (typeof v === "number" && isNaN(v)) || (typeof v === "string" && !v.trim());
export function missingRequired(recId: string): Field[] {
  const r = recById(recId);
  if (!r) return [];
  return entityCfg(r.entityId).fields.filter(f => f.required && isBlank(r.values[f.id]));
}

export function recTitle(id?: string): string {
  const r = recById(id ?? undefined); if (!r) return "";
  const e = entityCfg(r.entityId);
  const t = String(r.values[e.titleFieldId] ?? "").trim();
  if (t) return t;
  const rel = e.fields.find(f => f.type === "relation" && r.values[f.id]);
  if (rel) { const inner = recTitle(r.values[rel.id] as string); if (inner) return inner; }
  return `${e.name} №${r.num}`;
}
export const dispCtx = () => ({ recTitle, userName });

// ---------- целостность структуры ----------
// Разделы и стадии живут в конструкторе, а ссылаются на них маршруты приёма и правила автоматизаций.
// Удалили стадию — маршрут не должен молча слать заявки «в никуда», а правило молча не срабатывать.
export function ruleIssue(r: Rule): string | null {
  const t = r.trigger;
  const e = st.entities.find(x => x.id === t.entityId);
  if (!e) return "раздел удалён";
  if (t.type === "stage_enter" && !t.stageId.startsWith("kind:") && !e.stages?.some(x => x.id === t.stageId)) return "стадия удалена";
  if ((t.type === "stage_enter" || t.type === "stage_stuck") && !e.stages?.length) return "в разделе выключена воронка";
  return null;
}
function repairStructure(s: State): string[] {
  const notes: string[] = [];
  const fallback = s.entities.find(e => e.id === "deals" && e.stages?.length) ?? s.entities.find(e => e.stages?.length) ?? s.entities[0];
  for (const r of s.routes) {
    const e = s.entities.find(x => x.id === r.entityId);
    if (!e) {
      if (!fallback) continue;
      r.entityId = fallback.id; r.stageId = undefined;
      notes.push(`${sourceName(r.source)} → «${fallback.namePlural}»`);
    } else if (r.stageId && !e.stages?.some(x => x.id === r.stageId)) {
      r.stageId = undefined;
      notes.push(`${sourceName(r.source)} → первая стадия «${e.namePlural}»`);
    }
    if (r.ownerId && r.ownerId !== OWNER_ROUND && !s.users.some(u => u.id === r.ownerId)) r.ownerId = undefined;
  }
  // Записи, оставшиеся на удалённой стадии, исчезали с канбана — были в базе, но не на глазах.
  // Возвращаем их на первую рабочую стадию раздела и говорим об этом вслух.
  let lost = 0;
  for (const r of s.records) {
    const e = s.entities.find(x => x.id === r.entityId);
    if (!e?.stages?.length) continue;
    if (r.stageId && e.stages.some(x => x.id === r.stageId)) continue;
    r.stageId = (e.stages.find(x => x.kind === "open") ?? e.stages[0]).id;
    r.stageAt = now();
    lost++;
  }
  if (lost) notes.push(`${lost} ${plural(lost, "запись вернулась", "записи вернулись", "записей вернулись")} на первую стадию`);
  let off = 0;
  for (const rule of s.automations) if (rule.enabled && ruleIssue(rule)) { rule.enabled = false; off++; }
  if (off) notes.push(`${off} ${plural(off, "правило выключено", "правила выключены", "правил выключено")} — ссылались на удалённое`);
  return notes;
}
function repairAndTell(s: State) {
  const notes = repairStructure(s);
  if (notes.length) queueMicrotask(() => toast("Настройки подстроены под новую структуру", { description: notes.join(" · ") }));
}

// Диалог не резиновый: чужой человек может слать сообщения бесконечно, а место в браузере
// общее — забив его, он заодно останавливает сохранение всей работы владельца.
const CHAT_MAX = 500;
function trimChat(c: Chat) { if (c.msgs.length > CHAT_MAX) c.msgs.splice(0, c.msgs.length - CHAT_MAX); }

const ACT_MAX = 240;                                  // в хронику — суть, а не мегабайт текста
function pushAct(recordId: string, kind: Activity["kind"], text: string, userId?: string, editKey?: string) {
  const t = text.length > ACT_MAX ? text.slice(0, ACT_MAX) + "…" : text;
  st.activities.push({ id: uid("a"), recordId, ts: now(), kind, text: t, userId, editKey });
}

// Невидимые управляющие символы направления письма: ими можно показать в списке «50 000»,
// а сохранить «000 05». В карточке клиента им делать нечего — вырезаем на входе.
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g;
const VALUE_MAX = 20000;                              // одно поле — не файловое хранилище
export function cleanText(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const c = v.replace(BIDI, "");
  return c.length > VALUE_MAX ? c.slice(0, VALUE_MAX) : c;
}

// ---------- экшены ----------
export const A = {
  openRecord(id: string | null) {
    const prev = st.drawerRecordId;
    mut(s => { s.drawerRecordId = id; });
    // закрыли только что созданную и совсем пустую карточку — не оставляем «Сделку №9» без единого поля
    if (prev && prev !== id) {
      const r = recById(prev);
      const fresh = r && now() - r.createdAt < 10 * 60 * 1000;
      const empty = r && Object.values(r.values).every(v => v === undefined || v === null || v === "");
      // задачи, которые поставило правило автоматики, не считаются «человек с карточкой работал»
      const untouched = r && !st.tasks.some(t => t.recordId === r.id && !t.id.startsWith("t_rule_"))
        // след человека — это комментарий, правка поля или смена стадии; «создана» и авто-задача не в счёт
        && !st.activities.some(a => a.recordId === r.id && (a.kind === "comment" || a.kind === "field" || a.kind === "stage"))
        && !st.chats.some(c => c.recordId === r.id);
      if (r && fresh && empty && untouched) {
        mut(s => {
          s.records = s.records.filter(x => x.id !== r.id);
          s.activities = s.activities.filter(a => a.recordId !== r.id);
          s.tasks = s.tasks.filter(t => t.recordId !== r.id);   // и задачу-автомат за компанию
        });
        toast("Пустая карточка не сохранена", { description: `${entityCfg(r.entityId).name} без названия — убрал, чтобы не мусорить в воронке` });
      }
    }
  },
  setUser(id: string) { mut(s => { s.currentUserId = id; }); },

  setValue(recId: string, f: Field, value: unknown) {
    value = cleanText(value);
    mut(s => {
      const r = recById(recId)!; const old = r.values[f.id];
      r.values[f.id] = value; r.updatedAt = now();
      if (JSON.stringify(old ?? "") !== JSON.stringify(value ?? "")) {
        const dv = displayValue(f, value, dispCtx());
        const text = `${f.label}: ${dv === "" ? "очищено" : dv}`;
        const editKey = `field:${f.id}`;
        // коалесинг: набор текста по буквам — одна запись в хронике, а не строка на каждое нажатие.
        // если последнее событие — правка того же поля этой же записи тем же пользователем за последние 3 мин, обновляем его на месте
        const last = s.activities[s.activities.length - 1];
        if (last && last.kind === "field" && last.recordId === recId && last.editKey === editKey
            && last.userId === s.currentUserId && now() - last.ts < 180000) {
          last.text = text.length > ACT_MAX ? text.slice(0, ACT_MAX) + "…" : text; last.ts = now();
        } else {
          pushAct(recId, "field", text, s.currentUserId, editKey);
        }
      }
    });
  },
  setOwner(recId: string, userId: string) {
    mut(s => {
      const r = recById(recId)!; if (r.ownerId === userId) return;
      r.ownerId = userId; r.updatedAt = now();
      pushAct(recId, "field", `Ответственный: ${userName(userId)}`, s.currentUserId);
    });
  },
  moveStage(recId: string, stageId: string) {
    const r = recById(recId);
    if (!r || r.stageId === stageId) return;
    A.moveStageAt(recId, stageId, null);
  },
  // Точное перемещение: карточка встаёт ПЕРЕД beforeId (null = в конец колонки)
  moveStageAt(recId: string, stageId: string, beforeId: string | null) {
    pushHistory("перенос по стадиям");
    mut(s => {
      const r = recById(recId)!;
      const stage = entityCfg(r.entityId).stages?.find(x => x.id === stageId); if (!stage) return;
      const col = s.records
        .filter(x => x.entityId === r.entityId && x.stageId === stageId && x.id !== recId)
        .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
      let pos: number;
      if (beforeId) {
        const idx = col.findIndex(x => x.id === beforeId);
        if (idx === -1) pos = (col[col.length - 1]?.pos ?? 0) + 1000;
        else if (idx === 0) pos = (col[0].pos ?? 1000) - 1000;
        else pos = ((col[idx - 1].pos ?? 0) + (col[idx].pos ?? 0)) / 2;
      } else {
        pos = (col[col.length - 1]?.pos ?? 0) + 1000;
      }
      const changedStage = r.stageId !== stageId;
      r.stageId = stageId; r.pos = pos; r.updatedAt = now();
      if (changedStage) {
        r.stageAt = now();
        pushAct(recId, "stage", `Стадия: ${stage.label}`, s.currentUserId);
        queueMicrotask(() => ruleHooks.stage?.(recId, stageId)); // после коммита мутации
        if (stage.kind === "won") {
          const gaps = missingRequired(recId);
          if (gaps.length) queueMicrotask(() => toast.warning("Сделка закрыта, но не заполнено обязательное", {
            description: gaps.map(f => f.label).join(", ") + " — откройте карточку и добавьте",
          }));
        }
      }
    });
  },
  createRecord(entityId: string, values: Record<string, unknown> = {}, stageId?: string, ownerId?: string): string {
    let id = "";
    mut(s => {
      const e = entityCfg(entityId);
      const stgId = stageId ?? e.stages?.[0]?.id;
      const col = s.records.filter(x => x.entityId === entityId && x.stageId === stgId);
      const r: Rec = {
        id: uid("r"), entityId, num: s.records.filter(x => x.entityId === entityId).length + 1,
        values, ownerId: ownerId ?? s.currentUserId, createdAt: now(), updatedAt: now(),
        stageId: stgId, stageAt: now(),
        pos: Math.max(0, ...col.map(x => x.pos ?? 0)) + 1000, // новые — в конец колонки
      };
      s.records.push(r); id = r.id;
      pushAct(id, "created", "Запись создана", s.currentUserId);
    });
    ruleHooks.created?.(id);
    return id;
  },
  // Импорт таблицы: одна мутация на весь файл (а не 500 сохранений), автоматизации НЕ дёргаем —
  // иначе загрузка старой базы породила бы сотни задач «связаться». Ctrl+Z отменяет импорт целиком.
  importRecords(
    entityId: string,
    mapping: (string | null)[],
    rows: string[][],
    opts: { mergeByPhone?: boolean; stageId?: string; ownerId?: string } = {}
  ): { created: number; merged: number } {
    let created = 0, merged = 0;
    pushHistory("загрузку из файла");
    mut(s => {
      const e = s.entities.find(x => x.id === entityId)!;
      const fieldOf = (id: string) => e.fields.find(f => f.id === id);
      const phoneF = e.fields.find(f => f.type === "phone");
      let num = s.records.filter(x => x.entityId === entityId).length;
      // Указатели «телефон → запись» и «название → запись» строим ОДИН раз.
      // Раньше на каждую строку файла шёл поиск по всему массиву: 12 000 строк — это
      // 72 миллиона сравнений и 40 секунд намертво замёрзшего окна.
      const byPhone = new Map<string, Rec>();
      if (phoneF) for (const r of s.records) {
        if (r.entityId !== entityId) continue;
        const d = phoneKey(r.values[phoneF.id]);
        if (d && !byPhone.has(d)) byPhone.set(d, r);
      }
      const byTitle = new Map<string, Rec>();
      const titleKey = (entId: string, v: unknown) => entId + "\u0000" + String(v ?? "").toLowerCase();
      for (const r of s.records) {
        const ent = s.entities.find(x => x.id === r.entityId);
        if (!ent) continue;
        const k = titleKey(r.entityId, r.values[ent.titleFieldId]);
        if (!byTitle.has(k)) byTitle.set(k, r);
      }
      for (const row of rows) {
        const values: Record<string, unknown> = {};
        let stageId = opts.stageId ?? e.stages?.[0]?.id;
        mapping.forEach((target, i) => {
          const raw = (row[i] ?? "").trim();
          if (!target || !raw) return;
          if (target === "__stage") {
            const st2 = e.stages?.find(x => x.label.toLowerCase() === raw.toLowerCase());
            if (st2) stageId = st2.id;
            return;
          }
          const f = fieldOf(target); if (!f) return;
          switch (f.type) {
            case "money": case "number": {
              const n = parseNumCell(raw);
              if (n !== null) values[f.id] = n;
              break;
            }
            case "date": case "datetime": {
              const ts = parseRuDate(raw); if (ts) values[f.id] = ts;
              break;
            }
            case "select": {
              if (!f.options) f.options = [];
              let o = f.options.find(x => x.label.toLowerCase() === raw.toLowerCase());
              if (!o) { o = { id: uid("o"), label: raw, color: PALETTE[f.options.length % PALETTE.length] }; f.options.push(o); }
              values[f.id] = o.id;
              break;
            }
            case "user": {
              const u = s.users.find(x => x.name.toLowerCase().includes(raw.toLowerCase()));
              if (u) values[f.id] = u.id;
              break;
            }
            case "relation": {
              const target2 = s.entities.find(x => x.id === f.relationTo);
              if (!target2) break;
              const found = byTitle.get(titleKey(target2.id, raw));
              if (found) { values[f.id] = found.id; break; }
              // связанного клиента нет — заводим на лету, чтобы связь не потерялась
              const nr: Rec = {
                id: uid("r"), entityId: target2.id, num: s.records.filter(x => x.entityId === target2.id).length + 1,
                values: { [target2.titleFieldId]: raw }, ownerId: opts.ownerId ?? s.currentUserId,
                createdAt: now(), updatedAt: now(), stageId: target2.stages?.[0]?.id, stageAt: now(), pos: 1000,
              };
              s.records.push(nr);
              byTitle.set(titleKey(target2.id, raw), nr);
              values[f.id] = nr.id;
              break;
            }
            default: values[f.id] = cleanText(raw);
          }
        });
        if (!Object.keys(values).length) continue;
        // дедуп: тот же телефон — дополняем существующую запись, а не плодим вторую
        const rowKey = phoneF ? phoneKey(values[phoneF.id]) : null;
        const dup = opts.mergeByPhone && rowKey ? byPhone.get(rowKey) : undefined;
        if (dup) {
          for (const [k, v] of Object.entries(values)) if (dup.values[k] === undefined || dup.values[k] === "") dup.values[k] = v;
          dup.updatedAt = now();
          merged++;
          continue;
        }
        const r: Rec = {
          id: uid("r"), entityId, num: ++num, values,
          ownerId: opts.ownerId ?? s.currentUserId, createdAt: now(), updatedAt: now(),
          stageId, stageAt: now(), pos: (num + 1) * 1000,
        };
        s.records.push(r);
        // указатель пополняем сразу: иначе два одинаковых телефона ВНУТРИ одного файла
        // не склеивались — «объединять по телефону» работало только со старой базой
        if (rowKey && !byPhone.has(rowKey)) byPhone.set(rowKey, r);
        s.activities.push({ id: uid("a"), recordId: r.id, ts: now(), kind: "created", text: "Загружено из файла", userId: s.currentUserId });
        created++;
      }
    });
    if (created || merged) markSetup("imported");
    return { created, merged };
  },
  // ---------- массовые действия: одна мутация и одна отмена на всю пачку ----------
  bulkStage(ids: string[], stageId: string) {
    pushHistory("смену стадии у нескольких");
    mut(s => {
      let pos = Math.max(0, ...s.records.filter(r => r.stageId === stageId).map(r => r.pos ?? 0));
      for (const id of ids) {
        const r = s.records.find(x => x.id === id); if (!r) continue;
        const stage = entityCfg(r.entityId).stages?.find(x => x.id === stageId); if (!stage) continue;
        if (r.stageId !== stageId) {
          r.stageId = stageId; r.stageAt = now(); r.pos = (pos += 1000); r.updatedAt = now();
          pushAct(r.id, "stage", `Стадия: ${stage.label}`, s.currentUserId);
          const rid = r.id;
          queueMicrotask(() => ruleHooks.stage?.(rid, stageId));
        }
      }
    });
    toast(`Стадия изменена: ${ids.length} ${plural(ids.length, "запись", "записи", "записей")}`, { description: "Ctrl+Z вернёт" });
  },
  bulkOwner(ids: string[], userId: string) {
    pushHistory("смену ответственного");
    mut(s => {
      for (const id of ids) {
        const r = s.records.find(x => x.id === id); if (!r || r.ownerId === userId) continue;
        r.ownerId = userId; r.updatedAt = now();
        pushAct(r.id, "field", `Ответственный: ${userName(userId)}`, s.currentUserId);
      }
    });
    toast(`Ответственный назначен: ${userName(userId)}`, { description: "Ctrl+Z вернёт" });
  },
  bulkTask(ids: string[], title: string, kind: Task["kind"], dueOffsetH: number) {
    pushHistory("постановку задач");
    mut(s => {
      for (const id of ids) {
        const r = s.records.find(x => x.id === id); if (!r) continue;
        s.tasks.push({ id: uid("t"), title, kind, recordId: id, ownerId: r.ownerId, due: now() + dueOffsetH * 3600000, done: false });
        pushAct(id, "task", `Задача: ${title}`, s.currentUserId);
      }
    });
    toast(`Задача поставлена по ${ids.length} ${plural(ids.length, "записи", "записям", "записям")}`);
  },
  bulkDelete(ids: string[]) {
    pushHistory("удаление нескольких записей");
    const set = new Set(ids);
    mut(s => {
      s.records = s.records.filter(r => !set.has(r.id));
      s.tasks = s.tasks.filter(t => !t.recordId || !set.has(t.recordId));
      s.activities = s.activities.filter(a => !set.has(a.recordId));
      s.chats.forEach(c => { if (c.recordId && set.has(c.recordId)) c.recordId = undefined; });
      if (s.drawerRecordId && set.has(s.drawerRecordId)) s.drawerRecordId = null;
    });
    toast(`Удалено: ${ids.length} ${plural(ids.length, "запись", "записи", "записей")}`, { description: "Ctrl+Z вернёт" });
  },
  // слить дубли: всё из второй карточки переезжает в первую, вторая удаляется
  mergeRecords(keepId: string, dropId: string) {
    if (keepId === dropId) return;
    pushHistory("объединение карточек");
    mut(s => {
      const keep = s.records.find(r => r.id === keepId), drop = s.records.find(r => r.id === dropId);
      if (!keep || !drop) return;
      for (const [k, v] of Object.entries(drop.values)) if (keep.values[k] === undefined || keep.values[k] === "") keep.values[k] = v;
      keep.updatedAt = now();
      s.tasks.forEach(t => { if (t.recordId === dropId) t.recordId = keepId; });
      s.activities.forEach(a => { if (a.recordId === dropId) a.recordId = keepId; });
      s.chats.forEach(c => { if (c.recordId === dropId) c.recordId = keepId; });
      s.records.forEach(r => {                       // ссылки-связи других записей переводим на выжившую
        const e = s.entities.find(x => x.id === r.entityId);
        e?.fields.forEach(f => { if (f.type === "relation" && r.values[f.id] === dropId) r.values[f.id] = keepId; });
      });
      s.records = s.records.filter(r => r.id !== dropId);
      if (s.drawerRecordId === dropId) s.drawerRecordId = keepId;
      pushAct(keepId, "comment", "Объединено с дублем", s.currentUserId);
    });
    toast.success("Карточки объединены", { description: "Ctrl+Z вернёт" });
  },
  deleteRecord(recId: string) {
    pushHistory("удаление записи");
    mut(s => {
      s.records = s.records.filter(r => r.id !== recId);
      s.tasks = s.tasks.filter(t => t.recordId !== recId);
      // диалог не должен ссылаться на удалённую запись: иначе следующее сообщение клиента
      // будет считаться продолжением несуществующей заявки и новая не создастся
      s.chats.forEach(c => { if (c.recordId === recId) c.recordId = undefined; });
      s.activities = s.activities.filter(a => a.recordId !== recId);
      if (s.drawerRecordId === recId) s.drawerRecordId = null;
    });
    toast("Запись удалена — Ctrl+Z, чтобы вернуть");
  },
  addComment(recId: string, text: string) { mut(s => pushAct(recId, "comment", text, s.currentUserId)); },
  addTask(recId: string | undefined, title: string, kind: Task["kind"], dueOffsetH: number) {
    mut(s => {
      const r = recId ? recById(recId) : undefined;
      s.tasks.push({ id: uid("t"), title, kind, recordId: recId, ownerId: r?.ownerId ?? s.currentUserId, due: now() + dueOffsetH * 3600000, done: false });
      if (recId) pushAct(recId, "task", `Задача: ${title}`, s.currentUserId);
    });
  },
  taskAddAt(id: string | null, title: string, kind: Task["kind"], dueTs: number, recId?: string): boolean {
    if (id && st.tasks.some(t => t.id === id)) return false; // напоминание уже есть (в т.ч. выполненное)
    mut(s => {
      const r = recId ? s.records.find(x => x.id === recId) : undefined;
      s.tasks.push({ id: id ?? uid("t"), title, kind, recordId: recId, ownerId: r?.ownerId ?? s.currentUserId, due: dueTs, done: false });
      if (recId) pushAct(recId, "task", `Задача: ${title}`, s.currentUserId);
    });
    return true;
  },
  taskDelete(taskId: string) {
    pushHistory("удаление задачи");
    mut(s => { s.tasks = s.tasks.filter(t => t.id !== taskId); });
  },
  openChatWithDraft(chatId: string, text: string) {
    mut(s => {
      s.activeChatId = chatId;
      s.pendingDraft = { chatId, text };
      const c = s.chats.find(x => x.id === chatId); if (c) c.unread = 0;
    });
  },
  consumeDraft() { mut(s => { s.pendingDraft = null; }); },
  toggleTask(taskId: string) {
    mut(s => {
      const t = s.tasks.find(x => x.id === taskId)!;
      t.done = !t.done; t.doneAt = t.done ? now() : undefined;
      if (t.done && t.recordId) pushAct(t.recordId, "task", `Задача выполнена: ${t.title}`, s.currentUserId);
    });
  },
  // «Очистить примеры» — это про ПРИМЕРЫ. Раньше кнопка сносила всё: настоящую базу,
  // диалоги и подключённые каналы, и заново подсовывала демо. Теперь уносит только помеченное.
  resetDemo() {
    if (st.mode !== "local") { toast("В облачном пространстве демо-сброс недоступен"); return; }
    const demoRecs = st.records.filter(r => r.demo);
    const demoChats = st.chats.filter(c => c.demo);
    const demoTasks = st.tasks.filter(t => t.demo);
    if (!demoRecs.length && !demoChats.length && !demoTasks.length) {
      toast("Примеров уже нет", { description: "Всё, что здесь есть, — ваше" });
      return;
    }
    pushHistory("очистку примеров");
    mut(s => {
      const kill = new Set(demoRecs.map(r => r.id));
      s.records = s.records.filter(r => !r.demo);
      s.chats = s.chats.filter(c => !c.demo);
      s.tasks = s.tasks.filter(t => !t.demo && !(t.recordId && kill.has(t.recordId)));
      s.activities = s.activities.filter(a => !kill.has(a.recordId));
      if (s.drawerRecordId && kill.has(s.drawerRecordId)) s.drawerRecordId = null;
      if (s.activeChatId && !s.chats.some(c => c.id === s.activeChatId)) s.activeChatId = null;
    });
    toast(`Примеры убраны: ${demoRecs.length} ${plural(demoRecs.length, "запись", "записи", "записей")}`, {
      description: "Ваши записи, диалоги и подключения на месте. Ctrl+Z вернёт примеры",
    });
  },

  // ---------- инбокс ----------
  openChat(id: string | null) {
    mut(s => {
      s.activeChatId = id;
      if (id) { const c = s.chats.find(x => x.id === id); if (c) c.unread = 0; }
    });
  },
  chatSend(chatId: string, text: string) {
    text = String(cleanText(text) ?? "");
    mut(s => {
      const c = s.chats.find(x => x.id === chatId)!;
      c.msgs.push({ id: uid("m"), ts: now(), out: true, text });
      trimChat(c);
      if (c.recordId && recById(c.recordId)) pushAct(c.recordId, "comment", `→ ${channelName(c.channel)}: ${text}`, s.currentUserId);
    });
  },
  chatIncoming(chatId: string, text: string) {
    mut(s => {
      const c = s.chats.find(x => x.id === chatId); if (!c) return;
      c.msgs.push({ id: uid("m"), ts: now(), out: false, text });
      trimChat(c);
      if (s.activeChatId !== c.id) c.unread++;
      if (c.recordId && recById(c.recordId)) pushAct(c.recordId, "comment", `${channelName(c.channel)}, клиент: ${text}`);
    });
    toast("Новое сообщение", { description: text.slice(0, 64) });
  },
  chatIncomingExt(ext: ChatExt, name: string, channel: Channel, text: string, phone?: string): string {
    name = niceContactName(name, channel, phone);
    let id = "";
    mut(s => {
      const c: Chat = { id: uid("c"), name, phone, channel, unread: 1, msgs: [{ id: uid("m"), ts: now(), out: false, text }], ext };
      const known = findRecordByPhone(phone); // дедуп: этот человек уже есть в базе?
      if (known) c.recordId = known.id;
      s.chats.unshift(c); id = c.id;
    });
    const linked = st.chats.find(x => x.id === id)?.recordId;
    toast(`Новый диалог: ${name}`, { description: linked ? `Узнали клиента: ${recTitle(linked)}` : text.slice(0, 64) });
    return id;
  },
  // исходящее, отправленное С ТЕЛЕФОНА (личный аккаунт): показываем в ленте, не трогая счётчики
  chatEcho(ext: ChatExt, name: string, text: string, ts?: number, phone?: string) {
    mut(s => {
      let c = s.chats.find(x => x.ext && chatExtMatch(x.ext, ext));
      if (!c) { c = { id: uid("c"), name: niceContactName(name, "tg", phone), phone, channel: "tg", unread: 0, msgs: [], ext }; s.chats.unshift(c); }
      c.msgs.push({ id: uid("m"), ts: ts ?? now(), out: true, text });
      trimChat(c);
      if (c.recordId && recById(c.recordId)) pushAct(c.recordId, "comment", `→ ${channelName(c.channel)} (с телефона): ${text}`, s.currentUserId);
    });
  },
  // синхронизация диалога личного Telegram при подключении/переподключении: догружаем только новое, без тостов
  tguSyncDialog(tguId: string, name: string, phone: string | undefined, msgs: { ts: number; out: boolean; text: string }[], unread: number) {
    mut(s => {
      let c = s.chats.find(x => x.ext?.tgu === tguId);
      const isNew = !c;
      if (!c) {
        c = { id: uid("c"), name: niceContactName(name, "tg", phone), phone, channel: "tg", unread: 0, msgs: [], ext: { tgu: tguId } };
        s.chats.unshift(c);
      }
      c.name = niceContactName(name, "tg", phone); if (phone) c.phone = phone;
      const lastTs = c.msgs.length ? c.msgs[c.msgs.length - 1].ts : 0;
      let added = 0;
      for (const m of msgs) if (m.ts > lastTs) { c.msgs.push({ id: uid("m"), ts: m.ts, out: m.out, text: m.text }); if (!m.out) added++; }
      trimChat(c);
      // непрочитанные не раздуваем при периодической ресинхронизации: при создании берём счётчик Telegram, дальше растим только на реально добавленные входящие
      if (isNew) c.unread = s.activeChatId === c.id ? 0 : unread;
      else if (added && s.activeChatId !== c.id) c.unread += added;
    });
  },
  // Создать заявку из диалога ПО МАРШРУТУ канала: раздел, стадия, ответственный и карточка клиента —
  // всё из настройки «Куда падают заявки», а не из зашитого «deals».
  chatCreateLead(chatId: string): string | null {
    const c = st.chats.find(x => x.id === chatId);
    if (!c) return null;
    const { entity: e, stage, ownerId, route } = resolveRoute(c.channel);
    if (!e) { toast.error("Некуда положить заявку", { description: "Создайте раздел с воронкой или настройте маршрут" }); return null; }
    // дедуп: известный клиент? (диалог уже привязан к карточке-человеку или совпал телефон)
    const linkedRec = c.recordId ? recById(c.recordId) : undefined;
    let person = (linkedRec && !entityCfg(linkedRec.entityId).stages?.length ? linkedRec : undefined) ?? findRecordByPhone(c.phone);
    // маршрут просит завести карточку клиента — заводим до сделки, чтобы сразу связать
    const cl = clientEntity();
    if (!person && route.createClient && cl && cl.id !== e.id) {
      const cv: Record<string, unknown> = { [cl.titleFieldId]: niceContactName(c.name, c.channel, c.phone) };
      const pf = cl.fields.find(f => f.type === "phone"); if (pf && c.phone) cv[pf.id] = c.phone;
      const sOpt = sourceOption(cl, c.channel); if (sOpt) cv[sOpt.fieldId] = sOpt.optionId;
      person = recById(A.createRecord(cl.id, cv, undefined, ownerId));
      if (person) mut(s => { const cc = s.chats.find(x => x.id === chatId)!; cc.recordId = cc.recordId ?? person!.id; });
    }
    const contactF = e.fields.find(f => f.type === "relation" && person && f.relationTo === person.entityId);
    if (person) {
      const openDeal = st.records.find(r =>
        r.entityId === e.id &&
        e.fields.some(f => f.type === "relation" && r.values[f.id] === person!.id) &&
        e.stages?.find(x => x.id === r.stageId)?.kind === "open");
      if (openDeal) {
        mut(s => {
          const cc = s.chats.find(x => x.id === chatId)!;
          cc.recordId = openDeal.id;
          pushAct(openDeal.id, "comment", `Клиент снова написал в ${channelName(c.channel)} — диалог привязан к текущей сделке`);
        });
        toast.success("Узнали клиента — подтянута его текущая сделка", { description: recTitle(openDeal.id) });
        return openDeal.id;
      }
    }
    const values: Record<string, unknown> = { [e.titleFieldId]: person ? recTitle(person.id) : niceContactName(c.name, c.channel, c.phone) };
    if (person && contactF) values[contactF.id] = person.id;
    const sOpt = sourceOption(e, c.channel); if (sOpt) values[sOpt.fieldId] = sOpt.optionId;
    const id = A.createRecord(e.id, values, stage?.id, ownerId);
    mut(s => {
      const cc = s.chats.find(x => x.id === chatId)!;
      cc.recordId = id;
      pushAct(id, "comment", `Создано из диалога в ${channelName(c.channel)}${c.phone ? ` · ${c.phone}` : ""}${person ? ` · клиент: ${recTitle(person.id)}` : ""}`);
    });
    toast.success(`${e.name} → ${stage?.label ?? e.namePlural}`, {
      description: person ? `Клиент: ${recTitle(person.id)}${ownerId ? " · " + userName(ownerId) : ""}` : `Из ${channelName(c.channel)}${ownerId ? " · " + userName(ownerId) : ""}`,
    });
    return id;
  },

  // ---------- интеграции и шаблоны ----------
  intPatch(fn: (i: Integrations) => void) { mut(s => fn(s.integrations)); },
  // маршрут приёма: «заявки из этого канала падают туда-то»
  routeUpdate(source: InboundSource, patch: Partial<Route>) {
    mut(s => {
      const i = s.routes.findIndex(r => r.source === source);
      if (i === -1) s.routes.push({ ...routeOf(source), ...patch, source });
      else s.routes[i] = { ...s.routes[i], ...patch, source };
    });
  },
  tplAdd(name: string, text: string) { mut(s => s.replyTemplates.push({ id: uid("tpl"), name, text })); },
  tplUpdate(id: string, patch: Partial<ReplyTemplate>) { mut(s => Object.assign(s.replyTemplates.find(t => t.id === id)!, patch)); },
  tplDelete(id: string) { pushHistory("удаление шаблона"); mut(s => { s.replyTemplates = s.replyTemplates.filter(t => t.id !== id); }); toast("Шаблон удалён — Ctrl+Z вернёт"); },
  // ---------- автоматизации ----------
  ruleAdd(rule: Omit<Rule, "id" | "fired">): string {
    const id = uid("rule");
    mut(s => s.automations.push({ ...rule, id, fired: 0 }));
    return id;
  },
  ruleUpdate(id: string, patch: Partial<Rule>) {
    mut(s => { const r = s.automations.find(x => x.id === id); if (r) Object.assign(r, patch); });
  },
  ruleToggle(id: string) { mut(s => { const r = s.automations.find(x => x.id === id); if (r) r.enabled = !r.enabled; }); },
  ruleDelete(id: string) { pushHistory("удаление правила"); mut(s => { s.automations = s.automations.filter(x => x.id !== id); }); toast("Правило удалено — Ctrl+Z вернёт"); },
  ruleFired(id: string) { mut(s => { const r = s.automations.find(x => x.id === id); if (r) r.fired++; }); },
  goto(page: string) { mut(s => { s.nav = { page, tick: (s.nav?.tick ?? 0) + 1 }; }); },

  // ---------- конструктор разделов ----------
  entAdd(name: string, withPipeline: boolean): string {
    const id = uid("e");
    const titleId = uid("f");
    const ent: EntityCfg = {
      id, name: name.trim() || "Запись", namePlural: name.trim() || "Раздел", icon: "folder", titleFieldId: titleId,
      fields: [
        { id: titleId, label: "Название", type: "text", inTable: true, required: true },
        { id: uid("f"), label: "Ответственный", type: "user", inTable: true },
        { id: uid("f"), label: "Заметки", type: "textarea", inTable: false },
      ],
      stages: withPipeline ? defaultStages() : undefined,
    };
    mut(s => s.entities.push(ent));
    markSetup("structure");
    toast.success(`Раздел «${ent.namePlural}» создан`, { description: "Настройте поля и стадии под себя" });
    return id;
  },
  entPatch(id: string, patch: Partial<Pick<EntityCfg, "name" | "namePlural" | "icon">>) {
    if (patch.name || patch.namePlural) pushHistory("переименование раздела");
    mut(s => { const e = s.entities.find(x => x.id === id); if (e) Object.assign(e, patch); });
  },
  // применить пресет ниши: разделы + воронка + автоматизации + демо-данные одним нажатием.
  // Заменяет структуру и записи целиком (в облаке дифф-сейв удалит старые и запишет новые). Обратимо через undo.
  applyPreset(presetId: string): boolean {
    const p = resolvePreset(presetId);
    if (!p) return false;
    const data = buildPresetData(p);
    pushHistory("применение шаблона ниши");
    mut(s => {
      s.entities = data.entities;
      s.automations = data.automations;
      s.records = data.records;
      s.activities = data.activities;
      s.tasks = data.tasks;
      s.chats = data.chats;
      s.drawerRecordId = null;
      s.activeChatId = null;
      repairStructure(s); // маршруты приёма переезжают на разделы нового шаблона
    });
    markSetup("structure");
    const desc = p.custom ? "Разделы и автоматизации применены — можно отменить (Ctrl+Z)" : "Разделы, воронка, автоматизации и примеры настроены — можно отменить (Ctrl+Z)";
    toast.success(`Шаблон «${p.label}» применён`, { description: desc });
    return true;
  },
  // сохранить текущую структуру (разделы + автоматизации) как свой шаблон — переиспользовать/поделиться устройством
  savePresetFromCurrent(name: string): string {
    const p = saveCustomPreset(name, st.entities, st.automations);
    emit(); // чтобы список «Мои шаблоны» перечитался
    toast.success(`Шаблон «${p.label}» сохранён`, { description: "Появился в «Шаблон ниши» → Мои шаблоны" });
    return p.id;
  },
  removeCustomPreset(id: string) { deleteCustomPreset(id); emit(); toast("Шаблон удалён"); },
  entToggleStages(id: string, on: boolean) {
    mut(s => {
      const e = s.entities.find(x => x.id === id); if (!e) return;
      if (on && !e.stages?.length) {
        e.stages = defaultStages();
        const first = e.stages[0].id;
        s.records.forEach((r, i) => { if (r.entityId === id) { r.stageId = first; r.stageAt = now(); r.pos = (i + 1) * 1000; } });
      } else if (!on) {
        e.stages = undefined;
        s.records.forEach(r => { if (r.entityId === id) r.stageId = undefined; });
      }
      repairAndTell(s);
    });
  },
  entDelete(id: string): boolean {
    const used = st.entities.find(e => e.id !== id && e.fields.some(f => f.type === "relation" && f.relationTo === id));
    if (used) { toast.error(`Сначала удалите поле-связь в разделе «${used.namePlural}»`); return false; }
    if (st.entities.length <= 1) { toast.error("Нельзя удалить последний раздел"); return false; }
    pushHistory("удаление раздела");
    mut(s => {
      const ids = new Set(s.records.filter(r => r.entityId === id).map(r => r.id));
      s.records = s.records.filter(r => r.entityId !== id);
      s.tasks = s.tasks.filter(t => !t.recordId || !ids.has(t.recordId));
      s.activities = s.activities.filter(a => !ids.has(a.recordId));
      s.chats.forEach(c => { if (c.recordId && ids.has(c.recordId)) c.recordId = undefined; });
      if (s.drawerRecordId && ids.has(s.drawerRecordId)) s.drawerRecordId = null;
      s.entities = s.entities.filter(e => e.id !== id);
      repairAndTell(s);
    });
    toast("Раздел удалён вместе с записями", { description: "Ctrl+Z вернёт" });
    return true;
  },
  fieldAdd(entityId: string, f: Omit<Field, "id">): string {
    pushHistory("добавление поля");
    const id = uid("f");
    mut(s => { s.entities.find(e => e.id === entityId)?.fields.push({ ...f, id }); });
    return id;
  },
  fieldUpdate(entityId: string, fieldId: string, patch: Partial<Field>) {
    if (patch.type) pushHistory("смену типа поля");          // смена типа может обесценить значения — даём откат
    mut(s => { const f = s.entities.find(e => e.id === entityId)?.fields.find(x => x.id === fieldId); if (f) Object.assign(f, patch); });
  },
  // сколько записей потеряют значение, если удалить поле — спрашиваем ДО удаления в интерфейсе
  fieldUsage(entityId: string, fieldId: string): number {
    return st.records.filter(r => r.entityId === entityId && r.values[fieldId] !== undefined && r.values[fieldId] !== "").length;
  },
  fieldDelete(entityId: string, fieldId: string) {
    const e = st.entities.find(x => x.id === entityId);
    if (!e || e.titleFieldId === fieldId) { toast.error("Поле-заголовок удалить нельзя"); return; }
    const label = e.fields.find(f => f.id === fieldId)?.label ?? "поле";
    const used = A.fieldUsage(entityId, fieldId);
    pushHistory("удаление поля");
    mut(s => { const en = s.entities.find(x => x.id === entityId)!; en.fields = en.fields.filter(f => f.id !== fieldId); });
    toast(`Поле «${label}» удалено`, { description: used ? `Значения у ${used} ${plural(used, "записи", "записей", "записей")} потеряны — Ctrl+Z вернёт` : "Ctrl+Z вернёт" });
  },
  fieldMove(entityId: string, fieldId: string, dir: -1 | 1) {
    pushHistory("перестановку полей");
    mut(s => {
      const e = s.entities.find(x => x.id === entityId); if (!e) return;
      const i = e.fields.findIndex(f => f.id === fieldId); const j = i + dir;
      if (i < 0 || j < 0 || j >= e.fields.length) return;
      [e.fields[i], e.fields[j]] = [e.fields[j], e.fields[i]];
    });
  },
  stageAdd(entityId: string, label: string) {
    pushHistory("добавление стадии");
    mut(s => {
      const e = s.entities.find(x => x.id === entityId); if (!e) return;
      if (!e.stages) e.stages = [];
      const stage: Stage = { id: uid("s"), label: label.trim() || "Стадия", color: PALETTE[e.stages.length % PALETTE.length], kind: "open" };
      // рабочая стадия должна встать перед финальными: иначе она оказывается за «Успех» и «Отказ»
      const firstFinal = e.stages.findIndex(x => x.kind !== "open");
      if (firstFinal === -1) e.stages.push(stage); else e.stages.splice(firstFinal, 0, stage);
    });
  },
  stageUpdate(entityId: string, stageId: string, patch: Partial<Stage>) {
    mut(s => { const stg = s.entities.find(x => x.id === entityId)?.stages?.find(x => x.id === stageId); if (stg) Object.assign(stg, patch); });
  },
  stageCount(entityId: string, stageId: string): number {
    return st.records.filter(r => r.entityId === entityId && r.stageId === stageId).length;
  },
  stageDelete(entityId: string, stageId: string) {
    const e = st.entities.find(x => x.id === entityId);
    if (!e?.stages || e.stages.length <= 1) { toast.error("Должна остаться хотя бы одна стадия"); return; }
    const label = e.stages.find(x => x.id === stageId)?.label ?? "стадия";
    let moved = 0;
    pushHistory("удаление стадии");
    mut(s => {
      const en = s.entities.find(x => x.id === entityId)!;
      en.stages = en.stages!.filter(x => x.id !== stageId);
      const first = en.stages[0];
      s.records.forEach(r => {
        if (r.entityId === entityId && r.stageId === stageId) {
          r.stageId = first.id; r.stageAt = now(); moved++;
          pushAct(r.id, "stage", `Стадия: ${first.label} (стадия «${label}» удалена)`, s.currentUserId);
        }
      });
      repairAndTell(s); // маршруты и правила, смотревшие на эту стадию, чиним сразу
    });
    toast(`Стадия «${label}» удалена`, {
      description: moved ? `${moved} ${plural(moved, "запись перенесена", "записи перенесены", "записей перенесено")} в первую стадию — Ctrl+Z вернёт` : "Ctrl+Z вернёт",
    });
  },
  // Перетаскивание: стадия/поле встаёт НА место с индексом to (один шаг истории, а не пять)
  stageMoveTo(entityId: string, stageId: string, to: number) {
    pushHistory("перестановку стадий");
    mut(s => {
      const e = s.entities.find(x => x.id === entityId); if (!e?.stages) return;
      const from = e.stages.findIndex(x => x.id === stageId);
      if (from < 0 || to < 0 || to >= e.stages.length || from === to) return;
      const [x] = e.stages.splice(from, 1);
      e.stages.splice(to, 0, x);
    });
  },
  fieldMoveTo(entityId: string, fieldId: string, to: number) {
    pushHistory("перестановку полей");
    mut(s => {
      const e = s.entities.find(x => x.id === entityId); if (!e) return;
      const from = e.fields.findIndex(f => f.id === fieldId);
      if (from < 0 || to < 0 || to >= e.fields.length || from === to) return;
      const [x] = e.fields.splice(from, 1);
      e.fields.splice(to, 0, x);
    });
  },
  stageMove(entityId: string, stageId: string, dir: -1 | 1) {
    pushHistory("перестановку стадий");
    mut(s => {
      const e = s.entities.find(x => x.id === entityId); if (!e?.stages) return;
      const i = e.stages.findIndex(x => x.id === stageId); const j = i + dir;
      if (i < 0 || j < 0 || j >= e.stages.length) return;
      [e.stages[i], e.stages[j]] = [e.stages[j], e.stages[i]];
    });
  },
  tildaLead(fields: Record<string, string>) {
    // Форму заполняет посторонний человек: чистим невидимые символы и режем полотна
    fields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(cleanText(v) ?? "")]));
    const low = (k: string) => k.toLowerCase();
    const findVal = (keys: string[]) => Object.entries(fields).find(([k]) => keys.some(kk => low(k).includes(kk)))?.[1];
    const name = findVal(["name", "имя", "фио"]);
    const phone = findVal(["phone", "тел"]);
    const email = findVal(["mail", "почта"]);
    const bdayRaw = findVal(["birth", "bday", "рожден", "др "]);
    const bdayTs = parseRuDate(bdayRaw);
    const { entity: dealsCfg, stage, ownerId, route } = resolveRoute("tilda");
    if (!dealsCfg) { toast.error("Заявка с сайта пришла, но раздел не настроен"); return; }
    const raw = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ");
    // клиент: ищем карточку по телефону, иначе создаём — сюда ляжет и дата рождения (для поздравлений)
    let contactId: string | undefined;
    const contactsCfg = clientEntity();
    if (contactsCfg && route.createClient && (name || phone)) {
      // тот же единый ключ, что и везде: «телефон» без семи цифр никого ни с кем не склеивает
      const key = phoneKey(phone);
      const phoneF = contactsCfg.fields.find(f => f.type === "phone");
      const existing = key && phoneF ? st.records.find(r => r.entityId === contactsCfg.id && phoneKey(r.values[phoneF.id]) === key) : undefined;
      if (existing) {
        contactId = existing.id;
        if (bdayTs) mut(s => { const r = s.records.find(x => x.id === contactId)!; r.values["bday"] = bdayTs; r.updatedAt = now(); });
      } else {
        const values: Record<string, unknown> = { [contactsCfg.titleFieldId]: name || phone || "Клиент с сайта" };
        if (phoneF && phone) values[phoneF.id] = phone;
        const emailF = contactsCfg.fields.find(f => f.type === "email");
        if (emailF && email) values[emailF.id] = email;
        if (bdayTs) values["bday"] = bdayTs;
        const sOpt = sourceOption(contactsCfg, "tilda"); if (sOpt) values[sOpt.fieldId] = sOpt.optionId;
        contactId = A.createRecord(contactsCfg.id, values, undefined, ownerId);
      }
    }
    // маршрут выключен: заявка не создаётся, но след остаётся у клиента
    if (!route.auto) {
      if (contactId) mut(() => pushAct(contactId!, "comment", `Заявка с сайта: ${raw}`));
      toast("Заявка с сайта принята", { description: contactId ? "Записал клиенту — заявку создайте вручную" : "Автосоздание для сайта выключено" });
      return;
    }
    // дедуп: у клиента уже есть открытая заявка → новая прикрепляется к ней
    if (contactId) {
      const openDeal = st.records.find(r =>
        r.entityId === dealsCfg.id &&
        dealsCfg.fields.some(f => f.type === "relation" && r.values[f.id] === contactId) &&
        dealsCfg.stages?.find(x => x.id === r.stageId)?.kind === "open");
      if (openDeal) {
        mut(() => pushAct(openDeal.id, "comment", `Повторная заявка с сайта: ${raw}`));
        toast.success("Повторная заявка — приложена к текущей", { description: recTitle(openDeal.id) });
        return;
      }
    }
    const dealValues: Record<string, unknown> = { [dealsCfg.titleFieldId]: name || "Заявка с сайта" };
    const sOptD = sourceOption(dealsCfg, "tilda"); if (sOptD) dealValues[sOptD.fieldId] = sOptD.optionId;
    const contactF = dealsCfg.fields.find(f => f.type === "relation" && contactId && f.relationTo === contactsCfg?.id);
    if (contactF && contactId) dealValues[contactF.id] = contactId;
    const id = A.createRecord(dealsCfg.id, dealValues, stage?.id, ownerId);
    mut(() => pushAct(id, "comment", `Заявка с сайта: ${raw}`));
    toast.success(`Заявка с сайта → ${dealsCfg.name} · ${stage?.label ?? ""}`, { description: [name || phone, bdayTs ? "ДР сохранён" : "", ownerId ? userName(ownerId) : ""].filter(Boolean).join(" · ") });
  },
};

// Разбор дат живёт в rudate.ts — там же, где его использует поле ввода,
// чтобы форма, импорт и приём заявок понимали дату ОДИНАКОВО.
export function parseRuDate(raw?: string): number | undefined {
  return parseRu(raw ?? "") ?? undefined;
}

// схлопывание истории: серию правок ОДНОГО поля (та же запись, тот же автор, рядом по времени)
// показываем одной строкой — финальным значением. Чинит и старый «шум» (крутил стрелку — 10 строк),
// и работает поверх любых данных (облако/локально, до и после фикса коалесинга при записи).
// Вход отсортирован по времени (новые сверху); оставляем самую свежую запись каждой серии.
export function collapseFieldRuns(acts: Activity[]): Activity[] {
  const keyOf = (a: Activity) => a.kind === "field" ? (a.editKey ?? a.text.split(":")[0]) : "";
  const out: Activity[] = [];
  for (const a of acts) {
    const prev = out[out.length - 1];
    if (a.kind === "field" && prev && prev.kind === "field"
      && prev.recordId === a.recordId && prev.userId === a.userId
      && keyOf(a) !== "" && keyOf(prev) === keyOf(a)
      && Math.abs(prev.ts - a.ts) < 300000) {
      continue; // более старую правку того же поля пропускаем — её представляет уже добавленная свежая
    }
    out.push(a);
  }
  return out;
}

// имя собеседника для карточки/диалога: не даём голому «Telegram» — берём номер или «Клиент из …»
export function niceContactName(name: string | undefined, channel: Channel, phone?: string): string {
  const n = (name || "").trim();
  if (n && !/^(telegram|whatsapp|max|instagram)$/i.test(n)) return n;
  return (phone && phone.trim()) || `Клиент из ${channelName(channel)}`;
}

// поле «Источник / Канал» раздела и опция под конкретный канал — заявка сразу знает, откуда пришла
export function sourceOption(e: EntityCfg, source: InboundSource): { fieldId: string; optionId: string } | undefined {
  const f = e.fields.find(x => x.type === "select" && (x.id === "source" || /источник|канал/i.test(x.label)));
  if (!f?.options?.length) return undefined;
  const want = source === "wa" ? /whatsapp|ватс/i : source === "tg" ? /telegram|телеграм/i : source === "max" ? /max|макс/i
    : source === "ig" ? /instagram|инстаг/i : /сайт|tilda|тильда|форма/i;
  const o = f.options.find(x => want.test(x.label));
  return o ? { fieldId: f.id, optionId: o.id } : undefined;
}

// совпадение внешних id двух диалогов (каналы не смешиваются)
function chatExtMatch(a: ChatExt, b: ChatExt): boolean {
  return (b.tg !== undefined && a.tg === b.tg) || (b.wa !== undefined && a.wa === b.wa)
    || (b.max !== undefined && a.max === b.max) || (b.tgu !== undefined && a.tgu === b.tgu);
}

// общий приём входящего из ЛЮБОГО реального канала: найти диалог по внешнему id либо создать (+автолид)
export function handleIncoming(ext: ChatExt, name: string, channel: Channel, text: string, phone?: string) {
  // Текст пишет чужой человек: чистим невидимые управляющие символы и обрезаем гигантские полотна
  text = String(cleanText(text) ?? "");
  name = String(cleanText(name) ?? "").slice(0, 120);
  const found = st.chats.find(c => c.ext && chatExtMatch(c.ext, ext));
  if (found) {
    A.chatIncoming(found.id, text);
    // старый диалог, но заявки за ним больше нет (удалили) или она уже закрыта — это новое обращение
    const rec = recById(found.recordId);
    const stages = rec ? entityCfg(rec.entityId).stages : undefined;
    const live = !!rec && !!stages?.length && stages.find(x => x.id === rec!.stageId)?.kind === "open";
    if (!live && routeOf(channel).auto) A.chatCreateLead(found.id);
    return;
  }
  const id = A.chatIncomingExt(ext, name, channel, text, phone);
  if (routeOf(channel).auto) A.chatCreateLead(id); // маршрут канала решает: сразу заявка или только диалог
}

// ---------- мост в облако (использует cloud.ts) ----------
export function enterCloud(
  data: { entities: EntityCfg[]; automations: Rule[]; routes: Route[]; records: Rec[]; tasks: Task[]; activities: Activity[]; chats: Chat[]; replyTemplates: ReplyTemplate[] },
  ctx: { wsId: string; wsName: string; inviteCode: string; users: User[]; meId: string }
) {
  Object.assign(st, data);
  ensureBdayField(st.entities);
  ensurePos(st.records);
  st.users = ctx.users; st.currentUserId = ctx.meId;
  repairStructure(st); // конфиг из облака мог разойтись со структурой — чиним молча при входе
  st.mode = "cloud"; st.wsId = ctx.wsId; st.wsName = ctx.wsName; st.inviteCode = ctx.inviteCode;
  st.drawerRecordId = null; st.activeChatId = null; st.authStage = null;
  history.length = 0;
  version++; listeners.forEach(l => l()); // уведомить компоненты, не планируя сохранение
}
export function applyRemote(fn: (s: State) => void) { fn(st); version++; listeners.forEach(l => l()); }
export function setAuthStage(v: "auth" | "ws" | null) { mut(s => { s.authStage = v; }); }
export function setWsMeta(name: string, invite: string) { mut(s => { s.wsName = name; s.inviteCode = invite; }); }

export { USERS, channelName };

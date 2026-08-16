// Стор живой части сайта. Архитектура «не переделывать»:
// — все изменения данных идут ТОЛЬКО через экшены A.* (на шаге Supabase они станут писать в общую базу);
// — персист изолирован в адаптере `persistence` (localStorage сейчас → Supabase позже);
// — id полей и стадий стабильные строковые — переезд в Postgres сохранит данные как есть.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Field, Rec, Task, Activity, Chat, ChatExt, Channel, ReplyTemplate, Integrations, User, EntityCfg, Stage, Rule } from "./model";
import { uid, now, displayValue, defaultIntegrations, channelName, defaultStages, defaultRules, PALETTE } from "./model";
import { ENTITIES, USERS, seed, DEFAULT_TEMPLATES } from "./data";

interface DataState { entities: EntityCfg[]; automations: Rule[]; records: Rec[]; tasks: Task[]; activities: Activity[]; chats: Chat[]; replyTemplates: ReplyTemplate[]; integrations: Integrations }
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
      if (!Array.isArray(d?.records)) return null;
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
        records: d.records, tasks: d.tasks ?? [], activities: d.activities ?? [],
        chats: d.chats ?? [], // миграция со старой версии: инбокс начнётся пустым
        replyTemplates: Array.isArray(d.replyTemplates) && d.replyTemplates.length ? d.replyTemplates : DEFAULT_TEMPLATES,
        integrations: ints,
      };
    } catch { return null; }
  },
  save(s: DataState) {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({
        v: 3, entities: s.entities, automations: s.automations, records: s.records, tasks: s.tasks, activities: s.activities,
        chats: s.chats, replyTemplates: s.replyTemplates, integrations: s.integrations,
      }));
    } catch { /* памяти нет — живём в RAM */ }
  },
  reset() { try { window.localStorage.removeItem(LS_KEY); } catch { /* ignore */ } },
};

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
const initial: DataState = persistence.load() ?? { entities: clone(ENTITIES), automations: defaultRules(), ...seed(), replyTemplates: DEFAULT_TEMPLATES, integrations: defaultIntegrations() };
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
const saveInts = () => { try { window.localStorage.setItem(INT_KEY, JSON.stringify(st.integrations)); } catch { /* живём в RAM */ } };
// маршрут сохранения: демо — блоб в localStorage; облако — диф в Supabase (cloudHooks.save назначает cloud.ts)
export const cloudHooks: { save?: () => void } = {};
// события для движка автоматизаций (устанавливает automations.ts)
export const ruleHooks: { created?: (recId: string) => void; stage?: (recId: string, stageId: string) => void } = {};
const dispatchSave = () => {
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

// ---------- undo (снимки перед опасными действиями) ----------
const history: string[] = [];
function pushHistory() {
  history.push(JSON.stringify({ entities: st.entities, records: st.records, tasks: st.tasks, activities: st.activities }));
  if (history.length > 25) history.shift();
}
export function undo(): boolean {
  const snap = history.pop();
  if (!snap) return false;
  mut(s => {
    Object.assign(s, JSON.parse(snap));
    if (s.drawerRecordId && !s.records.some(r => r.id === s.drawerRecordId)) s.drawerRecordId = null;
  });
  toast("Действие отменено");
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
const phoneDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
// один человек = одна карточка: ищем запись с таким телефоном в любом разделе (контакты — в приоритете)
export function findRecordByPhone(phoneRaw?: string, preferEntity = "contacts"): Rec | undefined {
  const d = phoneDigits(phoneRaw);
  if (d.length < 7) return undefined;
  const match = (r: Rec) => {
    const e = st.entities.find(x => x.id === r.entityId);
    return !!e?.fields.some(f => f.type === "phone" && phoneDigits(r.values[f.id]) === d);
  };
  return st.records.find(r => r.entityId === preferEntity && match(r)) ?? st.records.find(match);
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
  const chats = st.chats.filter(c => (c.recordId && ids.has(c.recordId)) || (d.length >= 7 && phoneDigits(c.phone) === d));
  return { records, chats };
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

function pushAct(recordId: string, kind: Activity["kind"], text: string, userId?: string) {
  st.activities.push({ id: uid("a"), recordId, ts: now(), kind, text, userId });
}

// ---------- экшены ----------
export const A = {
  openRecord(id: string | null) { mut(s => { s.drawerRecordId = id; }); },
  setUser(id: string) { mut(s => { s.currentUserId = id; }); },

  setValue(recId: string, f: Field, value: unknown) {
    mut(s => {
      const r = recById(recId)!; const old = r.values[f.id];
      r.values[f.id] = value; r.updatedAt = now();
      if (JSON.stringify(old ?? "") !== JSON.stringify(value ?? "")) {
        const dv = displayValue(f, value, dispCtx());
        pushAct(recId, "field", `${f.label}: ${dv === "" ? "очищено" : dv}`, s.currentUserId);
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
    pushHistory();
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
      }
    });
  },
  createRecord(entityId: string, values: Record<string, unknown> = {}, stageId?: string): string {
    let id = "";
    mut(s => {
      const e = entityCfg(entityId);
      const stgId = stageId ?? e.stages?.[0]?.id;
      const col = s.records.filter(x => x.entityId === entityId && x.stageId === stgId);
      const r: Rec = {
        id: uid("r"), entityId, num: s.records.filter(x => x.entityId === entityId).length + 1,
        values, ownerId: s.currentUserId, createdAt: now(), updatedAt: now(),
        stageId: stgId, stageAt: now(),
        pos: Math.max(0, ...col.map(x => x.pos ?? 0)) + 1000, // новые — в конец колонки
      };
      s.records.push(r); id = r.id;
      pushAct(id, "created", "Запись создана", s.currentUserId);
    });
    ruleHooks.created?.(id);
    return id;
  },
  deleteRecord(recId: string) {
    pushHistory();
    mut(s => {
      s.records = s.records.filter(r => r.id !== recId);
      s.tasks = s.tasks.filter(t => t.recordId !== recId);
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
  resetDemo() {
    if (st.mode !== "local") { toast("В облачном пространстве демо-сброс недоступен"); return; }
    persistence.reset();
    const fresh = seed();
    ensurePos(fresh.records);
    mut(s => { Object.assign(s, fresh, { replyTemplates: DEFAULT_TEMPLATES, integrations: defaultIntegrations() }); s.drawerRecordId = null; s.activeChatId = null; });
    toast("Демо-данные сброшены к исходным");
  },

  // ---------- инбокс ----------
  openChat(id: string | null) {
    mut(s => {
      s.activeChatId = id;
      if (id) { const c = s.chats.find(x => x.id === id); if (c) c.unread = 0; }
    });
  },
  chatSend(chatId: string, text: string) {
    mut(s => {
      const c = s.chats.find(x => x.id === chatId)!;
      c.msgs.push({ id: uid("m"), ts: now(), out: true, text });
      if (c.recordId && recById(c.recordId)) pushAct(c.recordId, "comment", `→ ${channelName(c.channel)}: ${text}`, s.currentUserId);
    });
  },
  chatIncoming(chatId: string, text: string) {
    mut(s => {
      const c = s.chats.find(x => x.id === chatId); if (!c) return;
      c.msgs.push({ id: uid("m"), ts: now(), out: false, text });
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
      if (c.recordId && recById(c.recordId)) pushAct(c.recordId, "comment", `→ ${channelName(c.channel)} (с телефона): ${text}`, s.currentUserId);
    });
  },
  // синхронизация диалога личного Telegram при подключении/переподключении: догружаем только новое, без тостов
  tguSyncDialog(tguId: string, name: string, phone: string | undefined, msgs: { ts: number; out: boolean; text: string }[], unread: number) {
    mut(s => {
      let c = s.chats.find(x => x.ext?.tgu === tguId);
      if (!c) {
        c = { id: uid("c"), name, phone, channel: "tg", unread: 0, msgs: [], ext: { tgu: tguId } };
        s.chats.unshift(c);
      }
      c.name = name; if (phone) c.phone = phone;
      const lastTs = c.msgs.length ? c.msgs[c.msgs.length - 1].ts : 0;
      for (const m of msgs) if (m.ts > lastTs) c.msgs.push({ id: uid("m"), ts: m.ts, out: m.out, text: m.text });
      if (s.activeChatId !== c.id) c.unread = Math.max(c.unread, unread);
    });
  },
  chatCreateLead(chatId: string): string | null {
    const c = st.chats.find(x => x.id === chatId);
    if (!c) return null;
    const e = entityCfg("deals");
    // дедуп: известный клиент? (диалог уже привязан к карточке-человеку или совпал телефон)
    const linkedRec = c.recordId ? recById(c.recordId) : undefined;
    const person = (linkedRec && !entityCfg(linkedRec.entityId).stages?.length ? linkedRec : undefined) ?? findRecordByPhone(c.phone);
    const contactF = e.fields.find(f => f.type === "relation" && person && f.relationTo === person.entityId);
    if (person) {
      const openDeal = st.records.find(r =>
        r.entityId === "deals" &&
        e.fields.some(f => f.type === "relation" && r.values[f.id] === person.id) &&
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
    const values: Record<string, unknown> = { title: person ? recTitle(person.id) : niceContactName(c.name, c.channel, c.phone) };
    if (person && contactF) values[contactF.id] = person.id;
    const srcField = e.fields.find(f => f.id === "source");
    const want = c.channel === "wa" ? /whatsapp/i : c.channel === "tg" ? /telegram/i : c.channel === "max" ? /max/i : /instagram|сайт/i;
    const srcOpt = srcField?.options?.find(o => want.test(o.label)) ?? srcField?.options?.find(o => /сайт/i.test(o.label));
    if (srcField && srcOpt) values[srcField.id] = srcOpt.id;
    const id = A.createRecord("deals", values);
    mut(s => {
      const cc = s.chats.find(x => x.id === chatId)!;
      cc.recordId = id;
      pushAct(id, "comment", `Сделка создана из диалога в ${channelName(c.channel)}${c.phone ? ` · ${c.phone}` : ""}${person ? ` · клиент: ${recTitle(person.id)}` : ""}`);
    });
    toast.success(person ? "Сделка создана и привязана к клиенту" : "Сделка создана и связана с диалогом");
    return id;
  },

  // ---------- интеграции и шаблоны ----------
  intPatch(fn: (i: Integrations) => void) { mut(s => fn(s.integrations)); },
  setAutoLead(v: boolean) { mut(s => { s.integrations.autoLead = v; }); },
  tplAdd(name: string, text: string) { mut(s => s.replyTemplates.push({ id: uid("tpl"), name, text })); },
  tplUpdate(id: string, patch: Partial<ReplyTemplate>) { mut(s => Object.assign(s.replyTemplates.find(t => t.id === id)!, patch)); },
  tplDelete(id: string) { mut(s => { s.replyTemplates = s.replyTemplates.filter(t => t.id !== id); }); },
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
  ruleDelete(id: string) { mut(s => { s.automations = s.automations.filter(x => x.id !== id); }); },
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
    toast.success(`Раздел «${ent.namePlural}» создан`, { description: "Настройте поля и стадии под себя" });
    return id;
  },
  entPatch(id: string, patch: Partial<Pick<EntityCfg, "name" | "namePlural" | "icon">>) {
    mut(s => { const e = s.entities.find(x => x.id === id); if (e) Object.assign(e, patch); });
  },
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
    });
  },
  entDelete(id: string): boolean {
    const used = st.entities.find(e => e.id !== id && e.fields.some(f => f.type === "relation" && f.relationTo === id));
    if (used) { toast.error(`Сначала удалите поле-связь в разделе «${used.namePlural}»`); return false; }
    if (st.entities.length <= 1) { toast.error("Нельзя удалить последний раздел"); return false; }
    pushHistory();
    mut(s => {
      const ids = new Set(s.records.filter(r => r.entityId === id).map(r => r.id));
      s.records = s.records.filter(r => r.entityId !== id);
      s.tasks = s.tasks.filter(t => !t.recordId || !ids.has(t.recordId));
      s.activities = s.activities.filter(a => !ids.has(a.recordId));
      s.chats.forEach(c => { if (c.recordId && ids.has(c.recordId)) c.recordId = undefined; });
      if (s.drawerRecordId && ids.has(s.drawerRecordId)) s.drawerRecordId = null;
      s.entities = s.entities.filter(e => e.id !== id);
    });
    toast("Раздел удалён вместе с записями", { description: "Ctrl+Z вернёт" });
    return true;
  },
  fieldAdd(entityId: string, f: Omit<Field, "id">): string {
    const id = uid("f");
    mut(s => { s.entities.find(e => e.id === entityId)?.fields.push({ ...f, id }); });
    return id;
  },
  fieldUpdate(entityId: string, fieldId: string, patch: Partial<Field>) {
    mut(s => { const f = s.entities.find(e => e.id === entityId)?.fields.find(x => x.id === fieldId); if (f) Object.assign(f, patch); });
  },
  fieldDelete(entityId: string, fieldId: string) {
    const e = st.entities.find(x => x.id === entityId);
    if (!e || e.titleFieldId === fieldId) { toast.error("Поле-заголовок удалить нельзя"); return; }
    mut(s => { const en = s.entities.find(x => x.id === entityId)!; en.fields = en.fields.filter(f => f.id !== fieldId); });
  },
  fieldMove(entityId: string, fieldId: string, dir: -1 | 1) {
    mut(s => {
      const e = s.entities.find(x => x.id === entityId); if (!e) return;
      const i = e.fields.findIndex(f => f.id === fieldId); const j = i + dir;
      if (i < 0 || j < 0 || j >= e.fields.length) return;
      [e.fields[i], e.fields[j]] = [e.fields[j], e.fields[i]];
    });
  },
  stageAdd(entityId: string, label: string) {
    mut(s => {
      const e = s.entities.find(x => x.id === entityId); if (!e) return;
      if (!e.stages) e.stages = [];
      e.stages.push({ id: uid("s"), label: label.trim() || "Стадия", color: PALETTE[e.stages.length % PALETTE.length], kind: "open" });
    });
  },
  stageUpdate(entityId: string, stageId: string, patch: Partial<Stage>) {
    mut(s => { const stg = s.entities.find(x => x.id === entityId)?.stages?.find(x => x.id === stageId); if (stg) Object.assign(stg, patch); });
  },
  stageDelete(entityId: string, stageId: string) {
    const e = st.entities.find(x => x.id === entityId);
    if (!e?.stages || e.stages.length <= 1) { toast.error("Должна остаться хотя бы одна стадия"); return; }
    mut(s => {
      const en = s.entities.find(x => x.id === entityId)!;
      en.stages = en.stages!.filter(x => x.id !== stageId);
      const first = en.stages[0];
      s.records.forEach(r => { if (r.entityId === entityId && r.stageId === stageId) { r.stageId = first.id; r.stageAt = now(); } });
    });
  },
  stageMove(entityId: string, stageId: string, dir: -1 | 1) {
    mut(s => {
      const e = s.entities.find(x => x.id === entityId); if (!e?.stages) return;
      const i = e.stages.findIndex(x => x.id === stageId); const j = i + dir;
      if (i < 0 || j < 0 || j >= e.stages.length) return;
      [e.stages[i], e.stages[j]] = [e.stages[j], e.stages[i]];
    });
  },
  tildaLead(fields: Record<string, string>) {
    const low = (k: string) => k.toLowerCase();
    const findVal = (keys: string[]) => Object.entries(fields).find(([k]) => keys.some(kk => low(k).includes(kk)))?.[1];
    const name = findVal(["name", "имя", "фио"]);
    const phone = findVal(["phone", "тел"]);
    const email = findVal(["mail", "почта"]);
    const bdayRaw = findVal(["birth", "bday", "рожден", "др "]);
    const bdayTs = parseRuDate(bdayRaw);
    // клиент: ищем контакт по телефону, иначе создаём — сюда ляжет и дата рождения (для поздравлений)
    let contactId: string | undefined;
    const contactsCfg = st.entities.find(e => e.id === "contacts");
    if (contactsCfg && (name || phone)) {
      const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
      const phoneF = contactsCfg.fields.find(f => f.type === "phone");
      const existing = phone && phoneF ? st.records.find(r => r.entityId === "contacts" && digits(r.values[phoneF.id]) === digits(phone)) : undefined;
      if (existing) {
        contactId = existing.id;
        if (bdayTs) mut(s => { const r = s.records.find(x => x.id === contactId)!; r.values["bday"] = bdayTs; r.updatedAt = now(); });
      } else {
        const values: Record<string, unknown> = { [contactsCfg.titleFieldId]: name || phone || "Клиент с Tilda" };
        if (phoneF && phone) values[phoneF.id] = phone;
        const emailF = contactsCfg.fields.find(f => f.type === "email");
        if (emailF && email) values[emailF.id] = email;
        if (bdayTs) values["bday"] = bdayTs;
        contactId = A.createRecord("contacts", values);
      }
    }
    const dealsCfg = entityCfg("deals");
    // дедуп: у клиента уже есть открытая сделка → заявка прикрепляется к ней
    if (contactId) {
      const openDeal = st.records.find(r =>
        r.entityId === "deals" &&
        dealsCfg.fields.some(f => f.type === "relation" && r.values[f.id] === contactId) &&
        dealsCfg.stages?.find(x => x.id === r.stageId)?.kind === "open");
      if (openDeal) {
        mut(() => pushAct(openDeal.id, "comment", `Повторная заявка с Tilda: ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ")}`));
        toast.success("Повторная заявка — приложена к текущей сделке клиента", { description: recTitle(openDeal.id) });
        return;
      }
    }
    const dealValues: Record<string, unknown> = { title: name || "Заявка с Tilda", source: dealsCfg.fields.find(f => f.id === "source")?.options?.find(o => /сайт/i.test(o.label))?.id };
    const contactF = dealsCfg.fields.find(f => f.type === "relation" && f.relationTo === "contacts");
    if (contactF && contactId) dealValues[contactF.id] = contactId;
    const id = A.createRecord("deals", dealValues);
    mut(() => pushAct(id, "comment", `Заявка с Tilda: ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ")}`));
    toast.success("Заявка с Tilda упала в воронку", { description: [name || phone, bdayTs ? "ДР сохранён" : ""].filter(Boolean).join(" · ") });
  },
};

// «19.08.1992», «1992-08-19», «19/08/92» → таймстамп (для дат рождения из форм)
export function parseRuDate(raw?: string): number | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += y > 30 ? 1900 : 2000;
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]), 12);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }
  return undefined;
}

// имя собеседника для карточки/диалога: не даём голому «Telegram» — берём номер или «Клиент из …»
export function niceContactName(name: string | undefined, channel: Channel, phone?: string): string {
  const n = (name || "").trim();
  if (n && !/^(telegram|whatsapp|max|instagram)$/i.test(n)) return n;
  return (phone && phone.trim()) || `Клиент из ${channelName(channel)}`;
}

// совпадение внешних id двух диалогов (каналы не смешиваются)
function chatExtMatch(a: ChatExt, b: ChatExt): boolean {
  return (b.tg !== undefined && a.tg === b.tg) || (b.wa !== undefined && a.wa === b.wa)
    || (b.max !== undefined && a.max === b.max) || (b.tgu !== undefined && a.tgu === b.tgu);
}

// общий приём входящего из ЛЮБОГО реального канала: найти диалог по внешнему id либо создать (+автолид)
export function handleIncoming(ext: ChatExt, name: string, channel: Channel, text: string, phone?: string) {
  const found = st.chats.find(c => c.ext && chatExtMatch(c.ext, ext));
  if (found) { A.chatIncoming(found.id, text); return; }
  const id = A.chatIncomingExt(ext, name, channel, text, phone);
  if (st.integrations.autoLead) {
    const lead = A.chatCreateLead(id);
    if (lead) toast.success("Автолид: диалог превращён в сделку", { description: recTitle(lead) });
  }
}

// ---------- мост в облако (использует cloud.ts) ----------
export function enterCloud(
  data: { entities: EntityCfg[]; automations: Rule[]; records: Rec[]; tasks: Task[]; activities: Activity[]; chats: Chat[]; replyTemplates: ReplyTemplate[] },
  ctx: { wsId: string; wsName: string; inviteCode: string; users: User[]; meId: string }
) {
  Object.assign(st, data);
  ensureBdayField(st.entities);
  ensurePos(st.records);
  st.users = ctx.users; st.currentUserId = ctx.meId;
  st.mode = "cloud"; st.wsId = ctx.wsId; st.wsName = ctx.wsName; st.inviteCode = ctx.inviteCode;
  st.drawerRecordId = null; st.activeChatId = null; st.authStage = null;
  history.length = 0;
  version++; listeners.forEach(l => l()); // уведомить компоненты, не планируя сохранение
}
export function applyRemote(fn: (s: State) => void) { fn(st); version++; listeners.forEach(l => l()); }
export function setAuthStage(v: "auth" | "ws" | null) { mut(s => { s.authStage = v; }); }
export function setWsMeta(name: string, invite: string) { mut(s => { s.wsName = name; s.inviteCode = invite; }); }

export { USERS, channelName };

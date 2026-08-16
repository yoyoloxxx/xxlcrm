// Стор живой части сайта. Архитектура «не переделывать»:
// — все изменения данных идут ТОЛЬКО через экшены A.* (на шаге Supabase они станут писать в общую базу);
// — персист изолирован в адаптере `persistence` (localStorage сейчас → Supabase позже);
// — id полей и стадий стабильные строковые — переезд в Postgres сохранит данные как есть.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Field, Rec, Task, Activity, Chat, ChatExt, Channel, ReplyTemplate, Integrations, User } from "./model";
import { uid, now, displayValue, defaultIntegrations, channelName } from "./model";
import { ENTITIES, USERS, entityCfg, seed, DEFAULT_TEMPLATES } from "./data";

interface DataState { records: Rec[]; tasks: Task[]; activities: Activity[]; chats: Chat[]; replyTemplates: ReplyTemplate[]; integrations: Integrations }
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
        v: 2, records: s.records, tasks: s.tasks, activities: s.activities,
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
const initial: DataState = persistence.load() ?? { ...seed(), replyTemplates: DEFAULT_TEMPLATES, integrations: defaultIntegrations() };
try { const rawInts = window.localStorage.getItem(INT_KEY); if (rawInts) initial.integrations = normalizeInts(JSON.parse(rawInts)); } catch { /* берём integrations из основного пейлоада */ }
ensurePos(initial.records);
const st: State = {
  ...initial, currentUserId: "u1", drawerRecordId: null, activeChatId: null,
  users: USERS, mode: "local", wsId: null, wsName: "Digital Loft", inviteCode: "", authStage: null,
};

let version = 0;
const listeners = new Set<() => void>();
let saveTimer: number | undefined;
const saveInts = () => { try { window.localStorage.setItem(INT_KEY, JSON.stringify(st.integrations)); } catch { /* живём в RAM */ } };
// маршрут сохранения: демо — блоб в localStorage; облако — диф в Supabase (cloudHooks.save назначает cloud.ts)
export const cloudHooks: { save?: () => void } = {};
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
  history.push(JSON.stringify({ records: st.records, tasks: st.tasks, activities: st.activities }));
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
export const recById = (id?: string | null) => st.records.find(r => r.id === id);
export const recordsOf = (entityId: string) => st.records.filter(r => r.entityId === entityId);
export const userName = (id?: string) => st.users.find(u => u.id === id)?.name ?? "";
export const userById = (id?: string) => st.users.find(u => u.id === id);
export const allUsers = () => st.users;
export const openTasksFor = (recordId: string) => st.tasks.filter(t => t.recordId === recordId && !t.done);

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
    let id = "";
    mut(s => {
      const c: Chat = { id: uid("c"), name, phone, channel, unread: 1, msgs: [{ id: uid("m"), ts: now(), out: false, text }], ext };
      s.chats.unshift(c); id = c.id;
    });
    toast(`Новый диалог: ${name}`, { description: text.slice(0, 64) });
    return id;
  },
  // исходящее, отправленное С ТЕЛЕФОНА (личный аккаунт): показываем в ленте, не трогая счётчики
  chatEcho(ext: ChatExt, name: string, text: string, ts?: number, phone?: string) {
    mut(s => {
      let c = s.chats.find(x => x.ext && chatExtMatch(x.ext, ext));
      if (!c) { c = { id: uid("c"), name, phone, channel: "tg", unread: 0, msgs: [], ext }; s.chats.unshift(c); }
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
    const values: Record<string, unknown> = { title: c.name }; // телефон уйдёт в хронологию сделки
    const srcField = e.fields.find(f => f.id === "source");
    const want = c.channel === "wa" ? /whatsapp/i : c.channel === "tg" ? /telegram/i : c.channel === "max" ? /max/i : /instagram|сайт/i;
    const srcOpt = srcField?.options?.find(o => want.test(o.label)) ?? srcField?.options?.find(o => /сайт/i.test(o.label));
    if (srcField && srcOpt) values[srcField.id] = srcOpt.id;
    const id = A.createRecord("deals", values);
    mut(s => {
      const cc = s.chats.find(x => x.id === chatId)!;
      cc.recordId = id;
      pushAct(id, "comment", `Сделка создана из диалога в ${channelName(c.channel)}${c.phone ? ` · ${c.phone}` : ""}`);
    });
    toast.success("Сделка создана и связана с диалогом");
    return id;
  },

  // ---------- интеграции и шаблоны ----------
  intPatch(fn: (i: Integrations) => void) { mut(s => fn(s.integrations)); },
  setAutoLead(v: boolean) { mut(s => { s.integrations.autoLead = v; }); },
  tplAdd(name: string, text: string) { mut(s => s.replyTemplates.push({ id: uid("tpl"), name, text })); },
  tplUpdate(id: string, patch: Partial<ReplyTemplate>) { mut(s => Object.assign(s.replyTemplates.find(t => t.id === id)!, patch)); },
  tplDelete(id: string) { mut(s => { s.replyTemplates = s.replyTemplates.filter(t => t.id !== id); }); },
  tildaLead(fields: Record<string, string>) {
    const low = (k: string) => k.toLowerCase();
    const findVal = (keys: string[]) => Object.entries(fields).find(([k]) => keys.some(kk => low(k).includes(kk)))?.[1];
    const name = findVal(["name", "имя", "фио"]);
    const phone = findVal(["phone", "тел"]);
    const id = A.createRecord("deals", { title: name || "Заявка с Tilda", source: entityCfg("deals").fields.find(f => f.id === "source")?.options?.find(o => /сайт/i.test(o.label))?.id });
    mut(() => pushAct(id, "comment", `Заявка с Tilda: ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ")}`));
    toast.success("Заявка с Tilda упала в воронку", { description: name || phone || "" });
  },
};

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
  data: { records: Rec[]; tasks: Task[]; activities: Activity[]; chats: Chat[]; replyTemplates: ReplyTemplate[] },
  ctx: { wsId: string; wsName: string; inviteCode: string; users: User[]; meId: string }
) {
  Object.assign(st, data);
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

export { ENTITIES, USERS, entityCfg, channelName };

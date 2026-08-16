// Единый стор прототипа: мутируем состояние + версия для useSyncExternalStore.
// Для прототипа осознанно перерисовываем всё дерево на изменение (объёмы данных малы).
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Workspace, Entity, Rec, Field, Stage, View, Task, Automation, Widget, Integrations, Channel } from "./model";
import { uid, now, DAY, displayValue, defaultIntegrations } from "./model";
import { buildWorkspace } from "./templates";

export type NavPage = "entity" | "myday" | "dashboard" | "automations" | "settings" | "inbox";
export interface Checklist { openedRecord: boolean; movedKanban: boolean; addedField: boolean; createdEntity: boolean; openedDashboard: boolean }

interface State {
  screen: "wizard" | "app";
  ws: Workspace | null;
  nav: { page: NavPage; entityId?: string };
  activeView: Record<string, string>;
  drawerRecordId: string | null;
  currentUserId: string;
  checklist: Checklist;
  checklistOpen: boolean;
  theme: "light" | "dark";
  activeChatId: string | null;
}

const st: State = {
  screen: "wizard", ws: null,
  nav: { page: "myday" }, activeView: {}, drawerRecordId: null,
  currentUserId: "u1",
  checklist: { openedRecord: false, movedKanban: false, addedField: false, createdEntity: false, openedDashboard: false },
  checklistOpen: true,
  theme: "light",
  activeChatId: null,
};

// ---------- персистентность (localStorage, безопасно для песочниц) ----------
const LS_KEY = "xxlcrm-proto-state-v2";
const storage = {
  get(): string | null { try { return window.localStorage.getItem(LS_KEY); } catch { return null; } },
  set(v: string) { try { window.localStorage.setItem(LS_KEY, v); } catch { /* нет хранилища — работаем в памяти */ } },
  clear() { try { window.localStorage.removeItem(LS_KEY); } catch { /* ignore */ } },
};
let saveTimer: number | undefined;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!st.ws) { storage.clear(); return; }
    const { ws, nav, activeView, currentUserId, checklist, checklistOpen, theme, activeChatId } = st;
    storage.set(JSON.stringify({ v: 2, savedAt: Date.now(), state: { ws, nav, activeView, currentUserId, checklist, checklistOpen, theme, activeChatId } }));
  }, 350);
}
(function boot() {
  const raw = storage.get();
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data?.v === 2 && data.state?.ws?.entities?.length) {
      Object.assign(st, data.state);
      if (!st.ws!.chats) st.ws!.chats = [];
      if (!st.ws!.integrations) st.ws!.integrations = defaultIntegrations();
      st.ws!.integrations.tg.status = st.ws!.integrations.tg.token ? "ok" : "off";
      st.ws!.integrations.wa.status = st.ws!.integrations.wa.idInstance ? "ok" : "off";
      st.screen = "app";
      st.drawerRecordId = null;
    }
  } catch { storage.clear(); }
})();

let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; persist(); listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useApp(): State { useSyncExternalStore(subscribe, () => version); return st; }
export const getState = () => st;

function mut(fn: (s: State) => void) { fn(st); emit(); }

// ---------- undo (снимки перед опасными действиями) ----------
const history: string[] = [];
function pushHistory() {
  if (!st.ws) return;
  history.push(JSON.stringify(st.ws));
  if (history.length > 25) history.shift();
}
export function undo(): boolean {
  const snap = history.pop();
  if (!snap || !st.ws) return false;
  mut(s => { s.ws = JSON.parse(snap); if (s.drawerRecordId && !s.ws!.records.some(r => r.id === s.drawerRecordId)) s.drawerRecordId = null; });
  toast("Действие отменено");
  return true;
}

// ---------- селекторы ----------
export const entityById = (id?: string) => st.ws?.entities.find(e => e.id === id);
export const recById = (id?: string | null) => st.ws?.records.find(r => r.id === id);
export const userName = (id?: string) => st.ws?.users.find(u => u.id === id)?.name ?? "";
export const userById = (id?: string) => st.ws?.users.find(u => u.id === id);

export function recTitle(id?: string): string {
  const r = recById(id ?? undefined); if (!r) return "";
  const e = entityById(r.entityId); if (!e) return "";
  const t = String(r.values[e.titleFieldId] ?? "").trim();
  if (t) return t;
  const rel = e.fields.find(f => f.type === "relation" && r.values[f.id]);
  if (rel) { const inner = recTitle(r.values[rel.id] as string); if (inner) return inner; }
  return `${e.name} №${r.num}`;
}
export const dispCtx = () => ({ recTitle, userName });
export const openTasksFor = (recordId: string) => st.ws!.tasks.filter(t => t.recordId === recordId && !t.done);

// Рол-ап: агрегат по записям другого раздела, ссылающимся на эту запись
export function rollupValue(f: Field, rec: Rec): number {
  const cfg = f.rollup; if (!cfg || !st.ws) return 0;
  const linked = st.ws.records.filter(r => r.entityId === cfg.entityId && r.values[cfg.viaFieldId] === rec.id);
  if (cfg.agg === "count") return linked.length;
  return linked.reduce((s, r) => s + (Number(r.values[cfg.targetFieldId ?? ""]) || 0), 0);
}

function pushAct(recordId: string, kind: "created" | "stage" | "field" | "comment" | "task" | "auto", text: string, userId?: string) {
  st.ws!.activities.push({ id: uid("a"), recordId, ts: now(), kind, text, userId });
}
function notify(text: string, icon = "⚡") {
  st.ws!.notices.unshift({ id: uid("n"), ts: now(), text, icon });
  toast(text);
}

// ---------- автоматизации ----------
function runAutomations(trigger: "record.created" | "stage.changed", rec: Rec, depth = 0) {
  if (depth > 2 || !st.ws) return;
  for (const a of st.ws.automations) {
    if (!a.enabled || a.entityId !== rec.entityId || a.trigger !== trigger) continue;
    if (trigger === "stage.changed" && a.stageId && a.stageId !== rec.stageId) continue;
    a.fired++;
    for (const act of a.actions) {
      if (act.kind === "task") {
        st.ws.tasks.push({ id: uid("t"), title: act.title, kind: act.taskKind, recordId: rec.id, ownerId: rec.ownerId, due: now() + Math.max(act.inDays, 0) * DAY + (act.inDays === 0 ? 3600000 : 0), done: false });
        pushAct(rec.id, "auto", `Автоматизация: ${a.name} → задача «${act.title}»`);
        toast.success(`Автоматизация: задача «${act.title}»`, { description: recTitle(rec.id) });
      } else if (act.kind === "notify") {
        pushAct(rec.id, "auto", `Автоматизация: ${a.name} → уведомление`);
        notify(act.text);
      } else if (act.kind === "stage") {
        rec.stageId = act.stageId; rec.stageAt = now();
        runAutomations("stage.changed", rec, depth + 1);
      }
    }
  }
}

export function runStaleCheck() {
  if (!st.ws) return;
  let fired = 0;
  for (const a of st.ws.automations) {
    if (!a.enabled || a.trigger !== "stale" || !a.stageId) continue;
    for (const r of st.ws.records) {
      if (r.entityId !== a.entityId || r.stageId !== a.stageId) continue;
      if (now() - (r.stageAt ?? r.createdAt) < (a.days ?? 3) * DAY) continue;
      const already = st.ws.tasks.some(t => t.recordId === r.id && !t.done);
      if (already) continue;
      a.fired++; fired++;
      for (const act of a.actions) if (act.kind === "task")
        st.ws.tasks.push({ id: uid("t"), title: act.title, kind: act.taskKind, recordId: r.id, ownerId: r.ownerId, due: now() + 2 * 3600000, done: false });
      pushAct(r.id, "auto", `Автоматизация: ${a.name} — запись застряла, создана задача`);
    }
  }
  if (fired) { notify(`Контроль зависших: создано задач — ${fired}`, "⏰"); emit(); }
}

// ---------- действия ----------
export const A = {
  start(templateKey: string, wsName: string) {
    const { ws, firstEntityId } = buildWorkspace(templateKey, wsName);
    ws.integrations = defaultIntegrations();
    mut(s => {
      s.ws = ws; s.screen = "app";
      s.nav = { page: "entity", entityId: firstEntityId };
      s.activeView = {}; s.drawerRecordId = null;
      s.checklist = { openedRecord: false, movedKanban: false, addedField: false, createdEntity: false, openedDashboard: false };
      s.checklistOpen = templateKey !== "blank";
    });
    setTimeout(() => runStaleCheck(), 600);
  },
  reset() {
    history.length = 0; storage.clear();
    mut(s => { s.screen = "wizard"; s.ws = null; s.drawerRecordId = null; s.activeChatId = null; });
  },
  go(page: NavPage, entityId?: string) {
    mut(s => { s.nav = { page, entityId }; if (page === "dashboard") s.checklist.openedDashboard = true; });
  },
  setView(entityId: string, viewId: string) { mut(s => { s.activeView[entityId] = viewId; }); },
  openRecord(id: string | null) { mut(s => { s.drawerRecordId = id; if (id) s.checklist.openedRecord = true; }); },
  setUser(id: string) { mut(s => { s.currentUserId = id; }); },
  toggleChecklist() { mut(s => { s.checklistOpen = !s.checklistOpen; }); },

  setValue(recId: string, f: Field, value: unknown) {
    mut(() => {
      const r = recById(recId)!; const old = r.values[f.id];
      r.values[f.id] = value; r.updatedAt = now();
      if (JSON.stringify(old ?? "") !== JSON.stringify(value ?? "")) {
        const dv = displayValue(f, value, dispCtx());
        pushAct(recId, "field", `${f.label}: ${dv === "" ? "очищено" : dv}`, st.currentUserId);
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
  moveStage(recId: string, stageId: string, viaKanban = false) {
    pushHistory();
    mut(s => {
      const r = recById(recId)!; if (r.stageId === stageId) return;
      const e = entityById(r.entityId)!;
      const stage = e.pipeline!.stages.find(x => x.id === stageId)!;
      r.stageId = stageId; r.stageAt = now(); r.updatedAt = now();
      pushAct(recId, "stage", `Стадия: ${stage.label}`, s.currentUserId);
      if (viaKanban) s.checklist.movedKanban = true;
      runAutomations("stage.changed", r);
    });
  },
  createRecord(entityId: string, values: Record<string, unknown> = {}, stageId?: string, opts: { silent?: boolean; source?: string } = {}): string {
    let id = "";
    mut(s => {
      const e = entityById(entityId)!;
      const r: Rec = {
        id: uid("r"), entityId, num: s.ws!.records.filter(x => x.entityId === entityId).length + 1,
        values, ownerId: s.currentUserId, createdAt: now(), updatedAt: now(),
        stageId: stageId ?? e.pipeline?.stages[0].id, stageAt: now(),
      };
      s.ws!.records.push(r); id = r.id;
      pushAct(r.id, "created", opts.source ? `Запись создана (${opts.source})` : "Запись создана", opts.source ? undefined : s.currentUserId);
      if (!opts.silent) runAutomations("record.created", r);
    });
    return id;
  },
  importRecords(entityId: string, rows: Record<string, unknown>[]): { added: number; dupes: number } {
    pushHistory();
    const e = entityById(entityId)!;
    const keyFields = e.fields.filter(f => f.type === "phone" || f.type === "email");
    const norm = (v: unknown) => String(v ?? "").replace(/[\s\-()]/g, "").toLowerCase();
    const existingKeys = new Set(
      st.ws!.records.filter(r => r.entityId === entityId)
        .flatMap(r => keyFields.map(f => norm(r.values[f.id])).filter(Boolean))
    );
    let added = 0, dupes = 0;
    mut(s => {
      for (const values of rows) {
        const keys = keyFields.map(f => norm(values[f.id])).filter(Boolean);
        if (keys.some(k => existingKeys.has(k))) { dupes++; continue; }
        keys.forEach(k => existingKeys.add(k));
        const r: Rec = {
          id: uid("r"), entityId, num: s.ws!.records.filter(x => x.entityId === entityId).length + 1,
          values, ownerId: s.currentUserId, createdAt: now(), updatedAt: now(),
          stageId: e.pipeline?.stages[0].id, stageAt: now(),
        };
        s.ws!.records.push(r);
        pushAct(r.id, "created", "Импортировано из файла", s.currentUserId);
        added++;
      }
    });
    return { added, dupes };
  },
  bulkStage(ids: string[], stageId: string) {
    pushHistory();
    mut(s => {
      for (const id of ids) {
        const r = recById(id); if (!r || r.stageId === stageId) continue;
        const e = entityById(r.entityId)!;
        const stage = e.pipeline?.stages.find(x => x.id === stageId); if (!stage) continue;
        r.stageId = stageId; r.stageAt = now(); r.updatedAt = now();
        pushAct(id, "stage", `Стадия: ${stage.label} (массово)`, s.currentUserId);
      }
    });
    toast(`Стадия изменена: ${ids.length}`);
  },
  bulkOwner(ids: string[], userId: string) {
    pushHistory();
    mut(s => {
      for (const id of ids) {
        const r = recById(id); if (!r) continue;
        r.ownerId = userId; r.updatedAt = now();
        pushAct(id, "field", `Ответственный: ${userName(userId)} (массово)`, s.currentUserId);
      }
    });
    toast(`Ответственный назначен: ${ids.length}`);
  },
  bulkDelete(ids: string[]) {
    pushHistory();
    const set = new Set(ids);
    mut(s => {
      s.ws!.records = s.ws!.records.filter(r => !set.has(r.id));
      s.ws!.tasks = s.ws!.tasks.filter(t => !t.recordId || !set.has(t.recordId));
      if (s.drawerRecordId && set.has(s.drawerRecordId)) s.drawerRecordId = null;
    });
    toast(`Удалено записей: ${ids.length} — Ctrl+Z, чтобы вернуть`);
  },
  deleteRecord(recId: string) {
    pushHistory();
    mut(s => {
      s.ws!.records = s.ws!.records.filter(r => r.id !== recId);
      s.ws!.tasks = s.ws!.tasks.filter(t => t.recordId !== recId);
      if (s.drawerRecordId === recId) s.drawerRecordId = null;
    });
    toast("Запись удалена — Ctrl+Z, чтобы вернуть");
  },
  addComment(recId: string, text: string) { mut(s => pushAct(recId, "comment", text, s.currentUserId)); },
  addTask(recId: string | undefined, title: string, kind: Task["kind"], dueOffsetH: number) {
    mut(s => {
      const r = recId ? recById(recId) : undefined;
      s.ws!.tasks.push({ id: uid("t"), title, kind, recordId: recId, ownerId: r?.ownerId ?? s.currentUserId, due: now() + dueOffsetH * 3600000, done: false });
      if (recId) pushAct(recId, "task", `Задача: ${title}`, s.currentUserId);
    });
  },
  toggleTask(taskId: string) {
    mut(s => {
      const t = s.ws!.tasks.find(x => x.id === taskId)!;
      t.done = !t.done; t.doneAt = t.done ? now() : undefined;
      if (t.done && t.recordId) pushAct(t.recordId, "task", `Задача выполнена: ${t.title}`, s.currentUserId);
    });
  },

  // конструктор
  addEntity(name: string, namePlural: string, icon: string, withPipeline: boolean): string {
    let eid = "";
    mut(s => {
      const f: Field = { id: uid("f"), label: "Название", type: "text", required: true, inTable: true };
      const e: Entity = {
        id: uid("e"), name, namePlural, icon, color: "#BC9F5C",
        fields: [f], titleFieldId: f.id,
        pipeline: withPipeline ? { stages: [
          { id: uid("s"), label: "Новая", color: "#8A8578", kind: "open" },
          { id: uid("s"), label: "В работе", color: "#BC9F5C", kind: "open" },
          { id: uid("s"), label: "Готово", color: "#6E8B4F", kind: "won" },
        ] } : undefined,
        views: withPipeline
          ? [{ id: uid("v"), name: "Канбан", type: "kanban", sort: null }, { id: uid("v"), name: "Таблица", type: "table", sort: null }]
          : [{ id: uid("v"), name: "Таблица", type: "table", sort: null }],
      };
      s.ws!.entities.push(e); eid = e.id;
      s.nav = { page: "entity", entityId: e.id };
      s.checklist.createdEntity = true;
    });
    toast.success(`Раздел «${namePlural}» создан`);
    return eid;
  },
  updateEntity(id: string, patch: Partial<Pick<Entity, "name" | "namePlural" | "icon" | "color">>) {
    mut(() => Object.assign(entityById(id)!, patch));
  },
  deleteEntity(id: string) {
    pushHistory();
    mut(s => {
      s.ws!.entities = s.ws!.entities.filter(e => e.id !== id);
      const ids = new Set(s.ws!.records.filter(r => r.entityId === id).map(r => r.id));
      s.ws!.records = s.ws!.records.filter(r => r.entityId !== id);
      s.ws!.tasks = s.ws!.tasks.filter(t => !t.recordId || !ids.has(t.recordId));
      s.ws!.automations = s.ws!.automations.filter(a => a.entityId !== id);
      if (s.nav.entityId === id) s.nav = { page: "myday" };
    });
    toast("Раздел удалён");
  },
  addField(entityId: string, f: Omit<Field, "id">): Field {
    const nf: Field = { ...f, id: uid("f") };
    mut(s => { entityById(entityId)!.fields.push(nf); s.checklist.addedField = true; });
    toast.success(`Поле «${f.label}» добавлено`);
    return nf;
  },
  updateField(entityId: string, fieldId: string, patch: Partial<Field>) {
    mut(() => { const e = entityById(entityId)!; Object.assign(e.fields.find(f => f.id === fieldId)!, patch); });
  },
  deleteField(entityId: string, fieldId: string) {
    pushHistory();
    mut(s => {
      const e = entityById(entityId)!;
      if (e.titleFieldId === fieldId) return;
      e.fields = e.fields.filter(f => f.id !== fieldId);
      s.ws!.records.forEach(r => { if (r.entityId === entityId) delete r.values[fieldId]; });
    });
  },
  moveField(entityId: string, fieldId: string, dir: -1 | 1) {
    mut(() => {
      const e = entityById(entityId)!; const i = e.fields.findIndex(f => f.id === fieldId);
      const j = i + dir; if (j < 0 || j >= e.fields.length) return;
      [e.fields[i], e.fields[j]] = [e.fields[j], e.fields[i]];
    });
  },
  togglePipeline(entityId: string, on: boolean) {
    mut(s => {
      const e = entityById(entityId)!;
      if (on && !e.pipeline) {
        e.pipeline = { stages: [
          { id: uid("s"), label: "Новая", color: "#8A8578", kind: "open" },
          { id: uid("s"), label: "В работе", color: "#BC9F5C", kind: "open" },
          { id: uid("s"), label: "Готово", color: "#6E8B4F", kind: "won" },
        ] };
        const first = e.pipeline.stages[0].id;
        s.ws!.records.forEach(r => { if (r.entityId === entityId && !r.stageId) { r.stageId = first; r.stageAt = now(); } });
        if (!e.views.some(v => v.type === "kanban")) e.views.push({ id: uid("v"), name: "Канбан", type: "kanban", sort: null });
      } else if (!on && e.pipeline) {
        e.pipeline = undefined;
        e.views = e.views.filter(v => v.type !== "kanban");
        if (e.views.length === 0) e.views.push({ id: uid("v"), name: "Таблица", type: "table", sort: null });
        if (s.activeView[entityId] && !e.views.some(v => v.id === s.activeView[entityId])) s.activeView[entityId] = e.views[0].id;
      }
    });
  },
  addStage(entityId: string, label: string) {
    mut(() => {
      const e = entityById(entityId)!;
      if (!e.pipeline) e.pipeline = { stages: [] };
      const openIdx = e.pipeline.stages.filter(x => x.kind === "open").length;
      e.pipeline.stages.splice(openIdx, 0, { id: uid("s"), label, color: "#8A8578", kind: "open" });
    });
  },
  updateStage(entityId: string, stageId: string, patch: Partial<Stage>) {
    mut(() => Object.assign(entityById(entityId)!.pipeline!.stages.find(s => s.id === stageId)!, patch));
  },
  deleteStage(entityId: string, stageId: string) {
    mut(s => {
      const e = entityById(entityId)!;
      if (e.pipeline!.stages.length <= 2) return;
      e.pipeline!.stages = e.pipeline!.stages.filter(x => x.id !== stageId);
      const first = e.pipeline!.stages[0].id;
      s.ws!.records.forEach(r => { if (r.entityId === entityId && r.stageId === stageId) r.stageId = first; });
    });
  },
  moveStagePos(entityId: string, stageId: string, dir: -1 | 1) {
    mut(() => {
      const stages = entityById(entityId)!.pipeline!.stages;
      const i = stages.findIndex(s => s.id === stageId); const j = i + dir;
      if (j < 0 || j >= stages.length) return;
      [stages[i], stages[j]] = [stages[j], stages[i]];
    });
  },
  addView(entityId: string, type: View["type"], name: string, dateFieldId?: string) {
    mut(s => {
      const v: View = { id: uid("v"), name, type, dateFieldId, sort: null };
      entityById(entityId)!.views.push(v);
      s.activeView[entityId] = v.id;
    });
  },
  updateView(entityId: string, viewId: string, patch: Partial<View>) {
    mut(() => Object.assign(entityById(entityId)!.views.find(v => v.id === viewId)!, patch));
  },
  deleteView(entityId: string, viewId: string) {
    mut(s => {
      const e = entityById(entityId)!;
      if (e.views.length <= 1) return;
      e.views = e.views.filter(v => v.id !== viewId);
      if (s.activeView[entityId] === viewId) s.activeView[entityId] = e.views[0].id;
    });
  },

  toggleAutomation(id: string) { mut(s => { const a = s.ws!.automations.find(x => x.id === id)!; a.enabled = !a.enabled; }); },
  addAutomation(a: Omit<Automation, "id" | "fired">) {
    mut(s => s.ws!.automations.push({ ...a, id: uid("au"), fired: 0 }));
    toast.success("Автоматизация создана и включена");
  },
  deleteAutomation(id: string) { mut(s => { s.ws!.automations = s.ws!.automations.filter(a => a.id !== id); }); },
  addWidget(w: Omit<Widget, "id">) { mut(s => s.ws!.widgets.push({ ...w, id: uid("w") })); },
  deleteWidget(id: string) { mut(s => { s.ws!.widgets = s.ws!.widgets.filter(w => w.id !== id); }); },
  renameWorkspace(name: string) { mut(s => { s.ws!.name = name; }); },
  setTheme(t: "light" | "dark") { mut(s => { s.theme = t; }); },
  setAi(cfg: { baseUrl: string; apiKey: string; model: string }) { mut(s => { s.ws!.ai = cfg; }); },

  // ---------- инбокс (имитация мессенджеров) ----------
  openChat(id: string | null) {
    mut(s => {
      s.nav = { page: "inbox" }; s.activeChatId = id;
      if (id) { const c = s.ws!.chats.find(x => x.id === id); if (c) c.unread = 0; }
    });
  },
  chatSend(chatId: string, text: string) {
    mut(s => {
      const c = s.ws!.chats.find(x => x.id === chatId)!;
      c.msgs.push({ id: uid("m"), ts: now(), out: true, text });
      if (c.recordId) pushAct(c.recordId, "comment", `→ ${channelName(c.channel)}: ${text}`, s.currentUserId);
    });
  },
  chatIncoming(chatId: string | null, text: string, newChat?: { name: string; channel: "tg" | "wa" | "max"; phone?: string }) {
    mut(s => {
      let c = chatId ? s.ws!.chats.find(x => x.id === chatId) : undefined;
      if (!c && newChat) {
        c = { id: uid("c"), name: newChat.name, phone: newChat.phone, channel: newChat.channel, unread: 0, msgs: [] };
        s.ws!.chats.unshift(c);
      }
      if (!c) return;
      c.msgs.push({ id: uid("m"), ts: now(), out: false, text });
      if (s.activeChatId !== c.id || s.nav.page !== "inbox") c.unread++;
      if (c.recordId) pushAct(c.recordId, "comment", `${channelName(c.channel)}, клиент: ${text}`);
      s.ws!.notices.unshift({ id: uid("n"), ts: now(), text: `${c.name} (${channelName(c.channel)}): ${text}`, icon: "💬" });
    });
    toast("Новое сообщение в инбоксе", { description: text.slice(0, 60) });
  },
  intPatch(fn: (i: Integrations) => void) {
    mut(s => { if (!s.ws!.integrations) s.ws!.integrations = defaultIntegrations(); fn(s.ws!.integrations); });
  },
  setAutoLead(v: boolean) { mut(s => { s.ws!.integrations!.autoLead = v; }); },
  chatIncomingExt(ext: { tg?: number; wa?: string }, name: string, channel: Channel, text: string, phone?: string): string {
    let id = "";
    mut(s => {
      const c = { id: uid("c"), name, phone, channel, unread: 1, msgs: [{ id: uid("m"), ts: now(), out: false, text }], ext };
      s.ws!.chats.unshift(c); id = c.id;
      s.ws!.notices.unshift({ id: uid("n"), ts: now(), text: `${name} (${channelName(channel)}): ${text}`, icon: "💬" });
    });
    toast(`Новый диалог: ${name}`, { description: text.slice(0, 60) });
    return id;
  },
  tildaLead(fields: Record<string, string>) {
    const e = st.ws!.entities.find(x => x.pipeline) ?? st.ws!.entities[0];
    if (!e) return;
    const low = (k: string) => k.toLowerCase();
    const findVal = (keys: string[]) => Object.entries(fields).find(([k]) => keys.some(kk => low(k).includes(kk)))?.[1];
    const name = findVal(["name", "имя", "фио", "fio"]);
    const phone = findVal(["phone", "тел"]);
    const email = findVal(["email", "e-mail", "почта"]);
    const values: Record<string, unknown> = { [e.titleFieldId]: name || "Заявка с Tilda" };
    const phoneF = e.fields.find(f => f.type === "phone"); if (phoneF && phone) values[phoneF.id] = phone;
    const emailF = e.fields.find(f => f.type === "email"); if (emailF && email) values[emailF.id] = email;
    const srcF = e.fields.find(f => f.type === "select" && f.options?.some(o => /сайт/i.test(o.label)));
    const srcO = srcF?.options?.find(o => /сайт/i.test(o.label));
    if (srcF && srcO) values[srcF.id] = srcO.id;
    const id = A.createRecord(e.id, values, undefined, { source: "Tilda" });
    mut(s => {
      pushAct(id, "auto", `Заявка с Tilda: ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
      s.ws!.notices.unshift({ id: uid("n"), ts: now(), text: `Заявка с Tilda: ${name || phone || "новый лид"}`, icon: "🌐" });
    });
    toast.success("Заявка с Tilda упала в воронку", { description: name || phone || "" });
  },
  chatCreateLead(chatId: string): string | null {
    const c = st.ws!.chats.find(x => x.id === chatId);
    const e = st.ws!.entities.find(x => x.pipeline);
    if (!c || !e) return null;
    const values: Record<string, unknown> = { [e.titleFieldId]: c.name };
    const phoneF = e.fields.find(f => f.type === "phone");
    if (phoneF && c.phone) values[phoneF.id] = c.phone;
    const want = c.channel === "wa" ? /whatsapp/i : c.channel === "tg" ? /telegram/i : /max/i;
    const srcF = e.fields.find(f => f.type === "select" && f.options?.some(o => want.test(o.label) || /сайт/i.test(o.label)));
    const srcO = srcF?.options?.find(o => want.test(o.label)) ?? srcF?.options?.find(o => /сайт/i.test(o.label));
    if (srcF && srcO) values[srcF.id] = srcO.id;
    const id = A.createRecord(e.id, values, undefined, { source: channelName(c.channel) });
    mut(s => {
      const cc = s.ws!.chats.find(x => x.id === chatId)!;
      cc.recordId = id;
      pushAct(id, "auto", `Лид создан из диалога в ${channelName(c.channel)}`);
    });
    toast.success(`Лид создан в «${e.namePlural}» и связан с диалогом`);
    return id;
  },
};

export const channelName = (ch: "tg" | "wa" | "max") => (ch === "tg" ? "Telegram" : ch === "wa" ? "WhatsApp" : "MAX");

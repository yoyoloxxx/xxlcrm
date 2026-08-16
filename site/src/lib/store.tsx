// Стор живой части сайта. Архитектура «не переделывать»:
// — все изменения данных идут ТОЛЬКО через экшены A.* (на шаге Supabase они станут писать в общую базу);
// — персист изолирован в адаптере `persistence` (localStorage сейчас → Supabase позже);
// — id полей и стадий стабильные строковые — переезд в Postgres сохранит данные как есть.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Field, Rec, Task, Activity } from "./model";
import { uid, now, displayValue } from "./model";
import { ENTITIES, USERS, entityCfg, seed } from "./data";

interface DataState { records: Rec[]; tasks: Task[]; activities: Activity[] }
interface State extends DataState {
  currentUserId: string;
  drawerRecordId: string | null;
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
      return { records: d.records, tasks: d.tasks ?? [], activities: d.activities ?? [] };
    } catch { return null; }
  },
  save(s: DataState) {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, records: s.records, tasks: s.tasks, activities: s.activities })); } catch { /* памяти нет — живём в RAM */ }
  },
  reset() { try { window.localStorage.removeItem(LS_KEY); } catch { /* ignore */ } },
};

const initial = persistence.load() ?? seed();
const st: State = { ...initial, currentUserId: "u1", drawerRecordId: null };

let version = 0;
const listeners = new Set<() => void>();
let saveTimer: number | undefined;
const emit = () => {
  version++;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistence.save(st), 300);
  listeners.forEach(l => l());
};
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
export const userName = (id?: string) => USERS.find(u => u.id === id)?.name ?? "";
export const userById = (id?: string) => USERS.find(u => u.id === id);
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
    pushHistory();
    mut(s => {
      const r = recById(recId)!; if (r.stageId === stageId) return;
      const stage = entityCfg(r.entityId).stages?.find(x => x.id === stageId); if (!stage) return;
      r.stageId = stageId; r.stageAt = now(); r.updatedAt = now();
      pushAct(recId, "stage", `Стадия: ${stage.label}`, s.currentUserId);
    });
  },
  createRecord(entityId: string, values: Record<string, unknown> = {}, stageId?: string): string {
    let id = "";
    mut(s => {
      const e = entityCfg(entityId);
      const r: Rec = {
        id: uid("r"), entityId, num: s.records.filter(x => x.entityId === entityId).length + 1,
        values, ownerId: s.currentUserId, createdAt: now(), updatedAt: now(),
        stageId: stageId ?? e.stages?.[0]?.id, stageAt: now(),
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
    persistence.reset();
    const fresh = seed();
    mut(s => { Object.assign(s, fresh); s.drawerRecordId = null; });
    toast("Демо-данные сброшены к исходным");
  },
};

export { ENTITIES, USERS, entityCfg };

// Память представлений: выбранная вкладка (канбан/таблица/календарь), поиск, сегмент и «Мои»
// у каждого раздела свои и переживают переключение вкладок, переход в другой раздел и перезагрузку.
const KEY = "xxl-views-v1";
import type { Cond } from "./filters";
export interface SavedSeg { id: string; name: string; conds: Cond[] }
export interface ViewState { view: string; q: string; mine: boolean; seg: string; conds: Cond[]; saved: SavedSeg[] }
const DEF: ViewState = { view: "", q: "", mine: false, seg: "all", conds: [], saved: [] };

let map: Record<string, ViewState> = (() => {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, ViewState>; } catch { return {}; }
})();

export const getViewState = (entityId: string): ViewState => {
  const v = { ...DEF, ...(map[entityId] ?? {}) };
  return { ...v, conds: Array.isArray(v.conds) ? v.conds : [], saved: Array.isArray(v.saved) ? v.saved : [] };
};
export function setViewState(entityId: string, patch: Partial<ViewState>) {
  map = { ...map, [entityId]: { ...getViewState(entityId), ...patch } };
  try { window.localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* памяти нет — живём в RAM */ }
}

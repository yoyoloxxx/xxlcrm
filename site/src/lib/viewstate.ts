// Память представлений: выбранная вкладка (канбан/таблица/календарь), поиск, сегмент и «Мои»
// у каждого раздела свои и переживают переключение вкладок, переход в другой раздел и перезагрузку.
const KEY = "xxl-views-v1";
export interface ViewState { view: string; q: string; mine: boolean; seg: string }
const DEF: ViewState = { view: "", q: "", mine: false, seg: "all" };

let map: Record<string, ViewState> = (() => {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, ViewState>; } catch { return {}; }
})();

export const getViewState = (entityId: string): ViewState => ({ ...DEF, ...(map[entityId] ?? {}) });
export function setViewState(entityId: string, patch: Partial<ViewState>) {
  map = { ...map, [entityId]: { ...getViewState(entityId), ...patch } };
  try { window.localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* памяти нет — живём в RAM */ }
}

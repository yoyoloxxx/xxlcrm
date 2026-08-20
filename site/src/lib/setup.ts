// Отметки первичной настройки: что человек уже сделал. Три из четырёх шагов вычисляются
// из состояния, поэтому храним только «структуру трогали» и «чеклист скрыт».
const KEY = "xxl-setup-v1";
type Marks = { structure?: boolean; imported?: boolean; hidden?: boolean; greeted?: boolean };

const read = (): Marks => { try { return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Marks; } catch { return {}; } };
let marks = read();
export const setupMarks = () => marks;
export function markSetup(k: keyof Marks) {
  if (marks[k]) return;
  marks = { ...marks, [k]: true };
  try { window.localStorage.setItem(KEY, JSON.stringify(marks)); } catch { /* памяти нет */ }
}

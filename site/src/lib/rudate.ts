// Русские даты: браузер рисует в native input американский mm/dd/yyyy и починить это со страницы нельзя.
// Поэтому свой разбор: «31.12.2026», «31.12», «3112», «сегодня», «завтра», «пн», «+3», «через неделю».
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONFULL = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const DOW = ["воскрес", "понедельник", "вторник", "сред", "четверг", "пятниц", "суббот"];
const DOWSHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
const today = () => startOfDay(new Date());

/** Дата → «31.12.2026» */
export function fmtRuDate(ts?: unknown): string {
  const n = Number(ts);
  if (!ts || !n || isNaN(n)) return "";
  const d = new Date(n);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
export function fmtRuTime(ts?: unknown): string {
  const n = Number(ts);
  if (!ts || !n || isNaN(n)) return "";
  const d = new Date(n);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Строка (как человек её набрал) → метка времени. null — не разобрал. */
export function parseRuDate(raw: string, base = new Date()): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  const day = (off: number) => startOfDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + off));

  if (/^сегодня$/.test(s)) return day(0);
  if (/^завтра$/.test(s)) return day(1);
  if (/^послезавтра$/.test(s)) return day(2);
  if (/^вчера$/.test(s)) return day(-1);
  // «+3», «-2», «через 3 дня», «через неделю», «через месяц»
  let m = /^([+-])\s*(\d{1,3})$/.exec(s);
  if (m) return day(Number(m[2]) * (m[1] === "-" ? -1 : 1));
  m = /^через (\d{1,3}) ?(д|дн|день|дня|дней)?$/.exec(s);
  if (m) return day(Number(m[1]));
  if (/^через недел/.test(s)) return day(7);
  if (/^через (2|две) недел/.test(s)) return day(14);
  if (/^через месяц$/.test(s)) return startOfDay(new Date(base.getFullYear(), base.getMonth() + 1, base.getDate()));
  // день недели: ближайший будущий
  const dowIdx = DOWSHORT.indexOf(s) >= 0 ? DOWSHORT.indexOf(s) : DOW.findIndex(w => s.startsWith(w));
  if (dowIdx >= 0) { let off = (dowIdx - base.getDay() + 7) % 7; if (off === 0) off = 7; return day(off); }

  // «31 декабря», «31 дек 2026»
  m = /^(\d{1,2}) ?([а-яё]{3,})\.? ?(\d{2,4})?$/.exec(s);
  if (m) {
    const mi = MONFULL.findIndex(x => m![2].startsWith(x));
    if (mi >= 0) return mk(Number(m[1]), mi + 1, m[3] ? Number(m[3]) : base.getFullYear(), base);
  }
  // «31.12.2026», «31/12/26», «31-12», «31.12»
  m = /^(\d{1,2})[.\-/ ](\d{1,2})(?:[.\-/ ](\d{2,4}))?$/.exec(s);
  if (m) return mk(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : base.getFullYear(), base);
  // сплошные цифры: 3112 / 311226 / 31122026
  m = /^(\d{2})(\d{2})(\d{2}|\d{4})?$/.exec(s.replace(/\D/g, ""));
  if (m) return mk(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : base.getFullYear(), base);
  // ISO из вставки буфера
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return mk(Number(m[3]), Number(m[2]), Number(m[1]), base);
  return null;
}

function mk(d: number, mo: number, y: number, base: Date): number | null {
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let year = y;
  // двузначный год: 69–99 — это прошлый век (даты рождения), 00–68 — этот
  if (y < 100) year = y > 68 ? 1900 + y : 2000 + y;
  if (year < 1900 || year > 2200) return null;
  const dt = new Date(year, mo - 1, d, 12);
  if (dt.getDate() !== d || dt.getMonth() !== mo - 1) return null; // 31 февраля
  void base;
  return dt.getTime();
}

/** «чч:мм» → минуты от полуночи */
export function parseRuTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{1,2})[:. ]?(\d{2})?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mi = m[2] ? Number(m[2]) : 0;
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Подсказка под полем: «пт, 31 декабря 2026» — чтобы человек убедился, что понял его правильно */
export function humanDate(ts: number): string {
  const d = new Date(ts);
  const rel = Math.round((startOfDay(d) - today()) / 86400000);
  const near = rel === 0 ? "сегодня" : rel === 1 ? "завтра" : rel === -1 ? "вчера" : rel > 1 && rel < 7 ? `через ${rel} дн.` : rel < 0 ? `${-rel} дн. назад` : "";
  const base = `${DOWSHORT[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  return near ? `${base} · ${near}` : base;
}
export { MON as MONTHS_SHORT };

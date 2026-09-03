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

/** Строка (как человек её набрал) → метка времени. null — не разобрал.
    Выгрузки из amoCRM/Битрикс24/Excel пишут дату со временем: «12.03.2025 14:22», «2025-03-12 14:22:10»,
    ISO «2025-03-12T14:22:10Z». Такие строки тоже понимаем: по умолчанию отдаём ПОЛДЕНЬ дня (поле «дата»),
    а с withTime — точное время (поле «дата и время», «создано в старой CRM»). */
export function parseRuDate(raw: string, base = new Date(), withTime = false): number | null {
  let s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  let time: { h: number; m: number; sec: number } | null = null;
  // ISO с буквой T: «2025-03-12t14:22:10.000z», «2025-03-12t14:22+03:00»
  const iso = /^(\d{4}-\d{1,2}-\d{1,2})t(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) {
    if (iso[5]) {
      // есть зона — это точный момент, переводим в местное время браузера
      const d = new Date(raw.trim());
      if (isNaN(d.getTime())) return null;
      return withTime ? d.getTime() : startOfDay(d);
    }
    s = iso[1];
    time = { h: Number(iso[2]), m: Number(iso[3]), sec: Number(iso[4] ?? 0) };
  } else {
    // «12.03.2025 14:22», «12.03.2025, 14:22:10», «сегодня 18:00», «31 декабря 09:30»
    const m = /^(.+?)[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) { s = m[1]; time = { h: Number(m[2]), m: Number(m[3]), sec: Number(m[4] ?? 0) }; }
  }
  if (time && (time.h > 23 || time.m > 59 || time.sec > 59)) return null;
  const dayTs = parseRuDay(s, base);
  if (dayTs === null || !withTime || !time) return dayTs;
  const d = new Date(dayTs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), time.h, time.m, time.sec).getTime();
}

/** Только день (без времени) — вся прежняя логика разбора «по-человечески». Уже в нижнем регистре. */
function parseRuDay(s: string, base: Date): number | null {
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
  // ISO из буфера или выгрузки: 1990-05-06. Проверяем ПЕРВЫМ — иначе «сплошные цифры» ниже
  // съедали её как 19-90-0506 и день рождения из веб-формы молча пропадал.
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return mk(Number(m[3]), Number(m[2]), Number(m[1]), base);
  // «31.12.2026», «31/12/26», «31-12», «31.12», «6.5.1990»
  m = /^(\d{1,2})[.\-/ ](\d{1,2})(?:[.\-/ ](\d{2,4}))?$/.exec(s);
  if (m) return mk(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0, base);
  // сплошные цифры: 3112 / 311226 / 31122026
  m = /^(\d{2})(\d{2})(\d{2}|\d{4})?$/.exec(s.replace(/\D/g, ""));
  if (m) return mk(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0, base);
  return null;
}

function mk(d: number, mo: number, y: number, base: Date): number | null {
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const build = (year: number) => {
    const dt = new Date(year, mo - 1, d, 12);
    return dt.getDate() === d && dt.getMonth() === mo - 1 ? dt : null;   // 31 февраля не бывает
  };
  if (!y) {
    // год не назвали: берём текущий, а если такой даты в нём нет (29 февраля) — ближайший, где есть
    for (let i = 0; i < 8; i++) { const dt = build(base.getFullYear() + i); if (dt) return dt.getTime(); }
    return null;
  }
  let year = y;
  if (y < 100) {
    // Двузначный год. «27» — это ближайший срок, «68» — год рождения. Правило: берём этот век,
    // но если получается больше чем на пять лет вперёд — значит, речь о прошлом.
    year = 2000 + y;
    if (year - base.getFullYear() > 5) year = 1900 + y;
  }
  if (year < 1900 || year > 2200) return null;
  const dt = build(year);
  return dt ? dt.getTime() : null;
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

// Разбор CSV из реальной жизни: Excel в России сохраняет в windows-1251 с «;», Google Sheets — в UTF-8 с «,».
// Поэтому кодировку и разделитель определяем сами, а не требуем от человека «сохранить правильно».
export function decodeFile(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf).replace(/^\uFEFF/, "");
  const bad = (utf8.match(/\uFFFD/g) ?? []).length;
  if (!bad) return utf8;
  // Настоящий windows-1251 (кириллический Excel) ломается ПОЧТИ НА КАЖДОЙ русской букве —
  // битых мест много и в долях, и в штуках. Несколько битых байтов в честном UTF-8 —
  // не повод объявить весь файл кириллицей: раньше три таких байта превращали базу в кракозябры.
  const ratio = bad / Math.max(1, utf8.length);
  if (bad < 4 || ratio < 0.02) return utf8;
  try { return new TextDecoder("windows-1251").decode(buf).replace(/^\uFEFF/, ""); } catch { return utf8; }
}

export function guessDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find(l => l.trim()) ?? "";
  const count = (ch: string) => (line.match(new RegExp(`\\${ch}`, "g")) ?? []).length;
  const best = [";", ",", "\t", "|"].map(d => [d, count(d)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ";";
}

// Разбор с учётом кавычек и переносов строк внутри ячейки.
// Возвращает и предупреждения: молча проглоченный файл — худший вид ошибки импорта.
export interface ParseResult { rows: string[][]; warnings: string[] }
export function parseCSVReport(text: string, delim = guessDelimiter(text)): ParseResult {
  const warnings: string[] = [];
  const run = (ignoreQuotes: boolean) => {
    const rows: string[][] = [];
    let row: string[] = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += c;
        continue;
      }
      if (c === '"' && !ignoreQuotes) { quoted = true; continue; }
      if (c === delim) { row.push(cell); cell = ""; continue; }
      if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
      // одинокий \r — это перевод строки из «CSV (Macintosh)», а не мусор:
      // раньше такой файл склеивался в одну строку на сотни тысяч символов и вешал вкладку
      if (c === "\r") { if (text[i + 1] === "\n") continue; row.push(cell); rows.push(row); row = []; cell = ""; continue; }
      cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return { rows, unclosed: quoted };
  };
  let r = run(false);
  if (r.unclosed) {
    // где-то забыли закрыть кавычку — иначе весь остаток файла лёг бы в одну ячейку
    warnings.push("В файле есть незакрытая кавычка — прочитал его без учёта кавычек, проверьте примеры значений");
    r = run(true);
  }
  const rows = r.rows.filter(x => x.some(v => v.trim() !== "")).map(x => x.map(v => v.trim()));
  const widths = new Set(rows.map(x => x.length));
  if (widths.size > 1) warnings.push(`Строки разной длины (${[...widths].sort((a, b) => a - b).join(", ")} колонок) — короткие дополню пустыми`);
  return { rows, warnings };
}
export const parseCSV = (text: string, delim = guessDelimiter(text)): string[][] => parseCSVReport(text, delim).rows;

/** Похожа ли первая строка на данные, а не на заголовки (файл без шапки). */
export function looksLikeData(row: string[]): boolean {
  if (!row.length) return false;
  const digits = row.filter(v => /\d/.test(v)).length;
  const phones = row.filter(v => /^\+?[\d\s()\-]{7,}$/.test(v)).length;
  const words = row.filter(v => /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё \-]{1,30}$/.test(v)).length;
  return phones > 0 || (digits >= Math.ceil(row.length / 2) && words < row.length / 2);
}

// Автоподбор поля под колонку: по смыслу заголовка, а не по порядку
export const HEADER_HINTS: { re: RegExp; type: string[]; ids?: string[] }[] = [
  { re: /^(имя|фио|name|клиент|контакт|заголовок|название|title|что)/i, type: ["text"], ids: ["title"] },
  { re: /(телефон|phone|моб|tel|номер)/i, type: ["phone"] },
  { re: /(почта|mail|email|e-mail)/i, type: ["email"] },
  { re: /(сумма|цена|стоим|чек|amount|price|бюджет)/i, type: ["money", "number"] },
  { re: /(дата\s*рожд|рожден|birth|др\b|bday)/i, type: ["date"], ids: ["bday"] },
  { re: /(дедлайн|срок|дата|when|date)/i, type: ["date", "datetime"] },
  { re: /(источник|канал|откуда|source)/i, type: ["select"], ids: ["source"] },
  { re: /(стади|этап|статус|stage|status)/i, type: ["__stage"] },
  { re: /(коммент|заметк|описан|note|comment)/i, type: ["textarea"] },
  { re: /(сайт|url|ссылк|инст|instagram|telegram|vk)/i, type: ["url"] },
  { re: /(ответствен|менеджер|owner|manager)/i, type: ["user"] },
];

/** Число из ячейки: «12 000,50», «1 234», «1,234.56», «50 000 ₽», «(1 200)» — всё это деньги.
    Русский и английский форматы различаем по позиции последнего разделителя. */
export function parseNumCell(raw: string): number | null {
  let s = String(raw).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()]/g, "").replace(/^[-+]/, "");
  s = s.replace(/[^\d.,]/g, "");            // убираем ₽, $, пробелы, NBSP, буквы
  if (!s) return null;
  const lastDot = s.lastIndexOf("."), lastCom = s.lastIndexOf(",");
  const sep = Math.max(lastDot, lastCom);
  let intPart = s, frac = "";
  if (sep >= 0) {
    const tail = s.slice(sep + 1);
    // разделитель дробной части — только если после него 1–2 цифры и он последний
    if (/^\d{1,2}$/.test(tail) && !/[.,]/.test(tail)) { intPart = s.slice(0, sep); frac = tail; }
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!intPart && !frac) return null;
  const n = Number((intPart || "0") + (frac ? "." + frac : ""));
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

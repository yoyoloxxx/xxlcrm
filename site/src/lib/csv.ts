// Разбор CSV из реальной жизни: Excel в России сохраняет в windows-1251 с «;», Google Sheets — в UTF-8 с «,».
// Поэтому кодировку и разделитель определяем сами, а не требуем от человека «сохранить правильно».
export function decodeFile(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  // «кракозябры»: много символов замены → это не UTF-8, а windows-1251 (кириллический Excel)
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 2 || (bad > 0 && bad / Math.max(1, utf8.length) > 0.001)) {
    try { return new TextDecoder("windows-1251").decode(buf); } catch { /* нет декодера — оставляем как есть */ }
  }
  return utf8.replace(/^﻿/, "");
}

export function guessDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find(l => l.trim()) ?? "";
  const count = (ch: string) => (line.match(new RegExp(`\\${ch}`, "g")) ?? []).length;
  const best = [";", ",", "\t", "|"].map(d => [d, count(d)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ";";
}

// Разбор с учётом кавычек и переносов строк внутри ячейки
export function parseCSV(text: string, delim = guessDelimiter(text)): string[][] {
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
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (c === "\r") continue;
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== "")).map(r => r.map(v => v.trim()));
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

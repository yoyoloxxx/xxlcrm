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

// Псевдо-цели импорта: не поля раздела, а «куда ещё может лечь колонка из чужой CRM».
// Их знает диалог импорта и importRecords в сторе; строки — чтобы не тянуть store в csv.ts.
export const IMPORT_TARGETS = {
  stage: "__stage",       // стадия воронки (по названию, через таблицу соответствий)
  created: "__created",   // «Дата создания» из старой CRM → createdAt/updatedAt записи
  closed: "__closed",     // «Дата закрытия» → stageAt (когда сделка попала в текущую стадию)
  owner: "__owner",       // «Ответственный» → ownerId (ищем сотрудника по имени)
  note: "__note",         // «Примечание» → комментарий в хронологию записи
  extId: "__extid",       // «ID» из старой CRM → скрытое поле ext_id, по нему дедуп при повторной загрузке
  relPhone: "__relphone", // телефон КЛИЕНТА в файле сделок → по нему ищем/заводим связанную карточку
} as const;
/** Колонка, которую заголовок велит пропустить (дата изменения и прочее служебное) */
export const IMPORT_SKIP = "__skip";

// Автоподбор поля под колонку: по смыслу заголовка, а не по порядку.
// Порядок важен: первый подходящий хинт побеждает, но если в разделе нет поля нужного типа —
// пробуем следующий (так «Контакт» в сделках уходит в связь, а в клиентах — в имя).
export const HEADER_HINTS: { re: RegExp; type: string[]; ids?: string[]; rel?: RegExp }[] = [
  { re: /^id$|^id\s|внешний\s*id|external/i, type: [IMPORT_TARGETS.extId] },
  { re: /(дата\s*изменен|изменен|modified|updated|кем\s+создан|created by)/i, type: [IMPORT_SKIP] },
  // связь с карточкой клиента: «Основной контакт» (amo), «Клиент», «Контакт»; «Компания» — только если
  // в разделе есть связь с разделом-компаниями, иначе колонка честно остаётся без пары (rel — фильтр по названию раздела-цели)
  { re: /^(компания|организация|company|название компании)$/i, type: ["relation"], rel: /компани|организац|фирм|контрагент|юрлиц/i },
  { re: /^(основной\s+контакт|контакт|контактное\s+лицо|клиент|заказчик|покупатель|customer|contact|client)$|^(имя|название|name)\s+(клиента|контакта|заказчика|покупателя)$/i, type: ["relation"] },
  { re: /^(имя|фио|name|клиент|контакт|заголовок|название|title|что)|фамил|отчеств|full name|полное имя|surname|last name|first name|middle name/i, type: ["text"], ids: ["title"] },
  { re: /(телефон|phone|моб|tel|номер)/i, type: ["phone"] },
  // в разделе нет телефона (сделки), но есть связь с клиентами: «Рабочий телефон» → телефон клиента для связи.
  // Только явные слова: «Номер договора» сюда попадать не должен
  { re: /(телефон|phone|мобильн)/i, type: [IMPORT_TARGETS.relPhone] },
  { re: /(почта|mail|email|e-mail)/i, type: ["email"] },
  { re: /(сумма|цена|стоим|чек|amount|price|бюджет)/i, type: ["money", "number"] },
  { re: /(дата\s*рожд|рожден|birth|др\b|bday)/i, type: ["date"], ids: ["bday"] },
  { re: /(дата\s*создан|создан|created|добавлен)/i, type: [IMPORT_TARGETS.created] },
  { re: /(дата\s*закрыт|закрыт|заверш|closed|close date)/i, type: [IMPORT_TARGETS.closed] },
  { re: /(дедлайн|срок|дата|when|date)/i, type: ["date", "datetime"] },
  { re: /(источник|канал|откуда|source)/i, type: ["select"], ids: ["source"] },
  { re: /(стади|этап|статус|stage|status)/i, type: [IMPORT_TARGETS.stage] },
  { re: /(примеч|заметк|коммент|note|comment|описан)/i, type: [IMPORT_TARGETS.note] },
  { re: /(сайт|url|ссылк|инст|instagram|telegram|vk)/i, type: ["url"] },
  { re: /(ответствен|менеджер|owner|manager|assigned)/i, type: [IMPORT_TARGETS.owner] },
];

/** Порядок частей ФИО при склейке в заголовок: Битрикс отдаёт «Имя;Фамилия;Отчество», а
    склеенное «Пётр Иванов Сергеевич» режет глаз. Собираем «Пётр Сергеевич Иванов» — как в примерах. */
export function namePartRank(header: string): number {
  if (/фамил|surname|last name/i.test(header)) return 2;
  if (/отчеств|middle name/i.test(header)) return 1;
  return 0;
}

/** Синонимы стадий из чужих CRM: amo «Успешно реализовано», Битрикс «Сделка успешна», «Анализ причины провала».
    Сначала проверяем ПРОИГРЫШ: «Закрыто и не реализовано» иначе попадало бы в «реализ» = успех. */
export function guessStageKind(label: string): "won" | "lost" | "new" | null {
  const s = label.toLowerCase();
  if (/не реализ|провал|отказ|проигр|lost|закрыт.*не реализ|анализ причины|не успеш|неудач|срыв/.test(s)) return "lost";
  if (/успеш|реализ|оплач|выигр|won|закрыт.*успеш|сделка успешна|получен|выполнен|завершен/.test(s)) return "won";
  if (/новая|новый|первичн|неразобр|new|входящ/.test(s)) return "new";
  return null;
}

/** Подобрать стадию раздела под значение из файла: точное имя → синонимы → часть названия.
    null — не нашли (диалог предложит создать стадию с таким названием). */
export function matchStage<S extends { id: string; label: string; kind: string }>(value: string, stages: S[]): S | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!v) return null;
  const exact = stages.find(s => s.label.trim().toLowerCase() === v);
  if (exact) return exact;
  const kind = guessStageKind(v);
  if (kind === "won" || kind === "lost") return stages.find(s => s.kind === kind) ?? null;
  if (kind === "new") return stages.find(s => s.kind === "open") ?? null;
  // «Согласование договора» ↔ «Договор»: одно название целиком входит в другое
  const part = stages.find(s => { const l = s.label.trim().toLowerCase(); return l.length >= 4 && (v.includes(l) || l.includes(v)); });
  return part ?? null;
}

/** Число из ячейки: «12 000,50», «1 234», «1,234.56», «50 000 ₽», «(1 200)», «1,5E+09», «5 000-» (1С), «−5 000».
    Русский и английский форматы различаем по позиции последнего разделителя. */
export function parseNumCell(raw: string): number | null {
  let s = String(raw).trim().replace(/\u2212|\u2013|\u2014/g, "-");   // типографский минус из Excel и Word
  if (!s) return null;
  // 1С и некоторые выгрузки ставят минус В КОНЦЕ: «5 000-»
  const trailingNeg = /-\s*$/.test(s);
  const neg = trailingNeg || /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()]/g, "").replace(/^[-+]/, "").replace(/-\s*$/, "");
  // экспоненциальная запись: Excel показывает большие числа как 1,09E+09 — раньше читалось как «109»
  const exp = /^([\d\s.,]+)[eE]\s*([+-]?\d+)$/.exec(s);
  const expPow = exp ? Number(exp[2]) : 0;
  if (exp) s = exp[1];
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
  let n = Number((intPart || "0") + (frac ? "." + frac : ""));
  if (isNaN(n)) return null;
  if (expPow) n = n * Math.pow(10, expPow);
  return neg ? -n : n;
}

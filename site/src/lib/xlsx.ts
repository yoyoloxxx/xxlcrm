// Чтение XLSX без библиотек: файл Excel — это zip с XML внутри. Распаковка — встроенным в браузер
// DecompressionStream, разбор — DOMParser. Библиотека SheetJS весила бы ещё 400 КБ в одном файле
// приложения, а нужен только первый лист таблицы в виде строк — ровно то, что умеет CSV-импорт.
// Старый бинарный .xls (Excel 97–2003) сюда не входит — он пересохраняется в .xlsx или CSV.

type Entry = { name: string; method: number; compSize: number; offset: number };

const SIG_EOCD = 0x06054b50, SIG_CD = 0x02014b50, SIG_LOCAL = 0x04034b50;

function entries(u8: Uint8Array): Entry[] {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65_557); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("это не zip/xlsx");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== SIG_CD) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("браузер не умеет распаковывать zip — обновите его или сохраните файл как CSV");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(u8: Uint8Array, e: Entry): Promise<string> {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(e.offset, true) !== SIG_LOCAL) throw new Error("повреждённый zip");
  const nameLen = dv.getUint16(e.offset + 26, true), extraLen = dv.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const raw = u8.subarray(start, start + e.compSize);
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
  if (!bytes) throw new Error("неизвестное сжатие внутри xlsx");
  return new TextDecoder("utf-8").decode(bytes);
}

const xml = (text: string) => new DOMParser().parseFromString(text, "application/xml");
const tags = (doc: Document | Element, name: string) => Array.from(doc.getElementsByTagNameNS("*", name));
const firstTag = (doc: Document | Element, name: string) => doc.getElementsByTagNameNS("*", name)[0] ?? null;

// «AB» → 27; ссылка ячейки «AB12» → колонка 27 (нумерация с 0 → 26)
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

// Встроенные числовые форматы Excel, которые означают дату/время
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = (code: string) => /[dmyh]/i.test(code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, ""));

// стиль ячейки (индекс в cellXfs) → это дата? и есть ли в формате время
function dateStyles(stylesXml: string | null): { date: boolean; time: boolean }[] {
  if (!stylesXml) return [];
  const doc = xml(stylesXml);
  const custom = new Map<number, string>();
  for (const f of tags(doc, "numFmt")) custom.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "");
  const xfs = firstTag(doc, "cellXfs");
  if (!xfs) return [];
  return tags(xfs, "xf").map(xf => {
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    const code = custom.get(id);
    const date = code !== undefined ? isDateFormat(code) : BUILTIN_DATE.has(id);
    const time = code !== undefined ? /[hs]/i.test(code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "")) : (id >= 18 && id <= 22) || (id >= 45 && id <= 47);
    return { date, time };
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
// порядковый номер дня Excel → «12.03.2025» или «12.03.2025 14:22»
function serialToText(serial: number, withTime: boolean, epoch1904: boolean): string {
  const base = epoch1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86_400_000);
  const d = new Date(base + ms);
  const day = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  if (!withTime || serial % 1 === 0) return day;
  return `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
// число из XML → текст без плавающего мусора: 1.1000000000000001 → 1.1, 7.9261234567E10 → 79261234567
const numText = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return String(Number(n.toPrecision(15)));
};

/** Первый лист книги → строки таблицы (все строки одной ширины, пустые строки выброшены) */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const u8 = new Uint8Array(buf);
  const list = entries(u8);
  const byName = new Map(list.map(e => [e.name.replace(/^\//, ""), e]));
  const get = async (name: string) => { const e = byName.get(name); return e ? readEntry(u8, e) : null; };

  // какой лист первый: workbook.xml → r:id → rels → путь; если что-то не так — sheet1.xml
  let sheetPath = "xl/worksheets/sheet1.xml";
  let epoch1904 = false;
  const wb = await get("xl/workbook.xml");
  if (wb) {
    const doc = xml(wb);
    epoch1904 = /^(1|true)$/i.test(firstTag(doc, "workbookPr")?.getAttribute("date1904") ?? "");
    const first = firstTag(doc, "sheet");
    const rid = first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? first?.getAttribute("r:id");
    const rels = await get("xl/_rels/workbook.xml.rels");
    if (rid && rels) {
      const rel = tags(xml(rels), "Relationship").find(r => r.getAttribute("Id") === rid);
      const target = rel?.getAttribute("Target");
      if (target) sheetPath = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    }
  }
  if (!byName.has(sheetPath)) {
    const any = list.map(e => e.name).filter(n => /^xl\/worksheets\/sheet\d*\.xml$/.test(n)).sort()[0];
    if (!any) throw new Error("в файле нет листов");
    sheetPath = any;
  }

  // общие строки: <si><t>…</t></si> либо форматированные куски <si><r><t>…</t></r>…</si>
  const sst = await get("xl/sharedStrings.xml");
  const strings: string[] = sst ? tags(xml(sst), "si").map(si => tags(si, "t").map(t => t.textContent ?? "").join("")) : [];
  const styles = dateStyles(await get("xl/styles.xml"));

  const sheet = xml((await get(sheetPath)) ?? "");
  const rows: string[][] = [];
  let width = 0;
  for (const row of tags(sheet, "row")) {
    const cells: string[] = [];
    let col = 0;
    for (const c of tags(row, "c")) {
      const ref = c.getAttribute("r");
      if (ref) { const ci = colIndex(ref); if (ci >= 0) col = ci; }
      const t = c.getAttribute("t") ?? "";
      let text = "";
      if (t === "inlineStr") text = tags(c, "t").map(x => x.textContent ?? "").join("");
      else {
        const v = firstTag(c, "v")?.textContent ?? "";
        if (t === "s") text = strings[Number(v)] ?? "";
        else if (t === "b") text = v === "1" ? "да" : "нет";
        else if (t === "str" || t === "e" || t === "d") text = v;
        else if (v !== "") {
          const st = styles[Number(c.getAttribute("s") ?? -1)];
          const n = Number(v);
          text = st?.date && Number.isFinite(n) ? serialToText(n, st.time, epoch1904) : numText(v);
        }
      }
      cells[col] = text;
      col++;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    if (cells.some(x => x.trim() !== "")) { rows.push(cells); if (cells.length > width) width = cells.length; }
  }
  for (const r of rows) while (r.length < width) r.push("");
  return rows;
}

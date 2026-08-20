// Клиент шлёт в Supabase ровно те колонки, что перечислены в toRow. Если колонки нет в схеме,
// PostgREST отвечает «Could not find the '<колонка>' column» — и падает НЕ одна строка, а весь
// перенос базы в облако и любое сохранение. Так мы уже потеряли перенос на боевом сайте
// из-за activities.edit_key. Проверка держит мапперы и SQL в одной реальности.
import { readFileSync } from "node:fs";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 300)); };

const cloud = readFileSync(new URL("../src/lib/cloud.ts", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase-init.sql", import.meta.url), "utf8")
  + "\n" + readFileSync(new URL("../supabase-inbound.sql", import.meta.url), "utf8");

// какие колонки объявлены в схеме: create table + alter table add column
function schemaCols(table) {
  const m = sql.match(new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`));
  const out = new Set();
  if (m) for (const raw of m[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("--") || /^(primary key|unique|constraint|foreign key|check)\b/i.test(line)) continue;
    out.add(line.split(/\s+/)[0].replace(/,$/, ""));
  }
  for (const a of sql.matchAll(new RegExp(`alter table public\\.${table} add column if not exists (\\w+)`, "g"))) out.add(a[1]);
  return out;
}

// какие колонки шлёт клиент: строка toRow у нужной таблицы в блоке мапперов
function sentCols(table) {
  const i = cloud.indexOf(`  ${table}: {`);
  if (i < 0) return null;
  const j = cloud.indexOf("toRow:", i);
  if (j < 0) return null;
  const open = cloud.indexOf("=> ({", j);
  const end = cloud.indexOf("}),", j);
  if (open < 0 || end < 0 || open > end) return null;
  const body = cloud.slice(open + 5, end);      // только тело объекта-строки
  return [...body.matchAll(/(?:^|[{,])\s*([a-z_]+):/g)].map(m => m[1]);
}

const TABLES = ["records", "tasks", "activities", "chats", "reply_templates"];
let checked = 0;
for (const t of TABLES) {
  const sent = sentCols(t);
  const have = schemaCols(t);
  ok(`${t}: маппер найден`, !!sent && sent.length > 0, "не разобрал toRow");
  ok(`${t}: таблица есть в SQL`, have.size > 0);
  if (!sent || !have.size) continue;
  const missing = sent.filter(c => !have.has(c));
  ok(`${t}: все колонки из toRow есть в схеме`, missing.length === 0,
    missing.length ? `нет в SQL: ${missing.join(", ")} (шлём ${sent.length})` : `${sent.length} колонок`);
  checked += sent.length;
}
ok("проверено достаточно колонок", checked >= 35, `проверено ${checked}`);

const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

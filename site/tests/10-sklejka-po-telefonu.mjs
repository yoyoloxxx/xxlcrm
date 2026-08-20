// Склейка людей по телефону: «телефон» без цифр не должен приклеивать заявку к чужому клиенту,
// короткий номер — не ключ, а два одинаковых номера ВНУТРИ одного файла должны схлопнуться.
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 200)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));

await p.goto(URL); await p.waitForTimeout(1600); await p.keyboard.press("Escape");

const load = async (path, section = /Клиенты/) => {
  await p.getByRole("button", { name: section }).first().click(); await p.waitForTimeout(400);
  await p.getByRole("button", { name: /Загрузить/ }).first().click(); await p.waitForTimeout(500);
  await p.locator('input[type=file]').setInputFiles(path); await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 60000 });
  await p.waitForTimeout(1500);
};
const clientsOf = (s) => (s?.records ?? []).filter(r => r.entityId === "contacts");

// считаем по именам, а не по разнице чисел: пустой localStorage на старте давал ложный ноль
const names = (s) => clientsOf(s).map(r => Object.values(r.values).map(v => String(v ?? "")).join(" "));
const has = (s, re) => names(s).filter(n => re.test(n)).length;

// ---------- A: одинаковый номер внутри одного файла склеивается ----------
writeFileSync("/tmp/same.csv", "\ufeff" + [
  "Имя;Телефон",
  "Пётр Иванов;+7 916 700-70-70",
  "П. Иванов;8 916 700-70-70",
  "Другой человек;+7 916 800-80-80"].join("\n"));
await load("/tmp/same.csv");
const s1 = await st();
ok("A1 два одинаковых номера в файле дали одну карточку", has(s1, /Иванов/) === 1, names(s1).filter(n => /Иванов/.test(n)).join(" / "));
ok("A2 разный номер — отдельная карточка", has(s1, /Другой человек/) === 1);

// ---------- B: короткий «номер» никого не склеивает ----------
writeFileSync("/tmp/short.csv", "\ufeff" + [
  "Имя;Телефон",
  "Первый Короткий;101",
  "Второй Короткий;102",
  "Третий Короткий;101"].join("\n"));
await load("/tmp/short.csv");
const s2 = await st();
ok("B1 короткие номера не схлопнулись в одного", has(s2, /Короткий/) === 3, names(s2).filter(n => /Короткий/.test(n)).join(" / "));

// ---------- C: пустой телефон не приклеивается ни к кому ----------
writeFileSync("/tmp/empty.csv", "\ufeff" + [
  "Имя;Телефон",
  "Безтелефонный Раз;",
  "Безтелефонный Два;",
  "Безтелефонный Три;—"].join("\n"));
await load("/tmp/empty.csv");
const s3 = await st();
ok("C1 три безтелефонных клиента остались тремя", has(s3, /Безтелефонный/) === 3, names(s3).filter(n => /Безтелефонный/.test(n)).join(" / "));
const one = clientsOf(s3).find(r => Object.values(r.values).includes("Безтелефонный Раз"));
ok("C2 у безтелефонного не появилось чужих данных",
  !!one && !Object.values(one.values).some(v => /\d{3}/.test(String(v))), JSON.stringify(one?.values ?? {}).slice(0, 160));

// ---------- D: ни один диалог не висит на удалённой записи ----------
// (диалог МОЖЕТ быть привязан к сделке — это норма; ненормально, когда запись уже удалена)
const s4 = await st();
const dangling = s4.chats.filter(c => c.recordId && !s4.records.some(r => r.id === c.recordId));
ok("D1 нет диалогов, привязанных к несуществующей записи", dangling.length === 0, dangling.map(c => c.name).join(", "));

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

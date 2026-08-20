// Файлы из реальной жизни: незакрытая кавычка, «CSV (Macintosh)», битые байты в UTF-8,
// файл без шапки, две колонки в одно поле. И подмена направления текста, и имя-«{сумма}».
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

const openImport = async (section = /Клиенты/) => {
  await p.getByRole("button", { name: section }).first().click(); await p.waitForTimeout(400);
  await p.getByRole("button", { name: /Загрузить/ }).first().click(); await p.waitForTimeout(500);
};
const feed = async (path) => { await p.locator('input[type=file]').setInputFiles(path); await p.waitForTimeout(1500); };
const dlgText = () => p.locator('[role=dialog]').innerText();
const close = async () => { await p.keyboard.press("Escape"); await p.waitForTimeout(400); };

await p.goto(URL); await p.waitForTimeout(1600); await p.keyboard.press("Escape");

// ---------- A: незакрытая кавычка не съедает файл ----------
writeFileSync("/tmp/quote.csv", "﻿" + [
  "Имя;Телефон",
  'Анна "лучшая;+7 916 111-11-11',
  "Борис;+7 916 222-22-22",
  "Вера;+7 916 333-33-33"].join("\n"));
await openImport(); await feed("/tmp/quote.csv");
const t1 = await dlgText();
ok("A1 файл прочитан построчно, а не одной ячейкой", /3 строки|3 строк/.test(t1), t1.split("\n").slice(0, 4).join(" | "));
ok("A2 про незакрытую кавычку честно сказано", /незакрытая кавычка/i.test(t1), t1.slice(0, 240).replace(/\n/g, " | "));
await close();

// ---------- B: «CSV (Macintosh)» — концы строк \r ----------
writeFileSync("/tmp/mac.csv", "﻿" + ["Имя;Телефон", "Гена;+7 916 444-44-44", "Дина;+7 916 555-55-55"].join("\r"));
await openImport(); await feed("/tmp/mac.csv");
const t2 = await dlgText();
ok("B1 старый маковский файл разобран по строкам", /2 строки|2 строк/.test(t2), t2.split("\n").slice(0, 4).join(" | "));
await close();

// ---------- C: три битых байта не переключают весь файл на кракозябры ----------
const good = Buffer.from("﻿Имя;Телефон\nЕвгений Петров;+7 916 666-66-66\nЖанна Смирнова;+7 916 777-77-77\n", "utf8");
const broken = Buffer.concat([good, Buffer.from([0xC3, 0x28, 0xA0])]);
writeFileSync("/tmp/broken.csv", broken);
await openImport(); await feed("/tmp/broken.csv");
const t3 = await dlgText();
ok("C1 кириллица осталась кириллицей", /Евгений Петров/.test(t3), t3.slice(0, 240).replace(/\n/g, " | "));
await close();

// ---------- D: файл без шапки не съедает первого клиента ----------
writeFileSync("/tmp/nohead.csv", "﻿" + ["Зоя Первая;+7 916 888-88-88", "Игорь Второй;+7 916 999-99-99"].join("\n"));
await openImport(); await feed("/tmp/nohead.csv");
const t4 = await dlgText();
ok("D1 замечено, что шапки нет", /нет строки заголовков/i.test(t4), t4.slice(0, 240).replace(/\n/g, " | "));
ok("D2 первый клиент остался строкой данных", /2 строки|2 строк/.test(t4), t4.split("\n").slice(0, 4).join(" | "));
await close();

// ---------- E: две колонки не метят в одно поле ----------
writeFileSync("/tmp/dup.csv", "﻿" + ["Имя;Телефон;Мобильный телефон", "Клавдия;+7 916 100-00-01;+7 916 100-00-02"].join("\n"));
await openImport(); await feed("/tmp/dup.csv");
const t5 = await dlgText();
ok("E1 про конфликт колонок сказано", /в одно поле/i.test(t5), t5.slice(0, 260).replace(/\n/g, " | "));
await close();

// ---------- F: подмена направления письма ----------
await p.evaluate(() => {
  const A = window.__xxl?.A;
  return null;
});
writeFileSync("/tmp/bidi.csv", "﻿" + ["Имя;Телефон", "Оплачено ‮50 000‬ руб;+7 916 121-21-21"].join("\n"));
await openImport(); await feed("/tmp/bidi.csv");
await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 60000 });
await p.waitForTimeout(1200);
const stored = JSON.stringify((await st()).records);
ok("F1 управляющие символы направления вырезаны", !/[‪-‮⁦-⁩]/.test(stored),
  (stored.match(/.{0,40}[‪-‮].{0,20}/) ?? [""])[0]);
ok("F2 сам текст сохранился", /Оплачено/.test(stored));

// ---------- G: длинный текст не вешает вкладку ----------
writeFileSync("/tmp/long.csv", "﻿" + ["Имя;Комментарий", "Длинный;" + "текст ".repeat(60000)].join("\n"));
await openImport(); await feed("/tmp/long.csv");
await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 60000 });
await p.waitForTimeout(1500);
const t0 = Date.now();
await p.getByRole("button", { name: "Таблица" }).click().catch(() => {});
await p.waitForTimeout(500);
const rowWithLong = p.locator("table tbody tr").filter({ hasText: "Длинный" }).first();
if (await rowWithLong.count()) { await rowWithLong.locator("td").nth(1).click(); }
await p.waitForTimeout(1500);
const openMs = Date.now() - t0;
ok("G1 карточка с огромным текстом открывается быстро", openMs < 12000, openMs + " мс");
const st2 = await st();
const longest = Math.max(0, ...st2.records.flatMap(r => Object.values(r.values).map(v => String(v ?? "").length)));
ok("G2 в поле не влезает мегабайт", longest <= 20000, String(longest));
const acts = Math.max(0, ...(st2.activities ?? []).map(a => a.text.length));
ok("G3 хроника не хранит полотна", acts <= 260, String(acts));

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

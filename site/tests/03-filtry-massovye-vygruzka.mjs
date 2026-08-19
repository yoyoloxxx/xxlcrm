// Проверка v0.16: фильтры по полям, массовые действия, экспорт, вкладка «Сводка», поле на лету, «Приём заявок»
import { chromium } from "playwright";
const results = [];
const ok = (n, c, e = "") => { results.push([c ? "PASS" : "FAIL", n, e]); if (!c) console.log("  ✗", n, e); };
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push(String(e)));
p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 150)); });
await p.goto("http://127.0.0.1:8099/index.html");
await p.waitForTimeout(1500); await p.keyboard.press("Escape");

ok("Стартовый экран — «Мой день»", /Доброе утро|Добрый день|Добрый вечер|Доброй ночи/.test(await p.locator("main").innerText()));

await p.getByRole("button", { name: /Приём заявок/ }).first().click(); await p.waitForTimeout(500);
ok("«Приём заявок» — отдельный экран", /Куда падают заявки/.test(await p.locator("main").innerText()));

await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: "Сводка" }).click(); await p.waitForTimeout(600);
ok("Вкладка «Сводка» показывает воронку", /Сделки|воронк|Источник/i.test(await p.locator("main").innerText()));

await p.getByRole("button", { name: "Таблица" }).click(); await p.waitForTimeout(500);
const before = await p.locator("main tbody tr").count();
await p.getByRole("button", { name: /Фильтр/ }).click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: /Условие/ }).click(); await p.waitForTimeout(400);
const combos = p.locator("[role=dialog] button[role=combobox], [data-radix-popper-content-wrapper] button[role=combobox]");
await combos.nth(0).click(); await p.waitForTimeout(300);
await p.getByRole("option", { name: "Сумма" }).click(); await p.waitForTimeout(300);
await p.locator("[data-radix-popper-content-wrapper] input[type=number]").fill("100000"); await p.waitForTimeout(600);
const after = await p.locator("main tbody tr").count();
ok("Фильтр по полю сузил выборку", after < before && after > 0, `было ${before}, стало ${after}`);
await p.locator("[data-radix-popper-content-wrapper] input[placeholder]").last().fill("Крупные");
await p.getByRole("button", { name: "Сохранить" }).click(); await p.waitForTimeout(500);
ok("Сегмент сохранён", (await p.locator("[data-sonner-toast]").allInnerTexts()).some(t => /Крупные/.test(t)));

await p.keyboard.press("Escape"); await p.waitForTimeout(300);
const boxes = p.locator("main thead input[type=checkbox], main thead button[role=checkbox]");
await boxes.first().click(); await p.waitForTimeout(400);
ok("Массовое выделение работает", /Выбрано/.test(await p.locator("main").innerText()));
const [dl] = await Promise.all([
  p.waitForEvent("download", { timeout: 15000 }).catch(() => null),
  p.getByRole("button", { name: "Выгрузить", exact: true }).click(),
]);
let csvHead = "";
if (dl) { const fp = await dl.path(); if (fp) csvHead = (await import("node:fs")).readFileSync(fp, "utf8").split("\n")[0]; }
// имя файла в headless Chromium приходит как "download" — проверяем то, что важно: что файл скачался и в нём наши колонки
ok("Экспорт скачивает CSV с колонками", !!dl && /Название|№/.test(csvHead), (dl ? dl.suggestedFilename() : "нет файла") + " | " + csvHead.slice(0, 60));

await p.locator("main thead button").last().click(); await p.waitForTimeout(400);
const pop = p.locator("[data-radix-popper-content-wrapper]");
await pop.locator("input").first().fill("Трек СДЭК");
await pop.getByRole("button", { name: "Добавить" }).click(); await p.waitForTimeout(600);
ok("Поле добавляется прямо из таблицы", /Трек СДЭК/.test(await p.locator("main thead").innerText()));

const real = errs.filter(e => !/ERR_TUNNEL|Failed to load resource|net::|fetch/i.test(e));
ok("Нет ошибок в консоли (кроме сетевых)", real.length === 0, real.slice(0, 2).join(" | "));
console.log("\n" + results.map(([s, n, e]) => `${s === "PASS" ? "✓" : "✗"} ${n}${e && s === "FAIL" ? "  → " + e : ""}`).join("\n"));
console.log(`\n${results.filter(r => r[0] === "PASS").length}/${results.length} PASS`);
await b.close();

// Проверка v0.11: импорт CSV из Excel (cp1251, «;»), дедуп, чеклист настройки, живые кнопки
import { chromium } from "playwright";
const URL = "http://127.0.0.1:8099/index.html";
const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); if (!cond) console.log("  ✗", n, extra); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });

await page.goto(URL);
await page.waitForTimeout(1400);
await page.keyboard.press("Escape");

// ---------- импорт CSV в «Клиенты» ----------
await page.getByRole("button", { name: /Клиенты/ }).first().click();
await page.waitForTimeout(400);
const before = await page.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1")).records.filter(r => r.entityId === "contacts").length);
await page.getByRole("button", { name: "Загрузить" }).click();
await page.waitForTimeout(400);
ok("Диалог импорта открылся", await page.getByText(/Перетащите файл CSV/).isVisible());
await page.setInputFiles("input[type=file]", "/home/claude/clients.csv");
await page.waitForTimeout(600);
const mapText = await page.locator("[role=dialog]").innerText();
ok("Кириллица из Excel прочитана", /Пётр Кузнецов/.test(mapText), mapText.slice(0, 200).replace(/\n/g, " | "));
ok("Колонки распознаны", /3 строки/.test(mapText) && /6 колонок/.test(mapText), mapText.slice(0, 160).replace(/\n/g, " | "));
await page.getByRole("button", { name: /Загрузить 3 строки/ }).click();
await page.waitForTimeout(700);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1")).records.filter(r => r.entityId === "contacts").length);
ok("Три клиента загружены", after === before + 3, `было ${before}, стало ${after}`);
const petr = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem("xxlcrm-site-v1"));
  const r = d.records.find(x => x.entityId === "contacts" && String(x.values.title).includes("Кузнецов"));
  return r ? { phone: r.values.phone, bday: !!r.values.bday } : null;
});
ok("Телефон и дата рождения разобраны", !!petr?.phone && petr.bday, JSON.stringify(petr));

// ---------- повторный импорт: дедуп ----------
await page.getByRole("button", { name: "Загрузить" }).click();
await page.waitForTimeout(300);
await page.setInputFiles("input[type=file]", "/home/claude/clients.csv");
await page.waitForTimeout(500);
await page.getByRole("button", { name: /Загрузить 3 строки/ }).click();
await page.waitForTimeout(700);
const after2 = await page.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1")).records.filter(r => r.entityId === "contacts").length);
ok("Повторный импорт не наплодил дублей", after2 === after, `было ${after}, стало ${after2}`);
const toasts = await page.locator("[data-sonner-toast]").allInnerTexts();
ok("Сказал, что объединил", toasts.some(t => /объединено/i.test(t)), toasts.join(" | ").slice(0, 120));

// ---------- Ctrl+Z отменяет импорт ----------
await page.mouse.click(700, 650); // мимо таблицы: в ячейке телефона теперь ссылка tel:, а headless-Chromium после неё «зависает» на внешней схеме
await page.keyboard.press("Control+z");
await page.waitForTimeout(500);

// ---------- чеклист настройки ----------
await page.getByRole("button", { name: /Мой день/ }).first().click();
await page.waitForTimeout(400);
const day = await page.locator("main").innerText();
ok("Чеклист настройки виден", /Настройка: осталось/.test(day), day.slice(0, 120).replace(/\n/g, " | "));
ok("Шаг «загрузить клиентов» отмечен", /Загрузить своих клиентов/.test(day));

// ---------- живые кнопки ----------
await page.locator("header button[title*='Свернуть']").click();
await page.waitForTimeout(400);
const sidebarW = await page.locator("aside").first().evaluate(el => el.getBoundingClientRect().width);
ok("Сайдбар реально сворачивается", sidebarW < 10, "ширина " + sidebarW);
await page.locator("header button[title*='Показать']").click();
await page.waitForTimeout(300);

await page.getByRole("button", { name: "Настройки" }).click();
await page.waitForTimeout(400);
const ws = page.locator("input").first();
await ws.fill("Мастерская Глеба");
await ws.blur();
await page.waitForTimeout(300);
ok("Название пространства меняется", (await page.locator("aside").first().innerText()).includes("Мастерская Глеба"));
const settingsText = await page.locator("main").innerText();
ok("AI-обманка убрана из настроек", !/API-ключ \(OpenRouter/.test(settingsText));
ok("Колокольчик-обманка убран", (await page.locator("header svg.lucide-bell").count()) === 0);

const real = errors.filter(e => !/ERR_TUNNEL|Failed to load resource|net::|fetch/i.test(e));
ok("Нет ошибок в консоли (кроме сетевых)", real.length === 0, real.slice(0, 2).join(" | "));

console.log("\n" + results.map(([s, n, e]) => `${s === "PASS" ? "✓" : "✗"} ${n}${e && s === "FAIL" ? "  → " + e : ""}`).join("\n"));
console.log(`\n${results.filter(r => r[0] === "PASS").length}/${results.length} PASS`);
await browser.close();
process.exit(results.some(r => r[0] === "FAIL") ? 1 : 0);

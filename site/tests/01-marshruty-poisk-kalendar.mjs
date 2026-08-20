// Проверка v0.10: маршруты приёма, палитра, память представлений, живой календарь, целостность
import { chromium } from "playwright";

const URL = "http://127.0.0.1:8099/index.html";
const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); if (!cond) console.log("  ✗", n, extra); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

await page.goto(URL);
await page.waitForTimeout(1200);
await page.keyboard.press("Escape"); // на случай онбординга

// ---------- T1: маршруты видны в настройках ----------
await page.getByRole("button", { name: "Настройки" }).click();
await page.waitForTimeout(400);
ok("Настройки: блок «Куда падают заявки»", await page.getByText("Куда падают заявки", { exact: true }).isVisible());
const tgRow = page.locator("[data-route=tg]");
ok("Маршрут Telegram виден", await tgRow.isVisible());

// меняем стадию маршрута Telegram на «Квалификация» и ответственного
const selects = tgRow.locator("button[role=combobox]");
ok("У маршрута 3 селекта", (await selects.count()) === 3, String(await selects.count()));
await selects.nth(1).click();
await page.waitForTimeout(250);
await page.getByRole("option", { name: "Квалификация" }).click();
await page.waitForTimeout(300);

// ---------- T2: диалог → заявка по маршруту ----------
await page.getByRole("button", { name: /Входящие/ }).first().click();
await page.waitForTimeout(400);
ok("Во Входящих есть подсказка маршрута", await page.getByText(/новые →/).first().isVisible());
await page.getByRole("button", { name: /Новый клиент \(демо\)/ }).click();
await page.waitForTimeout(300);
const createBtn = page.getByRole("button", { name: "+ Сделка", exact: true });
ok("Кнопка называет раздел маршрута", await createBtn.isVisible());
await createBtn.click();
await page.waitForTimeout(600);
const toast = await page.locator("[data-sonner-toast]").first().innerText().catch(() => "");
ok("Тост говорит куда упало", /Квалификация/.test(toast), toast.replace(/\n/g, " | "));

// запись реально в нужной стадии
const stage = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("xxlcrm-site-v1"));
  const r = raw.records.filter(x => x.entityId === "deals").slice(-1)[0];
  return r?.stageId;
});
ok("Запись создана в стадии s_qual", stage === "s_qual", String(stage));
const clientMade = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("xxlcrm-site-v1"));
  return raw.records.filter(x => x.entityId === "contacts").length;
});
ok("Карточка клиента заведена (было 4)", clientMade >= 5, "контактов: " + clientMade);

// ---------- T3: переписка в карточке записи ----------
await page.waitForTimeout(300);
await page.keyboard.press("Control+k");            // открыть созданную запись через палитру
await page.waitForTimeout(250);
await page.getByPlaceholder(/Клиент, заказ, сообщение/).fill("Новый клиент");
await page.waitForTimeout(400);
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
ok("В карточке есть блок «Переписка»", /переписка ·/i.test(await page.locator("aside").last().innerText().catch(() => "")));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ---------- T4: палитра Ctrl+K ----------
await page.keyboard.press("Control+k");
await page.waitForTimeout(300);
ok("Палитра открылась", await page.getByPlaceholder(/Клиент, заказ, сообщение/).isVisible());
await page.getByPlaceholder(/Клиент, заказ, сообщение/).fill("аналитик");
await page.waitForTimeout(400);
const palText = await page.locator("div.max-h-\\[52vh\\]").innerText();
ok("Палитра нашла лендинг", /Лендинг курса аналитики/i.test(palText), palText.slice(0, 120).replace(/\n/g, " | "));
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
ok("Enter открыл карточку", await page.getByText("Хронология").isVisible());
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// поиск по тексту сообщения находит диалог
await page.keyboard.press("Control+k");
await page.waitForTimeout(250);
await page.getByPlaceholder(/Клиент, заказ, сообщение/).fill("автосервис");
await page.waitForTimeout(350);
ok("Палитра ищет по сообщениям", /диалоги/i.test(await page.locator("div.max-h-\\[52vh\\]").innerText()));
await page.keyboard.press("Escape");

// ---------- T5: календарь живой ----------
await page.getByRole("button", { name: /Сделки/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Календарь" }).click();
await page.waitForTimeout(500);
const calText = await page.locator("main").innerText();
ok("Календарь показывает реальный месяц", /2026/.test(calText) && /событий/.test(calText), calText.slice(0, 80).replace(/\n/g, " | "));
ok("В календаре есть события", !/0 событий/.test(calText), calText.slice(0, 60).replace(/\n/g, " | "));

// ---------- T6: память представлений ----------
await page.getByPlaceholder("Поиск в разделе…").fill("лендинг");
await page.waitForTimeout(400);
await page.getByRole("button", { name: /Клиенты/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: /Сделки/ }).first().click();
await page.waitForTimeout(400);
ok("Вкладка «Календарь» запомнилась", await page.locator("main").innerText().then(t => /событ/.test(t)));
ok("Поиск в разделе запомнился", (await page.getByPlaceholder("Поиск в разделе…").inputValue()) === "лендинг");
await page.reload();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /Сделки/ }).first().click();   // приложение теперь открывается на «Моём дне»
await page.waitForTimeout(500);
ok("После перезагрузки вкладка и фильтр на месте", (await page.getByPlaceholder("Поиск в разделе…").inputValue()) === "лендинг");
await page.getByPlaceholder("Поиск в разделе…").fill("");

// ---------- T7: целостность — удаляем стадию, на которую смотрит маршрут ----------
await page.getByRole("button", { name: "Настроить раздел" }).click();
await page.waitForTimeout(400);
ok("Конструктор показывает зависимости", await page.getByText(/Сюда завязано/).isVisible());
await page.getByRole("tab", { name: "Стадии" }).click();
await page.waitForTimeout(300);
const qualRow = page.locator("div").filter({ hasText: /^Квалификация$/ }).last();
await qualRow.scrollIntoViewIfNeeded().catch(() => {});
const delBtns = page.locator("[role=dialog] button:has(svg.lucide-trash2)");
await delBtns.nth(1).click(); // вторая стадия — Квалификация
await page.waitForTimeout(400);
await page.locator("[role=dialog] button", { hasText: /^да$/ }).first().click();   // удаление теперь спрашивает подтверждение
await page.waitForTimeout(700);
const toasts = await page.locator("[data-sonner-toast]").allInnerTexts();
ok("Сказал, что подстроил настройки", toasts.some(t => /подстроен/i.test(t)), toasts.join(" | ").slice(0, 160));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const routeStage = await page.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1")).routes.find(r => r.source === "tg").stageId);
ok("Маршрут больше не ссылается на удалённую стадию", !routeStage, String(routeStage));

const real = errors.filter(e => !/ERR_TUNNEL|Failed to load resource|net::|fetch/i.test(e)); // в песочнице нет сети: Supabase и шрифты не грузятся
ok("Нет ошибок в консоли (кроме сетевых)", real.length === 0, real.slice(0, 3).join(" | "));

console.log("\n" + results.map(([s, n, e]) => `${s === "PASS" ? "✓" : "✗"} ${n}${e && s === "FAIL" ? "  → " + e : ""}`).join("\n"));
console.log(`\n${results.filter(r => r[0] === "PASS").length}/${results.length} PASS`);
await browser.close();
process.exit(results.some(r => r[0] === "FAIL") ? 1 : 0);

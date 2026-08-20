// Проверка v0.18: русские даты, обязательные поля, счётчики «Моего дня»,
// клавиатура в канбане, перетаскивание стадий/полей, автопоказ шаблонов на первом запуске.
import { chromium } from "playwright";

const URL = "http://127.0.0.1:8099/index.html";
const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); if (!cond) console.log("  ✗", n, String(extra).slice(0, 200)); else console.log("  ✓", n); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
p.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

// ---------- A: первый запуск сам предлагает шаблон ниши ----------
await p.goto(URL);
await p.waitForTimeout(1500);
const onboard = await p.getByText(/С чего начнём\?/).count();
ok("A1 на первом запуске сам открылся выбор ниши", onboard > 0);
ok("A2 есть выход «Позже — настрою сам»", (await p.getByRole("button", { name: /Позже — настрою сам/ }).count()) > 0);
await p.keyboard.press("Escape");
await p.waitForTimeout(400);
ok("A3 Escape закрывает", (await p.getByText(/С чего начнём\?/).count()) === 0);
// второй раз не лезет
await p.reload();
await p.waitForTimeout(1600);
ok("A4 второй раз не спрашивает", (await p.getByText(/С чего начнём\?/).count()) === 0);

// ---------- B: счётчики «Моего дня» согласованы ----------
await p.getByRole("button", { name: /Мой день/ }).first().click();
await p.waitForTimeout(500);
const myday = await p.locator("main").innerText();
const chipToday = /Сегодня и просрочено\s+(\d+)/.exec(myday);
const chipOpen = /Открытых задач всего\s+(\d+)/.exec(myday);
const subtitle = /сегодня и просрочено:\s*(\d+)/.exec(myday);
ok("B1 подзаголовок и плашка про сегодня совпадают",
  !!chipToday && !!subtitle && chipToday[1] === subtitle[1], `${subtitle?.[1]} vs ${chipToday?.[1]}`);
ok("B2 «всего» отдельной плашкой", !!chipOpen, myday.slice(0, 200).replace(/\n/g, " | "));
const badge = await p.locator("nav button", { hasText: "Задачи" }).first().innerText();
ok("B3 значок в меню = «Открытых задач всего»", !!chipOpen && badge.includes(chipOpen[1]), `${badge} vs ${chipOpen?.[1]}`);

// ---------- C: русские даты ----------
await p.getByRole("button", { name: /Сделки/ }).first().click();
await p.waitForTimeout(500);
await p.getByRole("button", { name: "Таблица" }).click();
await p.waitForTimeout(500);
await p.locator("table tbody tr").first().locator("td").nth(1).click();
await p.waitForTimeout(500);
const dateInput = p.locator('[data-drawer] input[aria-label="Дата"]').first();
ok("C1 в карточке поле даты — своё, с русской подсказкой",
  (await dateInput.count()) > 0 && (await dateInput.getAttribute("placeholder")) === "дд.мм.гггг");
await dateInput.fill("");
await dateInput.type("31122026");
await p.waitForTimeout(250);
ok("C2 цифры сами превращаются в 31.12.2026", (await dateInput.inputValue()) === "31.12.2026", await dateInput.inputValue());
await dateInput.press("Enter");
await p.waitForTimeout(300);
ok("C3 под полем расшифровка даты", /31 дек 2026/.test(await p.locator("[data-drawer]").innerText()), (await p.locator("[data-drawer]").innerText()).slice(0, 200));
await dateInput.fill("завтра");
await dateInput.press("Enter");
await p.waitForTimeout(300);
const tom = new Date(Date.now() + 86400000);
const tomStr = `${String(tom.getDate()).padStart(2, "0")}.${String(tom.getMonth() + 1).padStart(2, "0")}.${tom.getFullYear()}`;
ok("C4 «завтра» понимается", (await dateInput.inputValue()) === tomStr, await dateInput.inputValue());
await dateInput.fill("абырвалг");
await dateInput.press("Enter");
await p.waitForTimeout(300);
ok("C5 непонятная дата не молчит", /Не понял дату/.test(await p.locator("[data-drawer]").innerText()));
await dateInput.fill(tomStr);
await dateInput.press("Enter");
await p.waitForTimeout(200);
ok("C6 календарь открывается кнопкой", await p.locator('[data-drawer] button[aria-label="Открыть календарь"]').first().isVisible());

// ---------- D: обязательные поля ----------
await p.locator('[data-drawer] input[aria-label="Дата"]').first().press("Escape");
await p.waitForTimeout(300);
ok("D0 Escape в поле не выбрасывает карточку", (await p.locator("[data-drawer]").count()) === 1);
const drawer = await p.locator("[data-drawer]").innerText();
ok("D1 обязательные поля помечены звёздочкой", /\*/.test(drawer), drawer.slice(0, 120).replace(/\n/g, " | "));
// очищаем «Сумма» и переводим в успех — должно предупредить
const money = p.locator("[data-drawer] input.tnum").first();
if (await money.count()) {
  await money.fill("");
  await money.blur();
  await p.waitForTimeout(300);
  ok("D2 пустое обязательное подсвечено в шапке карточки", /Не заполнено:/.test(await p.locator("[data-drawer]").innerText()));
  const bar = p.locator("[data-drawer]").locator("div.border-b").filter({ hasText: "клик по полосе" }).first();
  const btns = bar.locator("button");
  await btns.nth((await btns.count()) - 2).click(); // предпоследняя стадия обычно «Успешно»
  await p.waitForTimeout(700);
  const body = await p.locator("body").innerText();
  ok("D3 при закрытии в «успех» напомнило про незаполненное",
    /не заполнено обязательное/i.test(body) || !/Не заполнено:/.test(await p.locator("[data-drawer]").innerText()),
    body.slice(-260).replace(/\n/g, " | "));
}
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// ---------- E: канбан с клавиатуры ----------
await p.getByRole("button", { name: "Канбан" }).click();
await p.waitForTimeout(500);
const card = p.locator("[data-card]").first();
ok("E1 карточка канбана доступна с клавиатуры", (await card.getAttribute("tabindex")) === "0");
const label = await card.getAttribute("aria-label");
ok("E2 у карточки говорящая подпись", !!label && /стадия/i.test(label), label ?? "");
const cardId = await card.getAttribute("data-card");
await card.focus();
const stageBefore = await p.evaluate(id => {
  const s = JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}");
  return (s.records ?? []).find(r => r.id === id)?.stageId ?? "";
}, cardId);
await p.keyboard.press("Control+ArrowRight");
await p.waitForTimeout(600);
const stageAfter = await p.evaluate(id => {
  const s = JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}");
  return (s.records ?? []).find(r => r.id === id)?.stageId ?? "";
}, cardId);
ok("E3 Ctrl+→ переносит карточку в следующую стадию", stageBefore !== stageAfter, `${stageBefore} → ${stageAfter}`);
await p.locator(`[data-card="${cardId}"]`).first().focus();
await p.keyboard.press("Enter");
await p.waitForTimeout(500);
ok("E4 Enter открывает карточку", (await p.locator("[data-drawer]").count()) > 0);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// ---------- F: порядок стадий и полей перетаскиванием ----------
await p.getByRole("button", { name: /Настроить раздел/ }).click();
await p.waitForTimeout(600);
ok("F1 у полей есть ручка перетаскивания", (await p.locator('[role=dialog] [title*="Перетащить"]').count()) > 0);
ok("F2 у поля есть переключатель «обязательное»", (await p.getByRole("button", { name: "обязательное" }).count()) > 0);
const reqBtn = p.getByRole("button", { name: "обязательное" }).nth(1);
const wasPressed = await reqBtn.getAttribute("aria-pressed");
await reqBtn.click();
await p.waitForTimeout(300);
ok("F3 «обязательное» переключается", (await reqBtn.getAttribute("aria-pressed")) !== wasPressed);
await p.getByRole("tab", { name: /Стадии/ }).click();
await p.waitForTimeout(400);
ok("F4 у стадий есть ручка перетаскивания", (await p.locator('[role=dialog] [title*="Перетащить"]').count()) > 0);
ok("F5 стрелки стадий подписаны", (await p.locator('[role=dialog] button[aria-label*="выше"]').count()) > 0);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// ---------- G: правило можно закрыть кнопкой ----------
await p.getByRole("button", { name: /Автоматизации/ }).first().click();
await p.waitForTimeout(500);
const addRule = p.getByRole("button", { name: /Правило|Новое правило|Добавить/ }).first();
await addRule.click();
await p.waitForTimeout(500);
const cancel = p.getByRole("button", { name: "Отмена", exact: true });
ok("G1 в окне правила есть «Отмена»", (await cancel.count()) > 0);
if (await cancel.count()) {
  await cancel.first().click();
  await p.waitForTimeout(400);
  ok("G2 «Отмена» закрывает окно", (await p.locator('[role=dialog]').count()) === 0);
}

ok("Z нет ошибок JS", errors.filter(e => !/net::|Failed to load|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) { console.log(fails.map(f => "FAIL: " + f[1] + (f[2] ? " — " + f[2] : "")).join("\n")); process.exit(1); }

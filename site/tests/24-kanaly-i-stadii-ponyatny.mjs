// v0.28–0.29: (1) панель фильтров не схлопывается в «непонятный ползунок» на средней ширине,
// (2) во вкладке «Стадии» видно и меняется, куда приходят заявки, (3) Instagram — настоящая
// карточка с серверным приёмником, (4) функция hook умеет ig и проверку Meta (hub.challenge),
// (5) у каждого сервиса кликабельная ссылка «куда идти» и список «что сделать, чтобы заявки приходили».
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const URL = "http://127.0.0.1:8099/index.html";
const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); if (!cond) console.log("  ✗", n, extra); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

// ---------- T1: ширина 980 — все фильтры видны, ничего не уползает в обрезок ----------
{
  const ctx = await browser.newContext({ viewport: { width: 980, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("xxl-setup-v1", JSON.stringify({ greeted: true, structure: true })));
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const b = [...document.querySelectorAll("aside button")].find(x => x.textContent?.includes("Клиенты")); b?.click(); });
  await page.waitForTimeout(600);
  const search = page.getByPlaceholder("Поиск в разделе…");
  ok("Поиск в разделе виден целиком", await search.isVisible());
  const box = await search.boundingBox();
  ok("Поиск не обрезан до ползунка", !!box && box.width >= 140, JSON.stringify(box));
  const mine = page.getByRole("button", { name: "Мои", exact: true });
  ok("Кнопка «Мои» видна и в пределах окна", await mine.isVisible() && (await mine.boundingBox()).x + (await mine.boundingBox()).width <= 980);
  ok("Вкладка «Сводка» на месте", await page.getByText("Сводка", { exact: true }).isVisible());
  await ctx.close();
}

// ---------- T2: стадии отвечают «куда приходят заявки» и дают это поменять ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("xxl-setup-v1", JSON.stringify({ greeted: true, structure: true })));
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const b = [...document.querySelectorAll("aside button")].find(x => x.textContent?.includes("Сделки")); b?.click(); });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Настроить раздел" }).click();
  await page.waitForTimeout(400);
  ok("Баннер говорит, в какую стадию падают заявки", (await page.locator("[role=dialog]").textContent()).includes("падают в"));
  await page.getByRole("tab", { name: "Стадии" }).click();
  await page.waitForTimeout(300);
  const intake = page.locator("[data-intake]");
  ok("Во вкладке «Стадии» есть блок «Куда приходят заявки»", await intake.isVisible());
  ok("В блоке перечислены каналы (Telegram)", await intake.locator("[data-intake-src=tg]").isVisible());
  ok("У стадии-приёмника есть бейдж «заявки»", (await page.locator("[role=dialog]").getByTitle(/Сюда падают новые заявки/).count()) > 0);
  // меняем стадию приёма Telegram прямо здесь
  const sel = intake.locator("[data-intake-src=tg] button[role=combobox]");
  await sel.click();
  await page.waitForTimeout(250);
  const opts = page.locator("[role=option]");
  const labels = await opts.allTextContents();
  ok("В выборе стадии — стадии раздела", labels.some(l => /перегово|квалифsika|квалифика/i.test(l)) || labels.length >= 3, labels.join("|"));
  await opts.nth(2).click(); // конкретная стадия (не «первая»)
  await page.waitForTimeout(300);
  const chosen = (await sel.textContent())?.trim();
  ok("Стадия приёма сменилась", !!chosen && !/Первая/.test(chosen), chosen);
  // и это же видно в «Приёме заявок»
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll("aside button")].find(x => x.textContent?.includes("Приём заявок")); b?.click(); });
  await page.waitForTimeout(400);
  const tgRow = page.locator("[data-route=tg]");
  ok("Маршрут Telegram показывает ту же стадию", ((await tgRow.textContent()) ?? "").includes(chosen ?? "###"), await tgRow.textContent());
  await ctx.close();
}

// ---------- T3: Instagram — настоящая карточка, а не «Скоро» ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("xxl-setup-v1", JSON.stringify({ greeted: true, structure: true })));
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Настройки" }).click();
  await page.waitForTimeout(500);
  ok("Карточка Instagram Direct есть", await page.getByText("Instagram Direct").isVisible());
  const body = await page.textContent("body");
  ok("Instagram больше не «через провайдера» в Скоро", !body.includes("Instagram · через провайдера"));
  ok("Без входа карточка честно зовёт в общее пространство", body.includes("войдите в аккаунт"));
  ok("Шаги подключения WhatsApp на месте", body.includes("кабинет Green API") && body.includes("idInstance"));
  ok("Шаги подключения MAX на месте", body.includes("@MasterBot"));
  ok("У каналов есть метка «куда падают»", (await page.locator("button", { hasText: /^→ / }).count()) >= 3);
  ok("В маршрутах нет «нужен провайдера»", !body.includes("нужен провайдер"));

  // ---------- T3b: у каждого сервиса есть кликабельная ссылка «куда идти» ----------
  const link = async (href) => (await page.locator(`a[href^="${href}"]`).count()) > 0;
  ok("Ссылка на @BotFather", await link("https://t.me/BotFather"));
  ok("Ссылка на кабинет Green API", await link("https://console.green-api.com"));
  ok("Ссылка на @MasterBot в MAX", await link("https://max.ru/masterbot"));
  ok("Ссылка на кабинет Meta", await link("https://developers.facebook.com/apps"));
  ok("Ссылка на Тильду", await link("https://tilda.cc/projects"));
  ok("Все внешние ссылки открываются в новой вкладке",
    (await page.locator('a[target="_blank"][rel="noreferrer"]').count()) >= 5);
  ok("Есть список «Что нужно сделать, чтобы заявки приходили»", body.includes("Что нужно сделать, чтобы заявки приходили"));
  ok("Список считает, сколько осталось", /осталось \d из 5/.test(body));
  ok("Каждый канал в списке ведёт к своей карточке", (await page.locator("[data-ch]").count()) >= 6);

  // «вставить сюда» из списка прокручивает к карточке канала и подсвечивает её
  await page.getByRole("button", { name: "вставить сюда" }).nth(2).click(); // MAX
  await page.waitForTimeout(700);
  const maxCard = page.locator('[data-ch="max"]');
  ok("Клик по «вставить сюда» подсвечивает карточку канала", ((await maxCard.getAttribute("style")) ?? "").includes("box-shadow"));
  ok("Карточка канала оказалась в видимой части экрана", await maxCard.isVisible());
  await ctx.close();
}

// ---------- T3c: «не подключён» в «Приёме заявок» ведёт к настройке канала ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("xxl-setup-v1", JSON.stringify({ greeted: true, structure: true })));
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const b = [...document.querySelectorAll("aside button")].find(x => x.textContent?.includes("Приём заявок")); b?.click(); });
  await page.waitForTimeout(500);
  const badge = page.locator('[data-route=wa] button', { hasText: "не подключён" });
  ok("Бейдж «не подключён» — кликабельный", await badge.isVisible());
  await badge.click();
  await page.waitForTimeout(900);
  const waCard = page.locator('[data-ch="wa"]');
  ok("Клик открыл Настройки на карточке WhatsApp", await waCard.isVisible());
  ok("И подсветил её", ((await waCard.getAttribute("style")) ?? "").includes("box-shadow"));
  await ctx.close();
}

// ---------- T4: серверная функция готова к Instagram ----------
{
  const hook = readFileSync("../supabase/functions/hook/index.ts", "utf8");
  ok("hook: версия поднята (0.21+)", /const VERSION = "0\.2[1-9]"/.test(hook));
  ok("hook: источник ig объявлен", /sources: \["tg", "wa", "max", "tilda", "ig"\]/.test(hook));
  ok("hook: проверка Meta возвращает hub.challenge голым текстом", /hub\.challenge/.test(hook) && /new Response\(challenge/.test(hook));
  ok("hook: парсер Instagram пропускает эхо своих сообщений", /parseInstagram/.test(hook) && /is_echo/.test(hook));
  ok("hook: пересыльщик без id не плодит общий диалог", /extKey === undefined/.test(hook));
  ok("hook: форма-фолбэк для ig остаётся", /src === "ig" \? \(parseInstagram\(payload\) \?\? parseForm\(payload\)\)/.test(hook));
}

const bad = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
await browser.close();
if (bad.length) process.exit(1);

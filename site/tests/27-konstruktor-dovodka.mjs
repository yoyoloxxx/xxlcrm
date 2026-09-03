// Доводка конструктора: поля «Да/нет» и «Несколько из списка», телефон как телефон,
// причина отказа при переносе в «Проиграна», объединение дублей по телефону,
// «Очистить примеры» уносит демо-коллег, онбординг «Своя ниша» и своё имя, тач-экран.
// Запуск: cd dist && python3 -m http.server 8096 &  →  NODE_PATH=$(npm root -g) node tests/27-konstruktor-dovodka.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 240)); };
const URL = `http://127.0.0.1:${process.env.PORT || "8099"}/index.html`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const quiet = (page) => page.addInitScript(() => localStorage.setItem("xxl-setup-v1", JSON.stringify({ greeted: true, structure: true })));
const st = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));
const ent = (s, id) => (s.entities ?? []).find(e => e.id === id);
const side = (page, name) => page.evaluate(n => { const b = [...document.querySelectorAll("aside button")].find(x => (x.textContent ?? "").includes(n)); b?.click(); }, name);
const tab = async (page, name) => { await page.getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(400); };
const colIndex = async (page, label) => (await page.locator("main thead th").allInnerTexts()).findIndex(t => t.trim() === label);

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("pageerror", e => errors.push(String(e)));
await quiet(p);
await p.goto(URL); await p.waitForTimeout(1600); await p.keyboard.press("Escape");

// ---------- A: новые типы полей в конструкторе ----------
await side(p, "Клиенты"); await p.waitForTimeout(500);
await p.getByRole("button", { name: "Настроить раздел" }).click(); await p.waitForTimeout(500);
const dlg = p.locator("[role=dialog]");
const addName = dlg.locator("input[placeholder='Название нового поля']");
const addType = () => dlg.locator("button[role=combobox]").last();
await addName.fill("Согласие");
await addType().click(); await p.waitForTimeout(250);
await p.getByRole("option", { name: "Да/нет" }).click(); await p.waitForTimeout(200);
await dlg.getByRole("button", { name: "Добавить" }).click(); await p.waitForTimeout(500);
let s = await st(p);
const cbField = ent(s, "contacts")?.fields.find(f => f.label === "Согласие");
ok("A1 поле «Да/нет» добавляется в конструкторе", cbField?.type === "checkbox", JSON.stringify(cbField));
await addName.fill("Интересы");
await addType().click(); await p.waitForTimeout(250);
await p.getByRole("option", { name: "Несколько из списка" }).click(); await p.waitForTimeout(200);
await dlg.getByRole("button", { name: "Добавить" }).click(); await p.waitForTimeout(500);
s = await st(p);
const msField = ent(s, "contacts")?.fields.find(f => f.label === "Интересы");
ok("A2 поле «Несколько из списка» добавляется со стартовыми вариантами", msField?.type === "multiselect" && (msField.options ?? []).length === 2, JSON.stringify(msField));
// редактор вариантов — тот же, что у обычного списка
const optBtn = dlg.locator("button", { hasText: /^\d+ вар\.$/ }).last();
await optBtn.click(); await p.waitForTimeout(300);
const newOpt = p.locator("[data-radix-popper-content-wrapper] input[placeholder='Новый вариант + Enter']");
await newOpt.fill("Опт"); await newOpt.press("Enter"); await p.waitForTimeout(400);
s = await st(p);
ok("A3 вариант добавляется в multiselect через редактор вариантов", (ent(s, "contacts")?.fields.find(f => f.label === "Интересы")?.options ?? []).some(o => o.label === "Опт"));
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
// тумблеры выключенного состояния — обычный muted, а не /60
const offToggle = dlg.locator("button[aria-pressed=false]", { hasText: /обязательное|таблица/ }).first();
ok("A4 выключенный тумблер без полупрозрачности", !((await offToggle.getAttribute("class")) ?? "").includes("/60"), await offToggle.getAttribute("class"));
await p.keyboard.press("Escape"); await p.waitForTimeout(400);

// ---------- B: таблица — галочка одним кликом, чипы, карточка ----------
const iCb = await colIndex(p, "Согласие");
const iMs = await colIndex(p, "Интересы");
ok("B0 новые колонки видны в таблице", iCb > 0 && iMs > 0, `${iCb} / ${iMs}`);
const row = p.locator("main tbody tr").first();
const rowId = await row.locator("td").nth(1).locator("button").first().innerText();
await row.locator("td").nth(iCb).locator("button[role=checkbox]").click(); await p.waitForTimeout(500);
s = await st(p);
const recA = (s.records ?? []).find(r => r.entityId === "contacts" && r.values.title === rowId.trim());
ok("B1 галочка в ячейке переключает значение в true", recA?.values?.[cbField.id] === true, JSON.stringify(recA?.values));
ok("B2 ячейка показывает «Да»", /Да/.test(await row.locator("td").nth(iCb).innerText()));
await row.locator("td").nth(iMs).click(); await p.waitForTimeout(400);
const chip = p.locator("main tbody [role=group] button[role=checkbox]", { hasText: "Опт" });
ok("B3 клик по ячейке multiselect открывает чипы-варианты", await chip.isVisible());
await chip.click(); await p.waitForTimeout(400);
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
s = await st(p);
const recB = (s.records ?? []).find(r => r.id === recA?.id);
const optId = msField.options.concat(ent(s, "contacts").fields.find(f => f.id === msField.id).options).find(o => o.label === "Опт")?.id;
ok("B4 multiselect хранит массив id вариантов", Array.isArray(recB?.values?.[msField.id]) && recB.values[msField.id].includes(optId), JSON.stringify(recB?.values?.[msField.id]));
ok("B5 в ячейке — чип выбранного варианта", /Опт/.test(await row.locator("td").nth(iMs).innerText()), await row.locator("td").nth(iMs).innerText());
await row.locator("td").nth(1).locator("button").first().click(); await p.waitForTimeout(700);
const drawer = p.locator("[data-drawer]");
ok("B6 в карточке галочка отмечена", (await drawer.locator('button[role=checkbox][aria-label="Согласие"]').getAttribute("data-state")) === "checked");
ok("B7 в карточке чип multiselect отмечен", (await drawer.locator('[role=group][aria-label="Интересы"] button[aria-checked=true]').count()) === 1);

// ---------- C: телефон как телефон ----------
const tel = drawer.locator('a[href^="tel:"]').first();
ok("C1 в карточке рядом с телефоном ссылка tel:", await tel.isVisible(), await tel.getAttribute("href"));
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
const wa = p.locator('main tbody a[href^="https://wa.me/"]').first();
const tg = p.locator('main tbody a[href^="https://t.me/+"]').first();
ok("C2 в таблице есть ссылки WhatsApp и Telegram", (await wa.count()) > 0 && (await tg.count()) > 0);
ok("C3 ссылки открываются в новой вкладке без referrer", (await wa.getAttribute("target")) === "_blank" && (await wa.getAttribute("rel")) === "noreferrer");
const gusev = p.locator("main tbody tr", { hasText: "Виктор Гусев" }).first();
ok("C4 номер приведён к цифрам с кодом страны", (await gusev.locator('a[href^="https://wa.me/"]').getAttribute("href")) === "https://wa.me/79315021846",
  await gusev.locator('a[href^="https://wa.me/"]').getAttribute("href"));
// «101» — не телефон: ссылок быть не должно (иначе wa.me открывал бы чужую страну)
const ksu = p.locator("main tbody tr", { hasText: "Ксения Макарова" }).first();
const iPhC = await colIndex(p, "Телефон");
await ksu.locator("td").nth(iPhC).click({ position: { x: 6, y: 8 } }); await p.waitForTimeout(300); // не по иконкам-ссылкам
const ksuIn = ksu.locator("input[placeholder='+7 …']");
await ksuIn.fill("101"); await ksuIn.press("Enter"); await p.waitForTimeout(400);
ok("C5 короткий текст в поле телефона не считается номером", (await ksu.locator("a[href^='tel:']").count()) === 0 && /101/.test(await ksu.innerText()));

// ---------- I: импорт «да/нет» и списка через запятую ----------
writeFileSync("/tmp/x27.csv", "\ufeff" + ["Имя;Телефон;Согласие;Интересы", "Импорт Один;+7 900 000-00-01;да;Опт, Розница", "Импорт Два;+7 900 000-00-02;нет;"].join("\n"));
await p.getByRole("button", { name: /Загрузить/ }).first().click(); await p.waitForTimeout(500);
await p.locator("input[type=file]").setInputFiles("/tmp/x27.csv"); await p.waitForTimeout(1200);
await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 30000 }); await p.waitForTimeout(1200);
const imp1 = p.locator("main tbody tr", { hasText: "Импорт Один" }).first();
const imp2 = p.locator("main tbody tr", { hasText: "Импорт Два" }).first();
ok("I1 «да» из файла читается как галочка", (await imp1.locator("td").nth(iCb).locator("button[role=checkbox]").getAttribute("data-state")) === "checked"
  && (await imp2.locator("td").nth(iCb).locator("button[role=checkbox]").getAttribute("data-state")) === "unchecked");
ok("I2 «Опт, Розница» из файла: известный вариант — чипом, неизвестный — текстом", /Опт/.test(await imp1.locator("td").nth(iMs).innerText()) && /Розница/.test(await imp1.locator("td").nth(iMs).innerText()),
  await imp1.locator("td").nth(iMs).innerText());
await imp1.locator("td").nth(iCb).locator("button[role=checkbox]").click(); await p.waitForTimeout(400);
s = await st(p);
ok("I3 клик по импортированной галочке пишет честный boolean", s.records.find(r => r.values.title === "Импорт Один")?.values?.[cbField.id] === false);

// канбан: телефон на карточке
await side(p, "Сделки"); await p.waitForTimeout(500); await tab(p, "Таблица");
await p.locator("main thead button[aria-label='Добавить поле в раздел']").click(); await p.waitForTimeout(300);
const pop = p.locator("[data-radix-popper-content-wrapper]");
await pop.locator("input[placeholder='Название поля']").fill("Телефон");
await pop.locator("button[role=combobox]").click(); await p.waitForTimeout(250);
await p.getByRole("option", { name: "Телефон" }).click(); await p.waitForTimeout(200);
await pop.getByRole("button", { name: "Добавить" }).click(); await p.waitForTimeout(500);
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
const iPh = await colIndex(p, "Телефон");
const dealRow = p.locator("main tbody tr").first();
const dealTitle = (await dealRow.locator("td").nth(1).locator("button").first().innerText()).trim();
await dealRow.locator("td").nth(iPh).click(); await p.waitForTimeout(300);
const phIn = dealRow.locator("input[placeholder='+7 …']");
await phIn.fill("+7 999 123-45-67"); await phIn.press("Enter"); await p.waitForTimeout(500);
await tab(p, "Канбан");
const card = p.locator("[data-card]", { hasText: dealTitle }).first();
ok("C6 на карточке канбана виден телефон", /\+7 999 123-45-67/.test(await card.innerText()), (await card.innerText()).replace(/\n/g, " | "));

// ---------- D: перенос в «Проиграна» заводит «Причина отказа» и открывает карточку ----------
await tab(p, "Таблица");
const fieldsBefore = ent(await st(p), "deals").fields.length;
ok("D0 поля «Причина отказа» изначально нет", !ent(await st(p), "deals").fields.some(f => /причин/i.test(f.label)));
await p.locator("main tbody tr").first().locator("td").nth(1).locator("button").first().click(); await p.waitForTimeout(700);
const bar = drawer.locator("div.border-b").filter({ hasText: "клик по полосе" }).first();
const barBtns = bar.locator("button");
await barBtns.nth((await barBtns.count()) - 1).click(); await p.waitForTimeout(900);
s = await st(p);
const reason = ent(s, "deals").fields.find(f => /причин/i.test(f.label));
ok("D1 поле «Причина отказа» создано (список, 5 вариантов, не в таблице)",
  reason?.type === "select" && reason.label === "Причина отказа" && (reason.options ?? []).length === 5 && reason.inTable === false, JSON.stringify(reason));
ok("D2 запись действительно в стадии «lost»", ent(s, "deals").stages.find(x => x.id === (s.records.find(r => r.values.title === dealTitle)?.stageId))?.kind === "lost");
ok("D3 карточка открыта", (await drawer.count()) === 1);
const hl = drawer.locator("[data-highlight]");
ok("D4 поле причины подсвечено", (await hl.count()) === 1 && /Причина отказа/i.test(await hl.innerText()), await hl.innerText().catch(() => ""));
await hl.locator("button[role=combobox]").click(); await p.waitForTimeout(300);
await p.getByRole("option", { name: "Дорого" }).click(); await p.waitForTimeout(500);
s = await st(p);
const lostRec = s.records.find(r => r.values.title === dealTitle);
ok("D5 причина сохранилась и подсветка погасла", lostRec?.values?.[reason.id] === reason.options.find(o => o.label === "Дорого")?.id && (await hl.count()) === 0);
await p.keyboard.press("Escape"); await p.waitForTimeout(400);
// второй перенос — поле не дублируется (через выбор стадии в таблице)
const stageBtn = p.locator("main tbody tr").nth(1).locator("button[aria-label^='Стадия:']");
await stageBtn.click(); await p.waitForTimeout(300);
await p.locator("[role=menuitem]", { hasText: "Проиграна" }).click(); await p.waitForTimeout(900);
s = await st(p);
ok("D6 повторный перенос не плодит второе поле", ent(s, "deals").fields.filter(f => /причин/i.test(f.label)).length === 1 && ent(s, "deals").fields.length === fieldsBefore + 1);
ok("D7 карточка второй записи тоже открылась", (await drawer.count()) === 1 && (await drawer.locator("[data-highlight]").count()) === 1);
await p.keyboard.press("Escape"); await p.waitForTimeout(400);

// ---------- E: дубль по телефону → подсказка → объединение ----------
await side(p, "Клиенты"); await p.waitForTimeout(500);
const n0 = (await st(p)).records.filter(r => r.entityId === "contacts").length;
await p.getByRole("button", { name: /^\+? ?Клиент$/ }).first().click(); await p.waitForTimeout(800);
await drawer.locator("input[data-title-field]").fill("Гусев дубль"); await p.waitForTimeout(300);
await drawer.locator("input[placeholder='+7 …']").first().fill("8 931 502 18 46"); await p.waitForTimeout(500);
const hint = drawer.locator("[data-dup-hint]");
ok("E1 подсказка о похожей записи по телефону", await hint.isVisible() && /Виктор Гусев/.test(await hint.innerText()), await hint.innerText().catch(() => ""));
await hint.getByRole("button", { name: /Объединить/ }).click(); await p.waitForTimeout(300);
ok("E2 объединение спрашивает подтверждение", /Останется/.test(await hint.innerText()) && (await st(p)).records.filter(r => r.entityId === "contacts").length === n0 + 1);
await hint.getByRole("button", { name: "да, объединить" }).click(); await p.waitForTimeout(900);
s = await st(p);
ok("E3 после объединения записей стало меньше", s.records.filter(r => r.entityId === "contacts").length === n0, `${n0 + 1} → ${s.records.filter(r => r.entityId === "contacts").length}`);
ok("E4 карточка переключилась на выжившую запись", (await drawer.locator("input[data-title-field]").inputValue()) === "Виктор Гусев");
ok("E5 тост об объединении", (await p.locator("[data-sonner-toast]").allInnerTexts()).some(t => /объединены/i.test(t)));
await drawer.getByRole("button", { name: "Ещё действия" }).click(); await p.waitForTimeout(300);
await p.getByRole("menuitem", { name: /Объединить с/ }).click(); await p.waitForTimeout(300);
const mergeBox = drawer.locator("[data-merge-with]");
ok("E6 «Объединить с…» в меню карточки открывает выбор записи", await mergeBox.isVisible() && (await mergeBox.locator("button[role=combobox]").count()) === 1);
await mergeBox.locator("button[role=combobox]").click(); await p.waitForTimeout(300);
const search = p.locator("[data-relation-search] input");
await search.fill("волк"); await p.waitForTimeout(300);
const found = p.locator("[data-relation-search] button", { hasText: "Анна Волкова" });
ok("E7 поиск в комбобоксе связи находит по имени", await found.isVisible() && (await p.locator("[data-relation-search] button", { hasText: "Виктор Гусев" }).count()) === 0);
await search.fill("502-18"); await p.waitForTimeout(300);
ok("E8 сам себя в список объединения не предлагает, поиск по телефону работает", (await p.locator("[data-relation-search] button", { hasText: "Виктор Гусев" }).count()) === 0 && /Ничего не нашлось/.test(await p.locator("[data-relation-search]").innerText()));
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
await mergeBox.getByRole("button", { name: "Не объединять" }).click(); await p.waitForTimeout(200);
ok("E9 блок объединения закрывается", (await mergeBox.count()) === 0);
// комбобокс связи в сделке: поиск, «открыть», телефон связанного клиента
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
await side(p, "Сделки"); await p.waitForTimeout(500); await tab(p, "Таблица");
await p.locator("main tbody tr", { hasText: "Сайт-каталог мебели" }).first().locator("td").nth(1).locator("button").first().click(); await p.waitForTimeout(700);
const relBox = drawer.locator("#fld_" + (await st(p)).records.find(r => r.values.title === "Сайт-каталог мебели").id + "_contact");
ok("E10 под связью виден телефон клиента со ссылками", (await relBox.locator("[data-relation-phone] a[href^='https://wa.me/']").count()) === 1);
ok("E11 рядом со связью — кнопка «открыть карточку»", (await relBox.locator("button[aria-label^='Открыть:']").count()) === 1);
await relBox.locator("button[aria-label^='Открыть:']").click(); await p.waitForTimeout(600);
ok("E12 «открыть» переключает карточку на клиента", (await drawer.locator("input[data-title-field]").inputValue()) === "Анна Волкова");
await p.keyboard.press("Escape"); await p.waitForTimeout(300);

// ---------- F: «Очистить примеры» уносит демо-коллег ----------
await side(p, "Клиенты"); await p.waitForTimeout(500);
await p.getByRole("button", { name: /^\+? ?Клиент$/ }).first().click(); await p.waitForTimeout(800);
await drawer.locator("input[data-title-field]").fill("Мой клиент"); await p.waitForTimeout(300);
await drawer.locator("button[aria-label='Сменить ответственного']").click(); await p.waitForTimeout(300);
ok("F0 до очистки в команде трое", (await p.locator("[role=menuitem]").count()) === 3);
await p.locator("[role=menuitem]", { hasText: "Марина" }).click(); await p.waitForTimeout(400);
s = await st(p);
const mine = s.records.find(r => r.values.title === "Мой клиент");
ok("F1 своя запись отдана Марине", mine?.ownerId === "u2" && !mine.demo);
await p.keyboard.press("Escape"); await p.waitForTimeout(150); await p.keyboard.press("Escape"); await p.waitForTimeout(400);
await side(p, "Настройки"); await p.waitForTimeout(800);
await p.getByRole("button", { name: "Очистить примеры" }).click(); await p.waitForTimeout(300);
await p.locator("main button", { hasText: /^да$/ }).click(); await p.waitForTimeout(1200);
s = await st(p);
ok("F2 примеры убраны, свои записи остались", !s.records.some(r => r.demo) && s.records.some(r => r.values.title === "Мой клиент") && s.records.length === 3,
  s.records.map(r => r.values.title).join(", "));
ok("F3 осиротевшие записи переназначены на себя", s.records.every(r => r.ownerId === "u1"), s.records.map(r => r.ownerId).join(","));
await side(p, "Клиенты"); await p.waitForTimeout(500);
await p.locator("main tbody tr", { hasText: "Мой клиент" }).first().locator("td").nth(1).locator("button").first().click(); await p.waitForTimeout(700);
await drawer.locator("button[aria-label='Сменить ответственного']").click(); await p.waitForTimeout(300);
ok("F4 демо-коллег в выборе ответственного больше нет", (await p.locator("[role=menuitem]").count()) === 1, String(await p.locator("[role=menuitem]").count()));
await p.keyboard.press("Escape"); await p.waitForTimeout(150); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
await ctx.close();

// ---------- G: онбординг — своё имя и «Своя ниша» с нуля ----------
{
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const q = await c2.newPage();
  q.on("pageerror", e => errors.push(String(e)));
  await q.goto(URL); await q.waitForTimeout(2600);
  const d = q.locator("[role=dialog]");
  ok("G1 окно первого запуска открылось", /С чего начнём/.test(await d.innerText().catch(() => "")));
  ok("G2 в онбординге нет «Сохранить текущую настройку как шаблон»", !/Сохранить текущую настройку/.test(await d.innerText()));
  const me = d.locator("[data-me-name]");
  ok("G3 показано, кто вы", /Вы — Глеб/.test(await me.innerText()), await me.innerText());
  await me.getByRole("button", { name: /переименовать/ }).click(); await q.waitForTimeout(200);
  await d.locator("input[aria-label='Ваше имя']").fill("Иван"); await q.keyboard.press("Enter"); await q.waitForTimeout(300);
  ok("G4 переименование сработало", /Вы — Иван/.test(await me.innerText()), await me.innerText());
  const firstCard = d.locator("button", { hasText: /стадий/ }).first();
  ok("G5 первая карточка — «Своя ниша»", /Своя ниша/.test(await firstCard.innerText()), await firstCard.innerText());
  const before = (await st(q)).records?.length ?? -1;
  await firstCard.click(); await q.waitForTimeout(1200);
  const s2 = await st(q);
  ok("G6 «Своя ниша» без своих данных применяется сразу, без подтверждения", (await d.count()) === 0 && s2.records.length === 0 && !!ent(s2, "deals") && !!ent(s2, "contacts"), `было ${before}, стало ${s2.records?.length}; диалог: ${await d.count()}`);
  await q.getByRole("button", { name: /^\+? ?Сделка$/ }).first().click(); await q.waitForTimeout(800);
  ok("G7 новая запись подписана новым именем", /Иван/.test(await q.locator("[data-drawer]").innerText()));
  await c2.close();
}

// ---------- H: телефон 390px — галочки не вытянуты, конструктор не уезжает за край ----------
{
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const m = await c3.newPage();
  m.on("pageerror", e => errors.push(String(e)));
  await quiet(m);
  await m.goto(URL); await m.waitForTimeout(1600); await m.keyboard.press("Escape");
  ok("H0 эмуляция пальца включена (pointer: coarse)", await m.evaluate(() => matchMedia("(pointer: coarse)").matches));
  await side(m, "Сделки"); await m.waitForTimeout(700);
  await m.getByRole("button", { name: "Таблица", exact: true }).click(); await m.waitForTimeout(500);
  const boxes = m.locator("main button[role=checkbox]");
  const hs = [];
  for (let i = 0; i < Math.min(4, await boxes.count()); i++) { const b = await boxes.nth(i).boundingBox(); if (b) hs.push(Math.round(b.height)); }
  ok("H1 галочки таблицы не растянуты на телефоне (высота ≤ 24)", hs.length > 0 && hs.every(h => h <= 24), hs.join(","));
  const cfgBtn = m.getByRole("button", { name: "Настроить раздел" });
  ok("H2 обычные кнопки при этом остались крупными (≥ 34)", ((await cfgBtn.boundingBox())?.height ?? 0) >= 34, String((await cfgBtn.boundingBox())?.height));
  await cfgBtn.click(); await m.waitForTimeout(600);
  const dl = m.locator("[role=dialog]");
  const overflow = await dl.evaluate(el => el.scrollWidth - el.clientWidth);
  const arrow = dl.locator("button[aria-label*='ниже']").first();
  const ab = await arrow.boundingBox();
  ok("H3 строка поля переносится: стрелки не уезжают за край", overflow <= 0 && !!ab && ab.x + ab.width <= 390, `overflow ${overflow}, right ${ab ? ab.x + ab.width : "?"}`);
  const del = dl.locator("button:has(svg.lucide-trash-2), button:has(svg.lucide-trash2)").first();
  const db = await del.boundingBox();
  ok("H4 удаление поля видно и в пределах экрана", !!db && db.x + db.width <= 390 && db.x >= 0, JSON.stringify(db));
  await dl.getByRole("tab", { name: "Стадии" }).click(); await m.waitForTimeout(400);
  const sw = await dl.locator("button.swatch").first().boundingBox();
  ok("H5 свотч цвета стадии не растянут", !!sw && sw.height <= 24, JSON.stringify(sw));
  await c3.close();
}

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

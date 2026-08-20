// ПОЛНЫЙ ПРОГОН ПРОЕКТА: все экраны и примитивы, а не только новые фичи.
import { chromium } from "playwright";
const R = [];
const ok = (n, c, e = "") => { R.push([c ? "PASS" : "FAIL", n, String(e)]); if (!c) console.log("  ✗", n, e); };
const st = async (p) => await p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") || "{}"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push("PAGEERROR: " + String(e).slice(0, 160)));
p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
await p.goto("http://127.0.0.1:8099/index.html");
await p.waitForTimeout(1600); await p.keyboard.press("Escape");
const openEnt = async (name) => { await p.getByRole("button", { name: new RegExp(name) }).first().click(); await p.waitForTimeout(400); };
const tab = async (name) => { await p.getByRole("button", { name, exact: true }).click(); await p.waitForTimeout(400); };

// ---------- A. Записи и поля ----------
await openEnt("Сделки"); await tab("Таблица");
const recs0 = (await st(p)).records.filter(r => r.entityId === "deals").length;
await p.getByRole("button", { name: /^\+? ?Сделка$/ }).first().click().catch(() => {});
await p.waitForTimeout(600);
const recs1 = (await st(p)).records.filter(r => r.entityId === "deals").length;
ok("A1 запись создаётся кнопкой", recs1 === recs0 + 1, `${recs0}→${recs1}`);
const drawer = p.locator("aside").last();
ok("A2 карточка открылась после создания", await drawer.getByText(/Хронология/).isVisible().catch(() => false));
await drawer.locator("input").first().fill("Проверка полей");
await p.waitForTimeout(500);
ok("A3 название пишется", ((await st(p)).records.slice(-1)[0].values.title || "") === "Проверка полей");
const money = drawer.locator("input[inputmode=decimal], input[type=number]").first();
await money.fill("125000").catch(() => {});
await p.waitForTimeout(500);
const last = () => st(p).then(s => s.records.slice(-1)[0]);
ok("A4 деньги сохраняются", Number((await last()).values.amount) === 125000, JSON.stringify((await last()).values.amount));
await drawer.getByText("Хронология").scrollIntoViewIfNeeded();
const comment = drawer.locator("input[placeholder*='Комментарий']");
await comment.fill("первый комментарий"); await comment.press("Enter"); await p.waitForTimeout(500);
ok("A5 комментарий попал в хронологию", /первый комментарий/.test(await drawer.innerText()));
const taskInput = drawer.locator("input[placeholder*='Новая задача']");
await taskInput.fill("позвонить клиенту"); await taskInput.press("Enter"); await p.waitForTimeout(500);
ok("A6 задача ставится из карточки", (await st(p)).tasks.some(t => t.title === "позвонить клиенту"));
// коалесинг истории: набор текста одной строкой
const before = (await st(p)).activities.length;
await drawer.locator("input").first().fill("Проверка полей 2");
await p.waitForTimeout(400);
await drawer.locator("input").first().fill("Проверка полей 3");
await p.waitForTimeout(600);
const after = (await st(p)).activities.length;
ok("A7 правки одного поля схлопываются", after - before <= 1, `+${after - before} записей истории`);

// ---------- B. Стадии ----------
const recId = (await last()).id;
const stages = await p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1")).entities.find(e => e.id === "deals").stages.map(s => s.id));
await drawer.locator("div.border-b button.h-4").nth(2).click().catch(() => {});
await p.waitForTimeout(500);
const movedTo = (await st(p)).records.find(r => r.id === recId).stageId;
ok("B1 стадия меняется полосой в карточке", movedTo === stages[2], `${movedTo}`);
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
await tab("Канбан");
ok("B2 канбан показывает колонки стадий", (await p.locator("main").innerText()).includes("Новая"));
await tab("Таблица");
const stageCell = p.locator("main tbody tr").first().locator("button").filter({ hasText: /Новая|Квалификация|Переговоры|Договор|Оплачено|Проиграна/ }).first();
await stageCell.click().catch(() => {});
await p.waitForTimeout(300);
const menuItem = p.locator("[role=menuitem]").nth(1);
const hadMenu = await menuItem.isVisible().catch(() => false);
if (hadMenu) { await menuItem.click(); await p.waitForTimeout(400); }
ok("B3 стадия меняется прямо из таблицы", hadMenu);

// ---------- C. Автоматизации (движок) ----------
await p.getByRole("button", { name: /Автоматизации/ }).first().click(); await p.waitForTimeout(500);
ok("C1 экран автоматизаций открылся", /Приём заявок|правил/i.test(await p.locator("main").innerText()));
const rulesBefore = (await st(p)).automations.length;
await p.getByRole("button", { name: /Правило/ }).first().click(); await p.waitForTimeout(500);
const dlg = p.locator("[role=dialog]");
await dlg.locator("input").first().fill("Тестовое правило");
await dlg.locator("input[placeholder*='Текст задачи']").fill("Проверочная задача из правила").catch(() => {});
await dlg.getByRole("button", { name: "Сохранить правило" }).click().catch(() => {});
await p.waitForTimeout(600);
const rulesAfter = (await st(p)).automations.length;
ok("C2 правило создаётся", rulesAfter === rulesBefore + 1, `${rulesBefore}→${rulesAfter}`);
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
// правило «создана запись → задача» реально срабатывает
const tasksBefore = (await st(p)).tasks.length;
await openEnt("Сделки");
await p.getByRole("button", { name: /^\+? ?Сделка$/ }).first().click().catch(() => {});
await p.waitForTimeout(900);
// имя обязательно: без него карточка считается пустой и удаляется при закрытии вместе с задачей
await p.keyboard.type("Сделка из проверки правил");
await p.waitForTimeout(300);
// первый Escape выходит из поля, второй закрывает карточку
await p.keyboard.press("Escape"); await p.waitForTimeout(150); await p.keyboard.press("Escape");
await p.waitForTimeout(400);
const tasksAfter = (await st(p)).tasks.length;
ok("C3 правило «создана запись» ставит задачу", tasksAfter > tasksBefore, `${tasksBefore}→${tasksAfter}`);

// ---------- D. Задачи и Мой день ----------
await p.getByRole("button", { name: /Задачи/ }).first().click(); await p.waitForTimeout(500);
const quick = p.locator("input[placeholder*='Новая задача']").first();
await quick.fill("задача из списка"); await quick.press("Enter"); await p.waitForTimeout(500);
ok("D1 быстрая задача создаётся", (await st(p)).tasks.some(t => t.title === "задача из списка"));
const cb = p.locator("main button[title='Выполнить']").first();
await cb.click(); await p.waitForTimeout(500);
ok("D2 задача отмечается выполненной", (await st(p)).tasks.some(t => t.done));
await p.getByRole("button", { name: /Мой день/ }).first().click(); await p.waitForTimeout(500);
ok("D3 «Мой день» показывает счётчики", /Открытых задач|Выполнено сегодня/.test(await p.locator("main").innerText()));

// ---------- E. Входящие ----------
await p.getByRole("button", { name: /Входящие/ }).first().click(); await p.waitForTimeout(600);
await p.getByRole("button", { name: /Максим Веретенников/ }).click(); await p.waitForTimeout(400);
const msgInput = p.locator("main input[placeholder*='Ответить']");
await msgInput.fill("тестовый ответ"); await msgInput.press("Enter"); await p.waitForTimeout(600);
ok("E1 сообщение уходит в диалог", (await st(p)).chats.some(c => c.msgs.some(m => m.text === "тестовый ответ")));
const tplBtn = p.locator("main button").filter({ hasText: /Приветствие/ }).first();
await tplBtn.click().catch(() => {});
await p.waitForTimeout(400);
ok("E2 шаблон подставляется в поле ответа", ((await msgInput.inputValue()) || "").length > 3, await msgInput.inputValue());
ok("E3 видно, куда упадёт новая заявка", /новые →/i.test(await p.locator("main").innerText()));

// ---------- F. Конструктор ----------
await openEnt("Сделки");
await p.getByRole("button", { name: "Настроить раздел" }).click(); await p.waitForTimeout(500);
const cfg = p.locator("[role=dialog]");
ok("F1 конструктор открылся", await cfg.getByRole("tab", { name: "Поля" }).isVisible());
await cfg.getByRole("tab", { name: "Стадии" }).click(); await p.waitForTimeout(300);
const stagesBefore = (await st(p)).entities.find(e => e.id === "deals").stages.length;
const addStage = cfg.locator("input[placeholder*='стади'], input[placeholder*='Стади']").first();
await addStage.fill("Проверка"); await addStage.press("Enter"); await p.waitForTimeout(500);
const stagesAfter = (await st(p)).entities.find(e => e.id === "deals").stages.length;
ok("F2 стадия добавляется", stagesAfter === stagesBefore + 1, `${stagesBefore}→${stagesAfter}`);
await cfg.getByRole("tab", { name: "Поля" }).click(); await p.waitForTimeout(300);
const fieldsBefore = (await st(p)).entities.find(e => e.id === "deals").fields.length;
const addField = cfg.locator("input[placeholder*='поля'], input[placeholder*='Название']").first();
await addField.fill("Проверочное поле"); await addField.press("Enter"); await p.waitForTimeout(500);
const fieldsAfter = (await st(p)).entities.find(e => e.id === "deals").fields.length;
ok("F3 поле добавляется в конструкторе", fieldsAfter === fieldsBefore + 1, `${fieldsBefore}→${fieldsAfter}`);
ok("F4 конструктор показывает зависимости", /Сюда завязано/i.test(await cfg.innerText()));
await p.keyboard.press("Escape"); await p.waitForTimeout(400);

// новый раздел
const entsBefore = (await st(p)).entities.length;
await p.getByRole("button", { name: /Новый раздел/ }).last().click(); await p.waitForTimeout(400);
const nd = p.locator("[role=dialog]");
await nd.locator("input").first().fill("Поставщики");
await nd.getByRole("button", { name: /Создать|Добавить|Готово/ }).first().click(); await p.waitForTimeout(700);
await p.keyboard.press("Escape"); await p.waitForTimeout(400);
const entsAfter = (await st(p)).entities.length;
ok("F5 новый раздел создаётся", entsAfter === entsBefore + 1, `${entsBefore}→${entsAfter}`);

// ---------- G. Отмена ----------
await openEnt("Сделки"); await tab("Таблица");
const cntBefore = (await st(p)).records.filter(r => r.entityId === "deals").length;
await p.locator("main tbody tr").first().locator("td").nth(1).locator("button").first().click();
await p.waitForTimeout(600);
const dr = p.locator("aside").last();
await dr.locator("header button").first().click();       // меню карточки (три точки)
await p.waitForTimeout(400);
await p.getByRole("menuitem", { name: /Удалить/ }).click();
await p.waitForTimeout(500);
const cntDel = (await st(p)).records.filter(r => r.entityId === "deals").length;
ok("G1 запись удаляется", cntDel === cntBefore - 1, `${cntBefore}→${cntDel}`);
await p.keyboard.press("Escape");
await p.locator("h1").first().click();          // фокус на нейтральном месте, а не в ячейке таблицы
await p.keyboard.press("Control+z"); await p.waitForTimeout(800);
const cntUndo = (await st(p)).records.filter(r => r.entityId === "deals").length;
ok("G2 Ctrl+Z возвращает удалённое", cntUndo === cntBefore, `${cntDel}→${cntUndo}`);

// ---------- H. Настройки ----------
await p.getByRole("button", { name: "Настройки" }).click(); await p.waitForTimeout(500);
const tplsBefore = (await st(p)).replyTemplates.length;
await p.getByRole("button", { name: /Новый шаблон/ }).click(); await p.waitForTimeout(500);
await p.locator("main input[placeholder='Название']").fill("Тестовый шаблон");
await p.locator("main textarea[placeholder*='переменными']").fill("Здравствуйте, {имя}!");
await p.getByRole("button", { name: /^Сохранить$/ }).first().click().catch(() => {});
await p.waitForTimeout(600);
ok("H1 шаблон ответа сохраняется", (await st(p)).replyTemplates.length === tplsBefore + 1, `${tplsBefore}→${(await st(p)).replyTemplates.length}`);
await p.getByRole("button", { name: "Тёмная", exact: true }).click(); await p.waitForTimeout(400);
ok("H2 тёмная тема включается", (await p.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
await p.getByRole("button", { name: "Светлая", exact: true }).click(); await p.waitForTimeout(300);

// ---------- I. Устойчивость ----------
await p.evaluate(() => localStorage.setItem("xxlcrm-site-v1", "{битый json"));
await p.reload(); await p.waitForTimeout(1800);
const alive = await p.locator("aside").first().innerText().catch(() => "");
ok("I1 битое хранилище не роняет приложение", /XXLcrm/.test(alive), alive.slice(0, 40));
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(2200);
ok("I2 чистый старт работает", /XXLcrm/.test(await p.locator("aside").first().innerText().catch(() => "")));
await p.keyboard.press("Escape");

// ---------- J. Пресеты ----------
await p.getByRole("button", { name: /Шаблон ниши/ }).click(); await p.waitForTimeout(700);
const preset = p.locator("[role=dialog] button").filter({ hasText: /Барбершоп|Магазин украшений|Кондитер/ }).first();
const hasPresets = await preset.isVisible().catch(() => false);
if (hasPresets) { await preset.click(); await p.waitForTimeout(1200); }
const afterPreset = await st(p);
ok("J1 пресет применяется и наполняет данными", hasPresets && afterPreset.records.length > 0, `записей: ${afterPreset.records?.length}`);
ok("J2 пресет ставит воронку", (afterPreset.entities || []).some(e => (e.stages || []).length > 0));

const real = errs.filter(e => !/ERR_TUNNEL|Failed to load resource|net::|fetch|supabase/i.test(e));
ok("Z1 нет ошибок JS за весь прогон", real.length === 0, real.slice(0, 3).join(" | "));

console.log("\n" + R.map(([s, n, e]) => `${s === "PASS" ? "✓" : "✗"} ${n}${e && s === "FAIL" ? "  → " + e : ""}`).join("\n"));
console.log(`\n${R.filter(r => r[0] === "PASS").length}/${R.length} PASS`);
await b.close();
process.exit(R.some(r => r[0] === "FAIL") ? 1 : 0);

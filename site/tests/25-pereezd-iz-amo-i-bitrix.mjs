// Переезд из amoCRM / Битрикс24 «за 15 минут»: сначала клиенты (Битрикс, cp1251, ФИО в трёх колонках),
// потом сделки (amo, стадии со своими названиями, даты со временем, телефоны 8-9xx и «9,26E+09»).
// Проверяем: ФИО склеено, телефон нормализован, «Дата создания» не легла в день рождения, сделки попали в
// правильные стадии (успех/отказ), createdAt взят из файла (переезд — не «новые за неделю»), связь
// сделка → клиент найдена по телефону без дублей, примечание ушло в хронологию, повторная загрузка по ID
// не плодит дубли, а Ctrl+Z откатывает импорт целиком вместе с заведённой стадией.
// Запуск: PORT=8098 NODE_PATH=$(npm root -g) node tests/25-pereezd-iz-amo-i-bitrix.mjs  (по умолчанию порт 8099)
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = process.env.PORT || "8099";
const URL = `http://127.0.0.1:${PORT}/index.html`;
const DIR = dirname(fileURLToPath(import.meta.url));
const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 240)); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.addInitScript(() => localStorage.setItem("xxl-setup-v1", JSON.stringify({ greeted: true, structure: true })));
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? '{"records":[],"entities":[],"activities":[]}'));
const DAY = 86400000;
const local = (y, m, d, h, mi) => p.evaluate(([y, m, d, h, mi]) => new Date(y, m - 1, d, h, mi).getTime(), [y, m, d, h, mi]);

const goSection = async (name) => {
  await p.evaluate(s => { const b = [...document.querySelectorAll("aside button")].find(x => x.textContent?.includes(s)); b?.click(); }, name);
  await p.waitForTimeout(400);
};
const openImport = async (section) => {
  await goSection(section);
  await p.getByRole("button", { name: /^Загрузить$/ }).first().click();
  await p.waitForTimeout(400);
};
const feed = async (file) => { await p.locator("input[type=file]").setInputFiles(join(DIR, file)); await p.waitForTimeout(900); };
const dlg = () => p.locator("[role=dialog]");
const colSelect = (i) => dlg().locator(`[data-import-col="${i}"] button[role=combobox]`);
const stageSelect = (v) => dlg().locator(`[data-stage-value="${v}"] button[role=combobox]`);
const runImport = async () => {
  await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 30000 });
  await p.waitForTimeout(1200);
  return (await p.locator("[data-sonner-toast]").allInnerTexts()).join(" | ");
};
const recs = (s, ent) => (s.records ?? []).filter(r => r.entityId === ent);
const stagesOf = (s) => s.entities.find(e => e.id === "deals")?.stages ?? [];

await p.goto(URL); await p.waitForTimeout(1500); await p.keyboard.press("Escape");

// ---------- A: пустое состояние подсказывает, как переехать ----------
await openImport("Клиенты");
const empty = await dlg().innerText();
ok("A1 подсказка про amoCRM/Битрикс24 и порядок «сначала клиенты, потом сделки»", /amoCRM/.test(empty) && /Битрикс24/.test(empty) && /сначала Клиентов, потом Сделки/i.test(empty), empty.slice(0, 300));
ok("A2 сказано, что Excel (.xlsx) читается напрямую, а старый .xls — нет", /Excel \(\.xlsx\)/.test(empty) && /\.xls \(Excel 97/.test(empty), empty.slice(0, 300));

// ---------- B: клиенты из Битрикса (cp1251, ФИО в трёх колонках) ----------
// До первого изменения база в localStorage ещё не сохранена — считаем по загруженным записям, а не по разнице
await feed("b24-contacts.csv");
const b24 = await dlg().innerText();
ok("B1 кириллица windows-1251 прочитана", /Пётр/.test(b24) && /Смирнова/.test(b24), b24.slice(0, 200).replace(/\n/g, " | "));
ok("B2 «Фамилия» и «Отчество» тоже метят в «Имя» (склейка, а не «лишние отключил»)",
  (await colSelect(2).innerText()).trim() === "Имя" && (await colSelect(3).innerText()).trim() === "Имя" && !/метили в одно поле/.test(b24),
  `${await colSelect(2).innerText()} / ${await colSelect(3).innerText()}`);
ok("B3 «Дата создания» идёт в дату создания карточки, а не в день рождения", /Дата создания \(когда завели\)/.test(await colSelect(7).innerText()), await colSelect(7).innerText());
ok("B4 «ID» → ID в старой системе, «Ответственный» → сотрудник", /ID в старой системе/.test(await colSelect(0).innerText()) && /Ответственный/.test(await colSelect(6).innerText()));
const t1 = await runImport();
ok("B5 загрузка прошла и про неизвестного ответственного сказано", /Загружено: 3/.test(t1) && /ответственного нет в команде у 1/.test(t1), t1.slice(0, 300));

const s1 = await st();
const c1 = recs(s1, "contacts");
ok("B6 три клиента добавлены — ровно по одному на строку", c1.filter(r => r.values.ext_id).length === 3 && c1.filter(r => /Иванов|Смирнова|Кузнецова/.test(String(r.values.title))).length === 3, c1.map(r => r.values.title).join(" / "));
const petr = c1.find(r => r.values.ext_id === "7");
const olga = c1.find(r => r.values.ext_id === "8");
const anna = c1.find(r => r.values.ext_id === "9");
ok("B7 ФИО склеено по-русски: «Пётр Сергеевич Иванов»", petr?.values.title === "Пётр Сергеевич Иванов", JSON.stringify(petr?.values));
ok("B8 телефон «8 916 123-45-67» → «+7 916 123-45-67»", petr?.values.phone === "+7 916 123-45-67", String(petr?.values.phone));
ok("B9 телефон из Excel «9,03E+09» развёрнут в номер", anna?.values.phone === "+7 903 000-00-00", String(anna?.values.phone));
ok("B10 день рождения НЕ заполнен датой создания", [petr, olga, anna].every(r => r && !r.values.bday), JSON.stringify([petr, olga, anna].map(r => r?.values.bday)));
ok("B11 createdAt взят из файла (03.02.2025 10:00)", petr?.createdAt === await local(2025, 2, 3, 10, 0), `${petr?.createdAt} vs ${await local(2025, 2, 3, 10, 0)}`);
ok("B12 ответственный найден по имени: «Марина Петрова» → Марина, «Глеб» → Глеб", petr?.ownerId === "u2" && olga?.ownerId === "u1", `${petr?.ownerId} / ${olga?.ownerId}`);
const annaActs = (s1.activities ?? []).filter(a => a.recordId === anna?.id);
ok("B13 неизвестный ответственный записан в хронологию", annaActs.some(a => a.kind === "comment" && /Ответственный в старой CRM: Кто-то Чужой/.test(a.text)), annaActs.map(a => a.text).join(" | "));
ok("B14 «Комментарий» лёг в своё поле (точное имя поля важнее догадок)", petr?.values.notes === "Постоянный клиент", String(petr?.values.notes));
const fresh = c1.filter(r => r.values.ext_id && r.createdAt > Date.now() - 7 * DAY).length;
ok("B15 переехавшие клиенты не считаются «новыми за неделю»", fresh === 0, `новых за неделю среди загруженных: ${fresh}`);

// ---------- C: сделки из amo — стадии, даты, связь с клиентами по телефону ----------
const dealsBefore = recs(s1, "deals").length;
const stagesBefore = stagesOf(s1).length;
await openImport("Сделки");
await feed("amo-deals.csv");
const amo = await dlg().innerText();
ok("C1 «Основной контакт» → связь с клиентом, «Рабочий телефон» → телефон клиента для связи, «Примечание» → хронология",
  (await colSelect(2).innerText()).trim() === "Клиент" && /Телефон клиента/.test(await colSelect(8).innerText()) && /хронологию/.test(await colSelect(9).innerText()),
  `${await colSelect(2).innerText()} / ${await colSelect(8).innerText()} / ${await colSelect(9).innerText()}`);
ok("C2 блок «Стадии в файле → у вас» показан", /Стадии в файле/i.test(amo) && (await dlg().locator("[data-stage-value]").count()) === 5, amo.slice(0, 200));
ok("C3 «Успешно реализовано» → стадия-успех «Оплачено»", (await stageSelect("Успешно реализовано").innerText()).trim() === "Оплачено", await stageSelect("Успешно реализовано").innerText());
ok("C4 «Закрыто и не реализовано» → стадия-отказ «Проиграна»", (await stageSelect("Закрыто и не реализовано").innerText()).trim() === "Проиграна", await stageSelect("Закрыто и не реализовано").innerText());
ok("C5 «Первичный контакт» → первая рабочая «Новая», «Переговоры» → точное совпадение",
  (await stageSelect("Первичный контакт").innerText()).trim() === "Новая" && (await stageSelect("Переговоры").innerText()).trim() === "Переговоры");
ok("C6 незнакомая стадия предлагается к созданию с тем же названием", /создать стадию «Принимают решение»/.test(await stageSelect("Принимают решение").innerText()), await stageSelect("Принимают решение").innerText());
// ручная правка в блоке стадий работает: выберем для «Переговоры» другую стадию и вернём обратно
await stageSelect("Переговоры").click(); await p.waitForTimeout(250);
await p.locator("[role=option]", { hasText: "Квалификация" }).first().click(); await p.waitForTimeout(250);
ok("C7 выбор стадии в блоке меняется вручную", (await stageSelect("Переговоры").innerText()).trim() === "Квалификация", await stageSelect("Переговоры").innerText());
await stageSelect("Переговоры").click(); await p.waitForTimeout(250);
await p.locator("[role=option]", { hasText: /^Переговоры$/ }).first().click(); await p.waitForTimeout(250);
const t2 = await runImport();
ok("C8 отчёт: связано по телефону, заведена стадия, примечания ушли в хронологию", /связано с клиентами по телефону: 4/.test(t2) && /заведено стадий из файла: 1/.test(t2) && /примечаний ушло в хронологию: 3/.test(t2), t2.slice(0, 400));

const s2 = await st();
const d2 = recs(s2, "deals");
const byExt = (id) => d2.find(r => r.values.ext_id === id);
const stg = (r) => stagesOf(s2).find(x => x.id === r?.stageId);
ok("C9 пять сделок загружены с ID из старой системы", d2.length === dealsBefore + 5 && ["1001", "1002", "1003", "1004", "1005"].every(id => byExt(id)), `${dealsBefore} → ${d2.length}`);
ok("C10 «Успешно реализовано» легла в стадию kind=won, «Закрыто и не реализовано» — kind=lost", stg(byExt("1001"))?.kind === "won" && stg(byExt("1003"))?.kind === "lost", `${stg(byExt("1001"))?.label} / ${stg(byExt("1003"))?.label}`);
const made = stagesOf(s2).find(x => x.label === "Принимают решение");
ok("C11 стадия «Принимают решение» заведена рабочей и стоит перед финальными",
  !!made && made.kind === "open" && stagesOf(s2).indexOf(made) < stagesOf(s2).findIndex(x => x.kind !== "open") && byExt("1005")?.stageId === made.id, stagesOf(s2).map(x => x.label + ":" + x.kind).join(", "));
ok("C12 createdAt сделки — из файла, со временем (12.03.2025 14:22)", byExt("1001")?.createdAt === await local(2025, 3, 12, 14, 22), `${byExt("1001")?.createdAt} vs ${await local(2025, 3, 12, 14, 22)}`);
ok("C13 сделки не попали в «новые за неделю»", d2.filter(r => r.values.ext_id && r.createdAt > Date.now() - 7 * DAY).length === 0);
ok("C14 закрытая сделка не считается «выигранной на этой неделе» (stageAt не сегодня)", (byExt("1001")?.stageAt ?? 0) < Date.now() - 30 * DAY, String(byExt("1001")?.stageAt));
ok("C15 бюджет «150 000» → 150000", byExt("1001")?.values.amount === 150000, String(byExt("1001")?.values.amount));
ok("C16 ответственные: «Марина Петрова» → Марина, «Артём Соколов» → Артём", byExt("1001")?.ownerId === "u2" && byExt("1003")?.ownerId === "u3", `${byExt("1001")?.ownerId} / ${byExt("1003")?.ownerId}`);
const acts1004 = (s2.activities ?? []).filter(a => a.recordId === byExt("1004")?.id);
ok("C17 «Неизвестный Менеджер» — в хронологии, а запись у выбранного ответственного", acts1004.some(a => /Ответственный в старой CRM: Неизвестный Менеджер/.test(a.text)) && byExt("1004")?.ownerId === "u1", acts1004.map(a => a.text).join(" | "));
// связь с клиентом: «Иванов Пётр Сергеевич» ≠ «Пётр Сергеевич Иванов», но телефон один — карточка та же, без дубля
const c2 = recs(s2, "contacts");
ok("C18 сделка связана с УЖЕ существующим клиентом по телефону (имя в другом порядке)", byExt("1001")?.values.contact === petr?.id && byExt("1003")?.values.contact === petr?.id, `${byExt("1001")?.values.contact} vs ${petr?.id}`);
ok("C19 обе сделки Ольги — на одной карточке, найденной по «+79265551122» и «+7 926 555-11-22»", byExt("1002")?.values.contact === olga?.id && byExt("1005")?.values.contact === olga?.id);
const kozlov = c2.find(r => r.values.title === "Козлов Дмитрий");
ok("C20 новый клиент заведён с именем И телефоном (из «9,26E+09»)", !!kozlov && kozlov.values.phone === "+7 926 000-00-00" && byExt("1004")?.values.contact === kozlov.id, JSON.stringify(kozlov?.values));
ok("C21 клиентов стало ровно на одного больше — дублей по телефону нет",
  c2.length === c1.length + 1 && c2.filter(r => String(r.values.phone ?? "").replace(/\D/g, "").endsWith("9161234567")).length === 1, `${c1.length} → ${c2.length}`);
const note = (s2.activities ?? []).find(a => a.recordId === byExt("1001")?.id && a.kind === "comment" && a.text === "Просил перезвонить после обеда");
ok("C22 примечание ушло в хронологию сделки датой создания", !!note && note.ts === byExt("1001")?.createdAt, JSON.stringify(note));
ok("C23 «ID в старой системе» — скрытое поле раздела, не в таблице", s2.entities.find(e => e.id === "deals")?.fields.some(f => f.id === "ext_id" && f.inTable === false) === true);

// ---------- D: повторная загрузка того же файла по ID не плодит дубли ----------
await openImport("Сделки");
await feed("amo-deals.csv");
const t3 = await runImport();
const s3 = await st();
ok("D1 повторный импорт: сделок столько же, объединено по ID", recs(s3, "deals").length === d2.length && /объединено с существующими/.test(t3), `${d2.length} → ${recs(s3, "deals").length}; ${t3.slice(0, 200)}`);
ok("D2 клиентов и стадий не прибавилось, примечания не задвоились",
  recs(s3, "contacts").length === c2.length && stagesOf(s3).length === stagesOf(s2).length
  && (s3.activities ?? []).filter(a => a.text === "Просил перезвонить после обеда").length === 1,
  `клиентов ${c2.length} → ${recs(s3, "contacts").length}, стадий ${stagesOf(s2).length} → ${stagesOf(s3).length}`);

// ---------- E: Ctrl+Z откатывает загрузку целиком — вместе с заведённой стадией ----------
await p.mouse.click(700, 300); await p.waitForTimeout(200);
await p.keyboard.press("Control+z"); await p.waitForTimeout(500);   // отмена повторной загрузки
await p.keyboard.press("Control+z"); await p.waitForTimeout(700);   // отмена загрузки сделок
const s4 = await st();
ok("E1 после Ctrl+Z сделок столько, сколько было до загрузки", recs(s4, "deals").length === dealsBefore, `${recs(s4, "deals").length} vs ${dealsBefore}`);
ok("E2 заведённая стадия и заведённый клиент откатились", stagesOf(s4).length === stagesBefore && recs(s4, "contacts").length === c1.length, `стадий ${stagesOf(s4).length} vs ${stagesBefore}, клиентов ${recs(s4, "contacts").length} vs ${c1.length}`);

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

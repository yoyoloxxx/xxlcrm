// Автоматизации v2: (1) триггер «клиент ждёт ответа N часов» смотрит только настоящие диалоги (с ext)
// и ставит задачу «Ответить»; (2) действие «написать клиенту по шаблону» без подключённого канала
// ставит задачу «Написать клиенту: <шаблон>», а с подключённым (Telegram перехвачен) — реально шлёт,
// оставляет след в хронике и не повторяется; (3) «застряла на стадии» с указанной стадией не трогает
// записи на других стадиях; (4) «за N дней до даты в поле» срабатывает один раз на запись+дату;
// (5) удалённая стадия у «застряла» видна в списке как «стадия удалена»; (6) диалог правила: переключатель
// «поставить задачу / написать клиенту», Select шаблона и Select стадии.
//   cd site && npx vite build && (cd dist && python3 -m http.server 8097 &) && NODE_PATH=$(npm root -g) node tests/26-avtomatizacii-soobshchenie-i-tishina.mjs
import { chromium } from "playwright";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 240)); };
const URL = `http://127.0.0.1:${process.env.PORT || "8099"}/index.html`;
const H = 3600000, DAY = 86400000;

// Сообщения клиенту уходят только в рабочее время (9–22 по часам браузера). Чтобы проверка не зависела
// от того, когда её запустили, браузеру выдаём часовой пояс, в котором сейчас ~13:00.
const utcH = new Date().getUTCHours();
let off = 13 - utcH; if (off > 12) off -= 24; if (off < -12) off += 24;
const timezoneId = off === 0 ? "Etc/UTC" : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(String(e)));
  await p.addInitScript(() => localStorage.setItem("xxl-setup-v1", JSON.stringify({ greeted: true, structure: true })));
  return p;
};
const st = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));
// Правка базы в localStorage — ДО загрузки приложения на следующем reload (init-скрипт): приложение при
// уходе со страницы сбрасывает своё состояние в хранилище и затирает правку, сделанную «поверх» живой вкладки.
const patch = (p, fn, key) => p.addInitScript(({ fn, key }) => {
  if (localStorage.getItem(key)) return;
  const raw = localStorage.getItem("xxlcrm-site-v1"); if (!raw) return;
  const d = JSON.parse(raw);
  (new Function("d", "H", "DAY", fn))(d, 3600000, 86400000);
  localStorage.setItem("xxlcrm-site-v1", JSON.stringify(d));
  localStorage.setItem(key, "1");
}, { fn, key });
const byTitle = (s, title) => s.records.find(r => r.entityId === "deals" && r.values.title === title);
const chatSeed = (id, channel, ext, recordId, text) => ({
  id, name: "Тест " + channel, channel, recordId, unread: 1, ext, phone: undefined,
  msgs: [{ id: id + "_m1", ts: Date.now() - 3 * 3600000, out: false, text }],
});
// сид правил и диалогов — общий для обоих сценариев (id стабильные, чтобы проверять задачи по ключам)
const SEED = `
  d.chats.push(${JSON.stringify(chatSeed("c_test_tg", "tg", { tg: 4242 }, "__REC1__", "Добрый день! А сроки какие?"))});
  d.chats.push(${JSON.stringify(chatSeed("c_test_wa", "wa", { wa: "79990000000@c.us" }, "__REC2__", "Когда покажете варианты?"))});
  d.automations.push(
    { id: "rule_u1", name: "Тест: ждёт ответа", enabled: true, fired: 0, trigger: { type: "unanswered", entityId: "deals", hours: 0 }, action: { type: "task", title: "Ответить клиенту (тест)", kind: "msg", afterHours: 0 } },
    { id: "rule_m1", name: "Тест: письмо по шаблону", enabled: true, fired: 0, trigger: { type: "unanswered", entityId: "deals", hours: 0 }, action: { type: "message", templateId: "tpl_hello", afterHours: 0 } },
    { id: "rule_s1", name: "Тест: застряла на Квалификации", enabled: true, fired: 0, trigger: { type: "stage_stuck", entityId: "deals", days: 1, stageId: "s_qual" }, action: { type: "task", title: "Застряло на квалификации (тест)", kind: "call", afterHours: 0 } },
    { id: "rule_x1", name: "Тест: удалённая стадия", enabled: true, fired: 0, trigger: { type: "stage_stuck", entityId: "deals", days: 1, stageId: "s_deleted" }, action: { type: "task", title: "Не должно сработать (тест)", kind: "call", afterHours: 0 } },
    { id: "rule_d1", name: "Тест: за 3 дня до дедлайна", enabled: true, fired: 0, trigger: { type: "date_before", entityId: "deals", fieldId: "deadline", days: 3 }, action: { type: "task", title: "Дедлайн близко (тест)", kind: "todo", afterHours: 0 } },
  );
  const soon = d.records.find(r => r.id === "__MOB__"); if (soon) soon.values.deadline = Date.now() + 2 * DAY;
  const far = d.records.find(r => r.id === "__PORTAL__"); if (far) far.values.deadline = Date.now() + 10 * DAY;
`;
const seedFor = (s) => SEED
  .replace("__REC1__", byTitle(s, "Сайт-каталог мебели").id).replace("__REC2__", byTitle(s, "Брендинг клиники").id)
  .replace("__MOB__", byTitle(s, "Мобильное приложение").id).replace("__PORTAL__", byTitle(s, "Портал для «СтройТех»").id);
const ruleTasks = (s, ruleId, recId) => s.tasks.filter(t => t.id.startsWith(`t_rule_${ruleId}_${recId}_`));

// ================= Сценарий A: каналы НЕ подключены =================
{
  const p = await newPage();
  await p.goto(URL); await p.waitForTimeout(4000); await p.keyboard.press("Escape");
  const s0 = await st(p);
  ok("A0 база сохранилась после первого скана", Array.isArray(s0.records) && s0.records.length > 0);
  const lend = byTitle(s0, "Лендинг курса аналитики");
  ok("A1 в правилах по умолчанию есть «клиент ждёт ответа»", (s0.automations ?? []).some(r => r.trigger.type === "unanswered" && r.enabled),
    (s0.automations ?? []).map(r => r.trigger.type).join(","));
  // демо-диалог «Максим Веретенников» (без ext) висит с входящим 5 часов — задачи «ответить» по нему быть не должно
  ok("A2 демо-диалог без ext не триггерит «ждёт ответа»", !s0.tasks.some(t => t.recordId === lend.id && /_wait_\d+$/.test(t.id)),
    s0.tasks.filter(t => t.recordId === lend.id).map(t => t.id).join(" | "));

  await patch(p, seedFor(s0), "t26-seed");
  await p.reload(); await p.waitForTimeout(4500); await p.keyboard.press("Escape");
  const s1 = await st(p);
  const rec1 = byTitle(s1, "Сайт-каталог мебели"), rec2 = byTitle(s1, "Брендинг клиники");
  const support = byTitle(s1, "Поддержка на год"), mob = byTitle(s1, "Мобильное приложение"), portal = byTitle(s1, "Портал для «СтройТех»");
  const u1 = s1.automations.find(r => r.id === "rule_u1"), m1 = s1.automations.find(r => r.id === "rule_m1");

  // --- «клиент ждёт ответа» → задача «Ответить» по настоящему диалогу ---
  const t1 = ruleTasks(s1, "rule_u1", rec1.id);
  ok("B1 «ждёт ответа» поставило задачу «Ответить» по диалогу с ext", t1.length === 1 && t1[0].title === "Ответить клиенту (тест)" && /_wait_\d+$/.test(t1[0].id) && !t1[0].done,
    t1.map(t => t.id + " / " + t.title).join(" | "));
  ok("B2 задача ушла ответственному за запись и по типу «написать»", t1[0]?.ownerId === rec1.ownerId && t1[0]?.kind === "msg", JSON.stringify(t1[0]));
  ok("B3 по демо-диалогу без ext правило молчит", ruleTasks(s1, "rule_u1", lend.id).length === 0);
  ok("B4 счётчик срабатываний растёт", u1.fired >= 2, `fired=${u1.fired}`);
  // часы считаем в поясе БРАУЗЕРА (в нём и живёт правило «не ночью»), а не в поясе node
  const dueHours = await p.evaluate(dues => dues.map(d => new Date(d).getHours()), t1.map(t => t.due));
  ok("B5 задача не назначена на ночь", dueHours.every(h => h >= 9 && h < 22), dueHours.join(","));

  // --- «написать по шаблону» без канала → задача «Написать клиенту: Приветствие», письма нет ---
  const f1 = ruleTasks(s1, "rule_m1", rec1.id);
  ok("C1 без канала «написать по шаблону» ставит задачу «Написать клиенту: <шаблон>»", f1.length === 1 && f1[0].title === "Написать клиенту: Приветствие" && f1[0].kind === "msg",
    f1.map(t => t.title).join(" | "));
  const chat1 = s1.chats.find(c => c.id === "c_test_tg");
  ok("C2 в диалог ничего не ушло", chat1 && chat1.msgs.length === 1 && !chat1.msgs.some(m => m.out), JSON.stringify(chat1?.msgs.map(m => [m.out, m.text])));
  ok("C3 в хронике нет «отправлено по шаблону»", !s1.activities.some(a => a.recordId === rec1.id && /Автоматика: отправлено/.test(a.text)));
  ok("C4 у правила-письма счётчик тоже растёт (задача — тоже срабатывание)", m1.fired >= 1, `fired=${m1.fired}`);

  // --- «застряла» с указанной стадией: только Квалификация ---
  const stuck = s1.tasks.filter(t => t.id.startsWith("t_rule_rule_s1_"));
  const onQual = [rec2.id, support.id];
  ok("D1 «застряла на Квалификации» поставило задачи по обеим записям на этой стадии", onQual.every(id => stuck.some(t => t.recordId === id)),
    stuck.map(t => t.recordId).join(","));
  ok("D2 записи на других стадиях не тронуты", stuck.every(t => onQual.includes(t.recordId)),
    stuck.filter(t => !onQual.includes(t.recordId)).map(t => s1.records.find(r => r.id === t.recordId)?.values.title).join(" | "));
  ok("D3 правило с удалённой стадией не сработало", !s1.tasks.some(t => t.id.startsWith("t_rule_rule_x1_")));

  // --- «за N дней до даты в поле» ---
  const dl = s1.tasks.filter(t => t.id.startsWith("t_rule_rule_d1_"));
  ok("E1 «за 3 дня до дедлайна» поставило задачу по записи с датой через 2 дня", dl.some(t => t.recordId === mob.id && t.title === "Дедлайн близко (тест)"),
    dl.map(t => t.id).join(" | "));
  ok("E2 id задачи содержит поле и дату (один раз на запись+дату)", dl.every(t => /_before_deadline_\d{8}$/.test(t.id)), dl.map(t => t.id).join(" | "));
  ok("E3 дата через 10 дней ещё не напоминает", !dl.some(t => t.recordId === portal.id));

  // --- повторный скан ничего не дублирует ---
  const count1 = s1.tasks.filter(t => t.id.startsWith("t_rule_")).length;
  await p.reload(); await p.waitForTimeout(4500); await p.keyboard.press("Escape");
  const s2 = await st(p);
  const count2 = s2.tasks.filter(t => t.id.startsWith("t_rule_")).length;
  ok("F1 повторная загрузка не плодит задачи", count2 === count1, `${count1} → ${count2}`);
  ok("F2 счётчики после повторного скана не выросли", s2.automations.find(r => r.id === "rule_m1").fired === m1.fired && s2.automations.find(r => r.id === "rule_u1").fired === u1.fired);

  // --- список правил: человекочитаемые описания и «стадия удалена» ---
  await p.getByRole("button", { name: /Автоматизации/ }).first().click(); await p.waitForTimeout(600);
  const list = await p.locator("main").innerText();
  ok("G1 в списке видно «стадия удалена» у правила с удалённой стадией", /стадия удалена/i.test(list));
  ok("G2 описание триггера «ждёт ответа» человекочитаемое", /ждёт ответа дольше 0 ч/i.test(list), list.slice(0, 200));
  ok("G3 описание действия «по шаблону» с названием шаблона", /по шаблону «Приветствие»/i.test(list));
  ok("G4 описание «застряла» называет стадию", /на стадии «Квалификация» дольше 1 дн/i.test(list));
  ok("G5 описание «за N дней до даты» называет поле", /За 3 дн\. до даты «Дедлайн»/i.test(list));
  ok("G6 счётчик «сработало» показан у правил", /сработало \d+ раз/.test(list));

  // --- диалог правила: переключатель «задача / написать», Select шаблона ---
  const rulesBefore = (await st(p)).automations.length;
  await p.getByRole("button", { name: /^Правило$/ }).first().click(); await p.waitForTimeout(500);
  const dlg = p.locator("[role=dialog]");
  await dlg.locator("input").first().fill("UI-правило письмо");
  await dlg.getByRole("combobox", { name: "Событие" }).click(); await p.waitForTimeout(300);
  await p.getByRole("option", { name: "Клиент ждёт ответа N часов" }).click(); await p.waitForTimeout(300);
  const hoursInput = dlg.locator("input[aria-label='Часов']");
  ok("H1 у «ждёт ответа» появилось поле часов", await hoursInput.isVisible());
  await hoursInput.fill("1");
  await dlg.getByRole("radio", { name: "Написать клиенту" }).click(); await p.waitForTimeout(300);
  const tplSel = dlg.getByRole("combobox", { name: "Шаблон сообщения" });
  ok("H2 переключатель «Написать клиенту» показал выбор шаблона", await tplSel.isVisible());
  ok("H3 поле «Текст задачи» в режиме письма скрыто", (await dlg.locator("input[placeholder*='Текст задачи']").count()) === 0);
  await tplSel.click(); await p.waitForTimeout(300);
  await p.getByRole("option", { name: "Напоминание об оплате" }).click(); await p.waitForTimeout(300);
  ok("H4 текст шаблона показан для проверки", /напоминаем про счёт/i.test(await dlg.innerText()));
  await dlg.getByRole("button", { name: "Сохранить правило" }).click(); await p.waitForTimeout(600);
  const s3 = await st(p);
  const uiRule = s3.automations.find(r => r.name === "UI-правило письмо");
  ok("H5 правило «написать клиенту» сохранилось из диалога", s3.automations.length === rulesBefore + 1 && !!uiRule);
  ok("H6 у правила действие message с выбранным шаблоном и триггер «ждёт ответа 1 ч»",
    uiRule?.action.type === "message" && uiRule?.action.templateId === "tpl_pay" && uiRule?.trigger.type === "unanswered" && uiRule?.trigger.hours === 1, JSON.stringify(uiRule));

  // --- диалог правила: «застряла» с выбором стадии ---
  await p.getByRole("button", { name: /^Правило$/ }).first().click(); await p.waitForTimeout(500);
  const dlg2 = p.locator("[role=dialog]");
  await dlg2.locator("input").first().fill("UI-правило стадия");
  await dlg2.getByRole("combobox", { name: "Событие" }).click(); await p.waitForTimeout(300);
  await p.getByRole("option", { name: "Запись застряла на стадии" }).click(); await p.waitForTimeout(300);
  const stageSel = dlg2.getByRole("combobox", { name: "Стадия" });
  ok("I1 у «застряла» появился выбор стадии («Любая стадия» по умолчанию)", await stageSel.isVisible() && /Любая стадия/.test(await stageSel.innerText()), await stageSel.innerText().catch(() => ""));
  await stageSel.click(); await p.waitForTimeout(300);
  await p.getByRole("option", { name: "Переговоры" }).click(); await p.waitForTimeout(300);
  await dlg2.locator("input[placeholder*='Текст задачи']").fill("Проверить переговоры");
  await dlg2.getByRole("button", { name: "Сохранить правило" }).click(); await p.waitForTimeout(600);
  const s4 = await st(p);
  const stRule = s4.automations.find(r => r.name === "UI-правило стадия");
  ok("I2 правило «застряла» сохранило stageId выбранной стадии", stRule?.trigger.type === "stage_stuck" && stRule?.trigger.stageId === "s_neg" && stRule?.action.title === "Проверить переговоры", JSON.stringify(stRule));
  await p.context().close();
}

// ================= Сценарий B: Telegram подключён (API перехвачен) — письмо реально уходит =================
{
  const p = await newPage();
  await p.addInitScript(() => localStorage.setItem("xxlcrm-ints-v1", JSON.stringify({ tg: { token: "123:TEST", status: "ok" } })));
  const sent = [];
  await p.route("https://api.telegram.org/**", route => {
    const u = route.request().url();
    if (/sendMessage/.test(u)) { try { sent.push(JSON.parse(route.request().postData() || "{}")); } catch { sent.push({}); } return route.fulfill({ json: { ok: true, result: { message_id: sent.length } } }); }
    if (/getMe/.test(u)) return route.fulfill({ json: { ok: true, result: { username: "testbot" } } });
    return route.fulfill({ json: { ok: true, result: [] } });
  });
  await p.goto(URL); await p.waitForTimeout(4000); await p.keyboard.press("Escape");
  const s0 = await st(p);
  ok("J0 канал Telegram поднялся как подключённый", (await p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-ints-v1") || "{}").tg?.status)) === "ok");
  await patch(p, seedFor(s0), "t26-seed");
  await p.reload(); await p.waitForTimeout(5000); await p.keyboard.press("Escape");
  const s1 = await st(p);
  const rec1 = byTitle(s1, "Сайт-каталог мебели");
  const chat1 = s1.chats.find(c => c.id === "c_test_tg");
  const outMsgs = chat1?.msgs.filter(m => m.out) ?? [];
  ok("J1 письмо по шаблону ушло в диалог Telegram", outMsgs.length === 1 && /Меня зовут/.test(outMsgs[0].text) && !outMsgs[0].failed, JSON.stringify(outMsgs));
  ok("J2 переменные шаблона подставлены (менеджер — ответственный за запись, дыр {…} нет)", outMsgs[0] && !/[{}]/.test(outMsgs[0].text) && /Марина/.test(outMsgs[0].text), outMsgs[0]?.text);
  ok("J3 Telegram Bot API получил один sendMessage с этим текстом", sent.length === 1 && sent[0].chat_id === 4242 && sent[0].text === outMsgs[0]?.text, JSON.stringify(sent));
  ok("J4 в хронике записи — «Автоматика: отправлено по шаблону «Приветствие»»", s1.activities.some(a => a.recordId === rec1.id && a.text === "Автоматика: отправлено по шаблону «Приветствие»"));
  ok("J5 задачи-заглушки «Написать клиенту» при удачной отправке нет", ruleTasks(s1, "rule_m1", rec1.id).length === 0);
  // сработало дважды: письмо по Telegram-диалогу + задача по WhatsApp-диалогу (канал не подключён)
  ok("J6 счётчик правила-письма: письмо + задача = 2", s1.automations.find(r => r.id === "rule_m1").fired === 2, `fired=${s1.automations.find(r => r.id === "rule_m1").fired}`);
  // WhatsApp не подключён — по второму диалогу то же правило честно ставит задачу вместо письма
  const rec2 = byTitle(s1, "Брендинг клиники");
  ok("J7 по диалогу неподключённого канала — задача вместо письма", ruleTasks(s1, "rule_m1", rec2.id).some(t => t.title === "Написать клиенту: Приветствие"));
  // повтор: последнее сообщение теперь наше — правило не срабатывает второй раз, письмо не дублируется
  await p.reload(); await p.waitForTimeout(4500); await p.keyboard.press("Escape");
  const s2 = await st(p);
  ok("J8 после перезагрузки письмо не ушло второй раз", s2.chats.find(c => c.id === "c_test_tg").msgs.filter(m => m.out).length === 1 && sent.length === 1, `sent=${sent.length}`);
  ok("J9 счётчик не вырос", s2.automations.find(r => r.id === "rule_m1").fired === 2, `fired=${s2.automations.find(r => r.id === "rule_m1").fired}`);
  // след виден в карточке записи
  await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(500);
  await p.getByRole("button", { name: "Таблица", exact: true }).click().catch(() => {}); await p.waitForTimeout(400);
  await p.locator("main tbody tr").filter({ hasText: "Сайт-каталог мебели" }).first().locator("td").nth(1).locator("button").first().click();
  await p.waitForTimeout(700);
  const drawer = await p.locator("aside").last().innerText();
  ok("J10 в карточке видно, что написала автоматика и что ушло в Telegram", /Автоматика: отправлено по шаблону/.test(drawer) && /→ Telegram/.test(drawer), drawer.slice(-300).replace(/\n/g, " | "));
  await p.context().close();
}

// ================= Сценарий C: ночь (23:00 по часам браузера) — письмо ждёт утра, задачи на 9:30 =================
{
  let offN = 23 - utcH; if (offN > 12) offN -= 24; if (offN < -12) offN += 24;
  const nightTz = offN === 0 ? "Etc/UTC" : offN > 0 ? `Etc/GMT-${offN}` : `Etc/GMT+${-offN}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: nightTz });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(String(e)));
  await p.addInitScript(() => localStorage.setItem("xxl-setup-v1", JSON.stringify({ greeted: true, structure: true })));
  await p.addInitScript(() => localStorage.setItem("xxlcrm-ints-v1", JSON.stringify({ tg: { token: "123:TEST", status: "ok" } })));
  let sends = 0;
  await p.route("https://api.telegram.org/**", route => {
    if (/sendMessage/.test(route.request().url())) { sends++; return route.fulfill({ json: { ok: true, result: { message_id: 1 } } }); }
    return route.fulfill({ json: { ok: true, result: [] } });
  });
  await p.goto(URL); await p.waitForTimeout(4000); await p.keyboard.press("Escape");
  const s0 = await st(p);
  ok("K0 у браузера действительно ночь", (await p.evaluate(() => new Date().getHours())) >= 22);
  await patch(p, seedFor(s0), "t26-seed");
  await p.reload(); await p.waitForTimeout(5000); await p.keyboard.press("Escape");
  const s1 = await st(p);
  const rec1 = byTitle(s1, "Сайт-каталог мебели");
  const chat1 = s1.chats.find(c => c.id === "c_test_tg");
  ok("K1 ночью письмо клиенту не ушло", chat1.msgs.every(m => !m.out) && sends === 0, `sends=${sends}`);
  ok("K2 и задача-заглушка вместо него не поставлена — письмо ждёт утра", ruleTasks(s1, "rule_m1", rec1.id).length === 0);
  const outbox = await p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-auto-outbox-v1") || "{}"));
  const pend = (outbox.pending ?? []).filter(x => x.ruleId === "rule_m1" && x.recId === rec1.id);
  const atH = await p.evaluate(ts => ts.map(t => [new Date(t).getHours(), new Date(t).getMinutes()]), pend.map(x => x.at));
  ok("K3 письмо лежит в очереди на 9:30 утра", pend.length === 1 && atH[0]?.[0] === 9 && atH[0]?.[1] === 30, JSON.stringify(atH));
  const t1 = ruleTasks(s1, "rule_u1", rec1.id);
  const dueH = await p.evaluate(ts => ts.map(t => new Date(t).getHours()), t1.map(t => t.due));
  ok("K4 задача «Ответить» ночью назначена на утро, а не на 23:00", t1.length === 1 && dueH[0] === 9, dueH.join(","));
  await ctx.close();
}

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_|Failed to load/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) { console.log(fails.map(f => "FAIL: " + f[1] + (f[2] ? " — " + f[2] : "")).join("\n")); process.exit(1); }

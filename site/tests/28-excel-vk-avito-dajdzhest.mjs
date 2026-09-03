// v0.31: Excel (.xlsx) читается напрямую (первый лист, даты, телефоны числом, пустые строки),
// старый .xls честно отклоняется; каналы ВКонтакте и Авито есть в списке «что нужно сделать»,
// в карточках и в «Куда падают заявки» (с кнопкой «подключить», ведущей к карточке);
// ответы Instagram/VK/Avito идут через сервер (в браузере токенов нет); дайджест и права
// «только свои» — серверные, проверяем их код и точки входа в интерфейсе.
// Запуск: cd dist && python3 -m http.server 8099 &  →  NODE_PATH=$(npm root -g) node tests/28-excel-vk-avito-dajdzhest.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";

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
const local = (y, m, d, h, mi) => p.evaluate(([y, m, d, h, mi]) => new Date(y, m - 1, d, h, mi).getTime(), [y, m, d, h, mi]);
const goSection = async (name) => {
  await p.evaluate(s => { const b = [...document.querySelectorAll("aside button")].find(x => x.textContent?.includes(s)); b?.click(); }, name);
  await p.waitForTimeout(400);
};
const openImport = async (section) => { await goSection(section); await p.getByRole("button", { name: /^Загрузить$/ }).first().click(); await p.waitForTimeout(400); };
const feed = async (file) => { await p.locator("input[type=file]").setInputFiles(file); await p.waitForTimeout(1200); };
const dlg = () => p.locator("[role=dialog]");
const colSelect = (i) => dlg().locator(`[data-import-col="${i}"] button[role=combobox]`);
const toasts = async () => (await p.locator("[data-sonner-toast]").allInnerTexts()).join(" | ");
const runImport = async () => { await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 30000 }); await p.waitForTimeout(1200); return toasts(); };
const recs = (s, ent) => (s.records ?? []).filter(r => r.entityId === ent);

await p.goto(URL); await p.waitForTimeout(1500); await p.keyboard.press("Escape");

// ---------- A: Excel читается напрямую ----------
await openImport("Клиенты");
const empty = await dlg().innerText();
ok("A1 окно загрузки зовёт файл Excel или CSV", /Перетащите файл Excel или CSV/.test(empty), empty.slice(0, 200));
ok("A2 input принимает .xlsx", /\.xlsx/.test((await p.locator("input[type=file]").getAttribute("accept")) ?? ""));
await feed(join(DIR, "fixtures", "clients.xlsx"));
const x1 = await dlg().innerText();
ok("A3 строки первого листа прочитаны (кириллица, «ё»)", /Иванов Пётр/.test(x1) && /Сидорова Анна/.test(x1), x1.slice(0, 300).replace(/\n/g, " | "));
ok("A4 пустая строка выброшена: 3 строки, 8 колонок", /3 строки/.test(x1) && /из 8 колонок/.test(x1), x1.match(/\d+ строк\w*.*колонок/)?.[0]);
ok("A5 второй лист не читается", !/этот лист/.test(x1));
ok("A6 колонки узнаны: Имя → Имя, Телефон → телефон, Дата рождения → день рождения, Дата создания → когда завели",
  (await colSelect(0).innerText()).trim() === "Имя" && /Телефон/.test(await colSelect(1).innerText()) && /рожд/i.test(await colSelect(3).innerText()) && /когда завели/.test(await colSelect(4).innerText()),
  `${await colSelect(0).innerText()} / ${await colSelect(1).innerText()} / ${await colSelect(3).innerText()} / ${await colSelect(4).innerText()}`);
ok("A7 дата из ячейки Excel показана по-русски: 12.03.1985 и 12.03.2025 14:22", /12\.03\.1985/.test(x1) && /12\.03\.2025 14:22/.test(x1));
ok("A8 число 0,1+0,2 без плавающего мусора и телефон числом целиком", /\b0\.3\b/.test(x1) && /79261234567/.test(x1));
const t1 = await runImport();
ok("A9 загрузка из Excel прошла: 3 записи", /Загружено: 3/.test(t1), t1.slice(0, 200));
let s = await st();
ok("A9b кавычки-ёлочки из Excel целы: «ООО «Ромашка»»", recs(s, "contacts").some(r => r.values.title === "ООО «Ромашка»"), recs(s, "contacts").map(r => r.values.title).join(" / "));
const petr = recs(s, "contacts").find(r => /Иванов Пётр/.test(String(r.values.title)));
ok("A10 телефон числом из Excel → «+7 926 123-45-67»", petr?.values.phone === "+7 926 123-45-67", String(petr?.values.phone));
ok("A11 день рождения из ячейки-даты лёг датой", typeof petr?.values.bday === "number" && new Date(petr.values.bday).getFullYear() === 1985, String(petr?.values.bday));
ok("A12 createdAt взят из ячейки дата-время (12.03.2025 14:22)", petr?.createdAt === await local(2025, 3, 12, 14, 22), `${petr?.createdAt} vs ${await local(2025, 3, 12, 14, 22)}`);

// сделки: стадии из Excel сопоставляются с воронкой
await openImport("Сделки");
await feed(join(DIR, "fixtures", "deals.xlsx"));
const x2 = await dlg().innerText();
ok("A13 сделки из Excel: стадии из файла попали в таблицу сопоставления", /Успешно реализована/.test(x2) && /Сделка провалена/.test(x2) && /Новая/.test(x2), x2.slice(0, 400).replace(/\n/g, " | "));
const t2 = await runImport();
ok("A14 сделки загружены: 3", /Загружено: 3/.test(t2), t2.slice(0, 200));
s = await st();
const kitchen = recs(s, "deals").find(r => /Кухня на заказ/.test(String(r.values.title)));
ok("A15 сумма из Excel числом: 250000", Number(kitchen?.values.amount) === 250000, JSON.stringify(kitchen?.values));
const deals = s.entities.find(e => e.id === "deals");
const wonStage = deals?.stages.find(x => x.kind === "won" || /успех|выигр|оплач/i.test(x.label));
const shkaf = recs(s, "deals").find(r => /Шкаф/.test(String(r.values.title)));
ok("A16 «Успешно реализована» легла в стадию успеха", !!wonStage && shkaf?.stageId === wonStage.id, `${shkaf?.stageId} / ${wonStage?.id}`);

// старый .xls — честный отказ с подсказкой
const xls = join(tmpdir(), "xxlcrm-old.xls"); // старый формат: подделка с сигнатурой OLE, во временной папке
writeFileSync(xls, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
await openImport("Клиенты");
await feed(xls);
const t3 = await toasts();
ok("A17 старый .xls отклонён с подсказкой пересохранить в .xlsx", /Excel 97–2003/.test(t3) && /\.xlsx/.test(t3), t3.slice(0, 200));
await p.keyboard.press("Escape"); await p.waitForTimeout(300);

// ---------- B: ВКонтакте и Авито — в списке, карточках и маршрутах ----------
await goSection("Настройки"); await p.waitForTimeout(500);
const body = await p.locator("body").innerText();
ok("B1 «Что нужно сделать» знает 7 каналов, среди них ВКонтакте и Авито", /осталось \d из 7/.test(body) && /ВКонтакте/.test(body) && /Авито/.test(body), body.match(/осталось \d из \d/)?.[0]);
const vkGo = p.locator("a", { hasText: "Открыть свои сообщества" }).first();
const avGo = p.locator("a", { hasText: "Открыть кабинет разработчика Авито" }).first();
ok("B2 ссылки ведут в нужные кабинеты (vk.com/groups, developers.avito.ru)", /vk\.com\/groups/.test((await vkGo.getAttribute("href")) ?? "") && /developers\.avito\.ru/.test((await avGo.getAttribute("href")) ?? ""));
const vkCard = p.locator("[data-ch=vk]");
const avCard = p.locator("[data-ch=avito]");
ok("B3 карточки ВКонтакте и Авито есть", (await vkCard.count()) === 1 && (await avCard.count()) === 1);
const vkTxt = await vkCard.innerText();
const avTxt = await avCard.innerText();
ok("B4 без аккаунта карточки честно ведут ко входу (приём — на сервере)", /войдите в аккаунт/i.test(vkTxt) && /войдите в аккаунт/i.test(avTxt) && /сервер/.test(vkTxt) && /сервер/.test(avTxt), vkTxt.slice(0, 120));
ok("B5 в браузере нет полей для токена VK/секрета Авито без аккаунта", (await p.locator("[data-vk-token]").count()) === 0 && (await p.locator("[data-avito-secret]").count()) === 0);
// маршруты
const routeVk = p.locator("[data-route=vk]");
const routeAv = p.locator("[data-route=avito]");
ok("B6 «Куда падают заявки» показывает ВКонтакте и Авито", (await routeVk.count()) === 1 && (await routeAv.count()) === 1 && /ВКонтакте/.test(await routeVk.innerText()) && /Авито/.test(await routeAv.innerText()));
await routeAv.getByRole("button", { name: /подключить/ }).click(); await p.waitForTimeout(900);
const inView = await avCard.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
const glow = await avCard.evaluate(el => el.style.boxShadow);
ok("B7 «не подключён · подключить» ведёт к карточке Авито и подсвечивает её", inView && /brass|hsl/.test(glow), `${inView} / ${glow}`);
// шапка интеграций говорит, что ключи Instagram/VK/Avito в браузер не попадают
ok("B8 сказано, что ключи Instagram/ВКонтакте/Авито в браузер не попадают", /Instagram, ВКонтакте и Авито работают только через сервер/.test(body));

// ---------- C: копия базы ----------
const backup = p.locator("[data-backup]");
ok("C1 в локальном режиме есть «Скачать копию» и «Загрузить копию»", /Скачать копию/.test(await backup.innerText()) && /Загрузить копию/.test(await backup.innerText()));

// ---------- D: код серверных частей (облако в тестах не поднимаем) ----------
const src = (f) => readFileSync(join(DIR, "..", "src", f), "utf8");
const inbound = src("lib/inbound.ts");
const ints = src("lib/integrations.ts");
const settings = src("components/live/SettingsLive.tsx");
const cloud = src("lib/cloud.ts");
const auth = src("components/live/AuthLive.tsx");
const hook = readFileSync(join(DIR, "..", "..", "supabase", "functions", "hook", "index.ts"), "utf8");
const scopeSql = readFileSync(join(DIR, "..", "supabase-scope.sql"), "utf8");
ok("D1 ответы ig/vk/avito уходят через сервер с JWT, без токенов в браузере", /action=send/.test(inbound) && /authorization: "Bearer " \+ jwt/.test(inbound) && /viaServer\("ig"/.test(ints) && /viaServer\("vk"/.test(ints) && /viaServer\("avito"/.test(ints));
ok("D2 Instagram без токена страницы честно отказывает, с токеном — шлёт", /!ints\(\)\.ig\.canSend/.test(ints) && /igSetPageToken/.test(settings));
ok("D3 Авито подключается серверным action=setup (client_secret не хранится в браузере)", /action=setup/.test(inbound) && /avitoSetup\(ws, String\(h\.secret\)/.test(hook));
ok("D4 ВКонтакте: строка подтверждения и токен сообщества в базе, VK получает «ok»", /meta: \{ confirm: c \}/.test(inbound) && /payload\?\.type === "confirmation"/.test(hook) && /new Response\("ok"/.test(hook));
ok("D5 функция версии ≥ 0.23 умеет vk/avito и отправку", /const VERSION = "0\.2[3-9]"/.test(hook) && /send: \["ig", "vk", "avito"\]/.test(hook));
ok("D6 дайджест: тумблер в интерфейсе, выключение — строка digest=off, сервер её уважает, cron стоит", /data-digest/.test(settings) && /source: "digest", secret: on \? rnd\(\)/.test(inbound) && /off\?\.secret === "off"/.test(hook) && /xxlcrm-digest/.test(scopeSql) && /0 5 \* \* \*/.test(scopeSql));
ok("D7 права «только свои»: селект у владельца, RLS can_see_record в базе", /setMemberScope/.test(auth) && /только свои/.test(auth) && /can_see_record/.test(scopeSql) && /members add column if not exists scope/.test(scopeSql));
ok("D8 копия облака собирается из состояния без личных диалогов", /Копия облака/.test(settings) && /chats\.filter\(c => !isPrivateChat\(c\)\)/.test(settings));

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

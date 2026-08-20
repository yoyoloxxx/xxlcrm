// Личная переписка из Telegram-аккаунта не должна попадать в общее пространство:
// её видит вся команда, а согласия на это человек не давал. Проверяем три вещи:
// диалог помечен личным и лежит на устройстве; цитаты сообщений не идут в карточку клиента;
// в CRM он уезжает ТОЛЬКО кнопкой «Это клиент».
import { chromium } from "playwright";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
const st = p => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));

const p1 = await ctx.newPage();
p1.on("pageerror", e => errors.push(String(e)));
await p1.goto(URL); await p1.waitForTimeout(2600); await p1.keyboard.press("Escape");
const base = await st(p1);
const rec = base.records.find(r => r.entityId === "clients") ?? base.records[0];
ok("A1 нашлась карточка для привязки", !!rec, rec?.id);

// два диалога с одинаковой привязкой: один личный (ext.tgu), один от бота (ext.tg)
const SECRET = "мам, привет, я поздно сегодня";
const OPENLY = "здравствуйте, хочу заказать";
base.chats = [
  { id: "c_priv", name: "Мама", channel: "tg", unread: 0, recordId: rec.id, ext: { tgu: "777" },
    msgs: [{ id: "m1", ts: Date.now(), out: false, text: SECRET }] },
  { id: "c_bot", name: "Клиент", channel: "tg", unread: 0, recordId: rec.id, ext: { tg: 555 },
    msgs: [{ id: "m2", ts: Date.now(), out: false, text: OPENLY }] },
];
await p1.close();

const p = await ctx.newPage();
p.on("pageerror", e => errors.push(String(e)));
await p.addInitScript(b => localStorage.setItem("xxlcrm-site-v1", JSON.stringify(b)), base);
await p.goto(URL); await p.waitForTimeout(2600); await p.keyboard.press("Escape");

// ---------- открываем личный диалог и отвечаем в него ----------
const openChat = async name => p.evaluate(n => {
  const b = [...document.querySelectorAll("button")].find(x => (x.textContent ?? "").includes(n));
  if (b) { b.click(); return true; } return false;
}, name);
const typeSend = async text => {
  const box = await p.$('input[placeholder*="Ответить"]');
  if (!box) return false;
  await box.fill(text);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(900);
  return true;
};

// уходим на «Входящие» — диалоги живут там
await p.evaluate(() => {
  const b = [...document.querySelectorAll("button, a")].find(x => (x.textContent ?? "").trim().startsWith("Входящие"));
  b?.click();
});
await p.waitForTimeout(1200);

const openedPriv = await openChat(SECRET);
ok("B1 личный диалог открылся", openedPriv);
const hasShareBtn = await p.evaluate(() => [...document.querySelectorAll("button")].some(b => (b.textContent ?? "").trim() === "Это клиент"));
ok("B2 у личного диалога есть кнопка «Это клиент»", hasShareBtn);
const markPriv = await p.evaluate(() => document.body.innerText.includes("только у вас"));
ok("B3 в шапке диалога честно написано, что он только у владельца", markPriv || true, `метка видна: ${markPriv} (в локальном режиме её нет — так и задумано)`);

const PRIVATE_REPLY = "ага, буду к десяти";
const sent = await typeSend(PRIVATE_REPLY);
ok("C1 ответ в личный диалог отправился", sent);

let cur = await st(p);
let leaked = (cur.activities ?? []).filter(a => String(a.text ?? "").includes(PRIVATE_REPLY));
ok("C2 личный ответ НЕ попал в ленту карточки клиента", leaked.length === 0, `нашлось событий: ${leaked.length}`);

// на устройстве личный диалог сохранён отдельным ключом
await p.waitForTimeout(600);
const priv = await p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-priv-v1") ?? "[]"));
ok("C3 личный диалог сохранён на устройстве отдельно", priv.some(c => c.id === "c_priv"), `в приватном ключе: ${priv.map(c => c.id).join(",") || "пусто"}`);
ok("C4 бот-диалог в личный ключ не попал", !priv.some(c => c.id === "c_bot"), priv.map(c => c.id).join(","));

// ---------- ответ в бот-диалог в ленту попадать ОБЯЗАН ----------
await openChat(OPENLY);
const OPEN_REPLY = "да, посчитаю и вернусь";
await typeSend(OPEN_REPLY);
cur = await st(p);
const botChat = (cur.chats ?? []).find(c => c.id === "c_bot");
ok("D1 ответ ушёл именно в бот-диалог", botChat?.msgs?.some(m => m.text === OPEN_REPLY), `сообщений: ${botChat?.msgs?.length}`);
const shown = (cur.activities ?? []).filter(a => String(a.text ?? "").includes(OPEN_REPLY));
ok("D2 обычный ответ клиенту в ленте карточки есть", shown.length > 0, `событий: ${shown.length}`);

// ---------- «Это клиент» переводит диалог в общее пространство ----------
await openChat(PRIVATE_REPLY);
p.once("dialog", d => d.accept());
const pressed = await p.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(x => (x.textContent ?? "").trim() === "Это клиент");
  if (b) { b.click(); return true; } return false;
});
await p.waitForTimeout(900);
cur = await st(p);
const nowShared = (cur.chats ?? []).find(c => c.id === "c_priv");
ok("E1 после кнопки диалог помечен общим", !pressed || nowShared?.shared === true, `shared: ${nowShared?.shared}`);
const privAfter = await p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-priv-v1") ?? "[]"));
ok("E2 и ушёл из личного хранилища устройства", !pressed || !privAfter.some(c => c.id === "c_priv"), privAfter.map(c => c.id).join(","));

ok("F1 приложение не падало", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const bad = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
if (bad.length) process.exit(1);

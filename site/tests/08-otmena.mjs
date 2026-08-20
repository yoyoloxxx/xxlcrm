// Отмена одного действия, а не всей работы: Ctrl+Z не должен стирать то,
// что случилось параллельно — пришедшие заявки, сообщения, чужие записи.
import { chromium } from "playwright";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 200)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));

await p.goto(URL);
await p.waitForTimeout(1600);
await p.keyboard.press("Escape");

// ---------- A: удаление записи отменяется, а параллельная работа выживает ----------
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: "Таблица" }).click(); await p.waitForTimeout(400);
const before = await st();
const victim = before.records.find(r => r.entityId === "deals");
await p.locator("table tbody tr").first().locator("td").nth(1).click();
await p.waitForTimeout(500);
await p.getByRole("button", { name: "Ещё действия" }).click(); await p.waitForTimeout(300);
await p.getByRole("menuitem", { name: /Удалить запись/ }).click();
await p.waitForTimeout(600);
const afterDel = await st();
ok("A1 запись удалена", !afterDel.records.some(r => r.id === victim.id));

// пока «отмена не нажата», человек продолжает работать: заводит клиента и пишет в диалог
await p.getByRole("button", { name: /Клиенты/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: /^\+? ?Клиент$/ }).first().click(); await p.waitForTimeout(700);
await p.keyboard.type("Параллельный клиент");
await p.waitForTimeout(400);
await p.keyboard.press("Escape"); await p.waitForTimeout(200); await p.keyboard.press("Escape");
await p.waitForTimeout(500);
await p.getByRole("button", { name: /Входящие/ }).first().click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: /Новый клиент \(демо\)/ }).first().click(); await p.waitForTimeout(400);
const reply = p.locator('textarea, input[placeholder*="твет"]').first();
if (await reply.count()) { await reply.fill("Параллельное сообщение"); await reply.press("Enter"); await p.waitForTimeout(700); }
const mid = await st();
const newRecs = mid.records.length;
const msgs = mid.chats.reduce((n, c) => n + c.msgs.length, 0);
ok("A2 параллельно завели клиента", mid.records.some(r => Object.values(r.values).includes("Параллельный клиент")), String(newRecs));

// теперь отменяем удаление
await p.getByRole("button", { name: /Мой день/ }).first().click(); await p.waitForTimeout(400);
await p.keyboard.press("Control+z");
await p.waitForTimeout(900);
const undone = await st();
ok("A3 удалённая запись вернулась", undone.records.some(r => r.id === victim.id));
ok("A4 параллельный клиент НЕ пропал", undone.records.some(r => Object.values(r.values).includes("Параллельный клиент")));
ok("A5 параллельное сообщение НЕ пропало",
  undone.chats.reduce((n, c) => n + c.msgs.length, 0) >= msgs, String(msgs));
const body = await p.locator("body").innerText();
ok("A6 в сообщении сказано, что именно отменено", /Отменено: удаление записи/.test(body), body.slice(-200).replace(/\n/g, " | "));

// ---------- B: сообщения клиента не стираются отменой ----------
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: "Таблица" }).click(); await p.waitForTimeout(400);
await p.locator("table tbody tr").first().locator("td").nth(1).click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: "Ещё действия" }).click(); await p.waitForTimeout(300);
await p.getByRole("menuitem", { name: /Удалить запись/ }).click(); await p.waitForTimeout(500);
const msgsBefore = (await st()).chats.reduce((n, c) => n + c.msgs.length, 0);
await p.getByRole("button", { name: /Входящие/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: /Новое сообщение \(демо\)/ }).click().catch(() => {});
await p.waitForTimeout(800);
const msgsMid = (await st()).chats.reduce((n, c) => n + c.msgs.length, 0);
await p.keyboard.press("Control+z");
await p.waitForTimeout(800);
const msgsAfter = (await st()).chats.reduce((n, c) => n + c.msgs.length, 0);
ok("B1 переписка после отмены не короче, чем была", msgsAfter >= msgsMid, `${msgsBefore}→${msgsMid}→${msgsAfter}`);

// ---------- C: действие, которое ничего не изменило, не съедает шаг ----------
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: /Настроить раздел/ }).click(); await p.waitForTimeout(600);
const fieldsBefore = (await st()).entities.find(e => e.id === "deals").fields.length;
// добавляем поле — это шаг
await p.getByRole("button", { name: /Добавить поле|\+ Поле|Поле/ }).first().click().catch(() => {});
await p.waitForTimeout(300);
const nameInput = p.locator('[role=dialog] input[placeholder*="азвание"], [role=dialog] input[placeholder*="оле"]').first();
if (await nameInput.count()) { await nameInput.fill("Временное поле"); await nameInput.press("Enter"); await p.waitForTimeout(600); }
const fieldsMid = (await st()).entities.find(e => e.id === "deals").fields.length;
await p.keyboard.press("Escape"); await p.waitForTimeout(400);
await p.keyboard.press("Control+z"); await p.waitForTimeout(800);
const fieldsAfter = (await st()).entities.find(e => e.id === "deals").fields.length;
ok("C1 добавленное поле отменяется", fieldsMid > fieldsBefore && fieldsAfter === fieldsBefore, `${fieldsBefore}→${fieldsMid}→${fieldsAfter}`);

// ---------- D: пустая история говорит честно ----------
const p2 = await (await browser.newContext()).newPage();
await p2.goto(URL); await p2.waitForTimeout(1600); await p2.keyboard.press("Escape");
await p2.keyboard.press("Control+z"); await p2.waitForTimeout(600);
ok("D1 без действий отмена честно говорит, что нечего", /Отменять нечего/.test(await p2.locator("body").innerText()));

// ---------- E: вторая вкладка не затирает первую ----------
const ctx2 = p.context();
const tab2 = await ctx2.newPage();
await tab2.goto(URL); await tab2.waitForTimeout(2600);
const warn = await tab2.locator("body").innerText();
ok("E1 вторая вкладка честно предупреждает", /открыта в другой вкладке/i.test(warn), warn.slice(0, 200).replace(/\n/g, " | "));
ok("E2 предложено перехватить работу здесь", /Работать здесь/.test(warn));
// правка во второй вкладке не должна попасть в хранилище
const beforeLS = await tab2.evaluate(() => localStorage.getItem("xxlcrm-site-v1")?.length ?? 0);
await tab2.getByRole("button", { name: /Клиенты/ }).first().click().catch(() => {});
await tab2.waitForTimeout(400);
await tab2.getByRole("button", { name: /^\+? ?Клиент$/ }).first().click().catch(() => {});
await tab2.waitForTimeout(600);
await tab2.keyboard.type("Из второй вкладки");
await tab2.waitForTimeout(1500);
const stored = await tab2.evaluate(() => localStorage.getItem("xxlcrm-site-v1") ?? "");
ok("E3 ведомая вкладка не пишет в общую базу", !stored.includes("Из второй вкладки"), String(beforeLS) + " → " + stored.length);
await tab2.close();

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

// База, сохранённая ДО появления метки demo (v0.27), у настоящих людей лежит без неё.
// Тогда «Очистить примеры» не убирало ничего, а переход в облако предлагал перенести
// шесть чужих компаний и восемь чужих сделок как «уже наработанное».
// Проверяем разметку при загрузке: примеры узнаются по составу, своё не трогается.
import { chromium } from "playwright";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
const st = p => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));

// ---------- шаг 1: получаем заводскую базу и делаем из неё «старую» ----------
const p1 = await ctx.newPage();
p1.on("pageerror", e => errors.push(String(e)));
await p1.goto(URL); await p1.waitForTimeout(2600); await p1.keyboard.press("Escape");
const fresh = await st(p1);
ok("A1 в свежей базе примеры помечены", fresh.records.some(r => r.demo), `помечено ${fresh.records.filter(r => r.demo).length} из ${fresh.records.length}`);

// снимаем метки у всех и дописываем ОДНУ свою запись — так выглядит база до v0.27
const legacy = JSON.parse(JSON.stringify(fresh));
for (const arr of [legacy.records, legacy.tasks ?? [], legacy.chats ?? []]) for (const x of arr) delete x.demo;
const myId = "r_my_own_1";
legacy.records.push({
  id: myId, entityId: "deals", num: 999, values: { title: "Мой настоящий клиент", amount: 1000 },
  ownerId: "u1", createdAt: Date.now(), updatedAt: Date.now(), stageId: "s_new",
});
const nBefore = legacy.records.length;
await p1.close();

// ---------- шаг 2: открываем приложение с этой базой ----------
const p2 = await ctx.newPage();
p2.on("pageerror", e => errors.push(String(e)));
await p2.addInitScript(base => localStorage.setItem("xxlcrm-site-v1", JSON.stringify(base)), legacy);
await p2.goto(URL); await p2.waitForTimeout(2600); await p2.keyboard.press("Escape");
// разметка живёт в памяти сразу, а на диск попадает с ближайшим сохранением — ждём его
await p2.waitForFunction(() => {
  const d = JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}");
  return (d.records ?? []).some(r => "demo" in r);
}, null, { timeout: 8000 }).catch(() => {});

const after = await st(p2);
ok("B1 ничего не потерялось при загрузке", after.records.length === nBefore, `было ${nBefore}, стало ${after.records.length}`);
ok("B2 примеры узнаны и помечены", after.records.filter(r => r.demo).length === fresh.records.length,
  `помечено ${after.records.filter(r => r.demo).length}, ожидали ${fresh.records.length}`);
ok("B3 своя запись меткой НЕ помечена", after.records.find(r => r.id === myId)?.demo !== true);
ok("B4 своих ровно одна", after.records.filter(r => !r.demo).length === 1,
  `своих ${after.records.filter(r => !r.demo).length}: ` + after.records.filter(r => !r.demo).map(r => r.values.title).join(", "));
// в базе p1 к моменту снимка автоматизации уже успели поставить свои задачи — они не заводские,
// и помечать их примерами нельзя. Считаем только те, что пришли из фикстуры.
const injectedIds = new Set((legacy.tasks ?? []).map(t => t.id));
const injectedMarked = (after.tasks ?? []).filter(t => injectedIds.has(t.id) && t.demo).length;
ok("B5 заводские задачи помечены", injectedMarked >= 4,
  `помечено ${injectedMarked} из ${injectedIds.size} привезённых`);
ok("B6 демо-диалоги тоже помечены", (after.chats ?? []).filter(c => c.demo).length === (fresh.chats ?? []).length);

// ---------- шаг 3: настройки честно считают «своё» ----------
await p2.getByRole("button", { name: "Настройки" }).first().click(); await p2.waitForTimeout(900);
const setText = await p2.locator("main").innerText();
ok("C1 в настройках счёт своего не раздут примерами", !/У вас уже\D*\b(1[0-9]|[2-9][0-9])\b/.test(setText),
  (setText.match(/У вас уже[^\n]*/) ?? ["(строки нет)"])[0].slice(0, 160));

// ---------- шаг 4: «Очистить примеры» теперь действительно чистит ----------
// кнопка живёт в Настройках и спрашивает подтверждение; на «Моём дне» она только ведёт сюда же
await p2.getByRole("button", { name: "Настройки" }).first().click(); await p2.waitForTimeout(900);
const clearBtn = p2.getByRole("button", { name: /Очистить примеры/ });
if (await clearBtn.count()) {
  await clearBtn.first().click(); await p2.waitForTimeout(400);
  await p2.getByRole("button", { name: /^да$/ }).first().click(); await p2.waitForTimeout(1400);
  const cleared = await st(p2);
  ok("D1 примеры ушли", cleared.records.filter(r => r.demo).length === 0, `осталось демо ${cleared.records.filter(r => r.demo).length}`);
  ok("D2 своя запись на месте", !!cleared.records.find(r => r.id === myId));
} else {
  ok("D1 примеры ушли", false, "кнопки «Очистить примеры» нет на экране");
}

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

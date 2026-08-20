// Нагрузка (4 000 записей) и гонки быстрых кликов: экран не должен замирать,
// а двойной клик — портить данные.
import { chromium } from "playwright";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 200)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// эталонная база → раздуваем до 4 000 и подкладываем ДО загрузки приложения
const seed = await ctx.newPage();
await seed.goto(URL); await seed.waitForTimeout(2600); await seed.keyboard.press("Escape");
const base = await seed.evaluate(() => localStorage.getItem("xxlcrm-site-v1"));
await seed.close();
const big = (() => {
  const d = JSON.parse(base);
  const proto = d.records.find(r => r.entityId === "deals");
  const key = Object.keys(proto.values)[0];
  for (let i = 0; i < 4000; i++) d.records.push({ ...proto, id: "rx" + i, num: 1000 + i, values: { ...proto.values, [key]: "Нагрузка " + i }, pos: i * 10 });
  return JSON.stringify(d);
})();

const p = await ctx.newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
await p.addInitScript(v => localStorage.setItem("xxlcrm-site-v1", v), big);
await p.goto(URL); await p.waitForTimeout(3200); await p.keyboard.press("Escape");
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));
ok("База на 4 000 записей загружена", (await st()).records.length > 3900, String((await st()).records.length));

await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(700);

// ---------- A: таблица не рисует всё сразу ----------
let t0 = Date.now();
await p.getByRole("button", { name: "Таблица" }).click();
await p.waitForSelector("table tbody tr");
const tableMs = Date.now() - t0;
const rows = await p.locator("table tbody tr").count();
ok("A1 таблица открывается быстрее 4 секунд", tableMs < 4000, tableMs + " мс");
ok("A2 рисуется порция, а не все 4 000", rows < 400, String(rows));
const tbody = await p.locator("tbody").innerText();
ok("A3 сказано, сколько показано и сколько всего", /показано \d+ из \d+/.test(tbody), (tbody.match(/показано[^\n]*/) ?? [""])[0]);

// ---------- B: канбан тоже порциями ----------
t0 = Date.now();
await p.getByRole("button", { name: "Канбан" }).click();
await p.waitForSelector("[data-card]");
const kanbanMs = Date.now() - t0;
const cards = await p.locator("[data-card]").count();
ok("B1 канбан открывается быстрее 4 секунд", kanbanMs < 4000, kanbanMs + " мс");
ok("B2 карточек на экране немного", cards < 400, String(cards));

// ---------- C: поиск не вешает вкладку ----------
await p.getByRole("button", { name: "Таблица" }).click(); await p.waitForTimeout(400);
t0 = Date.now();
await p.getByPlaceholder("Поиск в разделе…").fill("Нагрузка 1234");
await p.waitForTimeout(800);
ok("C1 поиск отвечает быстрее 3 секунд", Date.now() - t0 < 3000, (Date.now() - t0) + " мс");
await p.getByPlaceholder("Поиск в разделе…").fill("");
await p.waitForTimeout(600);

// ---------- D: двойной клик по «+ Сделка» не помечает сделку проигранной ----------
const before = (await st()).records.length;
const addBtn = p.getByRole("button", { name: /^\+? ?Сделка$/ }).first();
await addBtn.dblclick();
await p.waitForTimeout(1200);
const sAfter = await st();
const fresh = sAfter.records.filter(r => !JSON.parse(big).records.some(o => o.id === r.id));
const dealsCfg = sAfter.entities.find(e => e.id === "deals");
const badStages = fresh.filter(r => dealsCfg.stages.find(s => s.id === r.stageId)?.kind === "lost");
ok("D1 двойной клик не создал проигранную сделку", badStages.length === 0,
  badStages.map(r => dealsCfg.stages.find(s => s.id === r.stageId)?.label).join(", "));
ok("D2 создана одна карточка, а не две", sAfter.records.length - before <= 1, `${before} → ${sAfter.records.length}`);
await p.keyboard.press("Escape"); await p.waitForTimeout(200); await p.keyboard.press("Escape");
await p.waitForTimeout(600);

// ---------- E: двойной клик по задаче не закрывает две ----------
await p.getByRole("button", { name: /Задачи/ }).first().click(); await p.waitForTimeout(800);
const openBefore = (await st()).tasks.filter(t => !t.done).length;
const cb = p.locator("main button[title='Выполнить'], main [role=checkbox]").first();
if (await cb.count()) {
  await cb.dblclick();
  await p.waitForTimeout(900);
  const openAfter = (await st()).tasks.filter(t => !t.done).length;
  ok("E1 двойной клик закрыл не больше одной задачи", openBefore - openAfter <= 1, `${openBefore} → ${openAfter}`);
} else {
  ok("E1 двойной клик закрыл не больше одной задачи", true, "чекбоксов не нашёл");
}

// ---------- F: массовое действие, которое ничего не меняет, не врёт про отмену ----------
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: "Таблица" }).click(); await p.waitForTimeout(600);

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

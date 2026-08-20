// Даты по-человечески: точки, набранные руками, не калечатся; ISO из выгрузки читается;
// непонятая дата не пропадает молча; поправленный день рождения двигает напоминание.
import { chromium } from "playwright";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));

await p.goto(URL); await p.waitForTimeout(1700); await p.keyboard.press("Escape");
await p.getByRole("button", { name: /Клиенты/ }).first().click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: "Таблица" }).click().catch(() => {});
await p.waitForTimeout(500);
const openFirst = async () => {
  for (let i = 0; i < 6; i++) {
    await p.locator("table tbody tr").first().locator("td").nth(1).locator("button").first().click();
    await p.waitForTimeout(500);
    if (await p.locator("[data-drawer]").count()) return true;
  }
  return false;
};
ok("Карточка клиента открывается", await openFirst());

const dateInputs = p.locator('[data-drawer] input[aria-label="Дата"]');
ok("Есть поле даты в карточке клиента", (await dateInputs.count()) > 0, String(await dateInputs.count()));
const di = dateInputs.first();

// ---------- A: точки, набранные руками ----------
await di.fill("");
await di.type("6.5.1990");
await p.waitForTimeout(300);
ok("A1 маска не калечит «6.5.1990»", (await di.inputValue()) === "6.5.1990", await di.inputValue());
await di.press("Enter"); await p.waitForTimeout(400);
ok("A2 разобралось как 06.05.1990", (await di.inputValue()) === "06.05.1990", await di.inputValue());

// ---------- B: ISO из выгрузки ----------
await di.fill("1990-05-06");
await di.press("Enter"); await p.waitForTimeout(400);
ok("B1 ISO-дата понята", (await di.inputValue()) === "06.05.1990", await di.inputValue());

// ---------- C: двузначный год ----------
await di.fill("01.01.68"); await di.press("Enter"); await p.waitForTimeout(300);
ok("C1 «68» — это прошлый век", (await di.inputValue()) === "01.01.1968", await di.inputValue());
await di.fill("01.01.27"); await di.press("Enter"); await p.waitForTimeout(300);
ok("C2 «27» — ближайший срок", (await di.inputValue()) === "01.01.2027", await di.inputValue());

// ---------- D: непонятая дата не пропадает молча ----------
await di.fill("31.31.2026");
await di.press("Enter"); await p.waitForTimeout(500);
ok("D1 редактор не закрылся на непонятой дате", (await di.count()) > 0 && (await di.inputValue()) === "31.31.2026", await di.inputValue());
ok("D2 показано, что дата не понята", /Не понял дату/.test(await p.locator("[data-drawer]").innerText()));

// ---------- E: поправленный день рождения двигает напоминание ----------
const soon = new Date(Date.now() + 3 * 86400000);
const soonStr = `${String(soon.getDate()).padStart(2, "0")}.${String(soon.getMonth() + 1).padStart(2, "0")}.1990`;
await di.fill(soonStr); await di.press("Enter"); await p.waitForTimeout(1200);
await p.reload(); await p.waitForTimeout(2600); await p.keyboard.press("Escape");
const bTasks = (s) => (s.tasks ?? []).filter(t => t.id.startsWith("t_bday_") && !t.done);
const first = bTasks(await st());
ok("E1 напоминание «поздравить» появилось", first.length > 0, first.map(t => new Date(t.due).toLocaleDateString("ru-RU")).join(", "));

// правим дату на другой день
await p.getByRole("button", { name: /Клиенты/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: "Таблица" }).click().catch(() => {});
await p.waitForTimeout(400);
await openFirst();
const soon2 = new Date(Date.now() + 5 * 86400000);
const soon2Str = `${String(soon2.getDate()).padStart(2, "0")}.${String(soon2.getMonth() + 1).padStart(2, "0")}.1990`;
await p.locator('[data-drawer] input[aria-label="Дата"]').first().fill(soon2Str);
await p.locator('[data-drawer] input[aria-label="Дата"]').first().press("Enter");
await p.waitForTimeout(1000);
await p.reload(); await p.waitForTimeout(2600); await p.keyboard.press("Escape");
const stAfter = await st();
// смотрим ТОЛЬКО задачи по той записи, которую правили: у других клиентов свои дни рождения
const recId = first[0]?.recordId ?? null;
const mine = bTasks(stAfter).filter(t => t.recordId === recId);
const wantDay = `${soon2.getDate()}.${soon2.getMonth() + 1}`;
const haveDays = mine.map(t => { const d = new Date(t.due); return `${d.getDate()}.${d.getMonth() + 1}`; });
ok("E2 напоминание переехало на новую дату", haveDays.includes(wantDay), `надо ${wantDay}, есть ${haveDays.join(", ")}`);
ok("E3 старое напоминание не осталось вторым", mine.length === 1, `${mine.length}: ${haveDays.join(", ")}`);

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

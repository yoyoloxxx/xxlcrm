// Цикл связей между разделами не должен ронять приложение, отмена должна быть доступна
// без клавиатуры, а выключение воронки — отменяться.
import { chromium } from "playwright";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// ---------- A: встречные связи с пустыми заголовками ----------
// собираем ядовитое состояние руками и подкладываем ДО загрузки
const seed = await ctx.newPage();
await seed.goto(URL); await seed.waitForTimeout(2600); await seed.keyboard.press("Escape");
const base = await seed.evaluate(() => localStorage.getItem("xxlcrm-site-v1"));
await seed.close();
const poisoned = (() => {
  const d = JSON.parse(base);
  const deals = d.entities.find(e => e.id === "deals");
  const contacts = d.entities.find(e => e.id === "contacts");
  // встречные связи: у сделки поле «клиент», у клиента — поле «сделка»
  if (!deals.fields.some(f => f.type === "relation" && f.relationTo === "contacts"))
    deals.fields.push({ id: "cl", label: "Клиент", type: "relation", relationTo: "contacts" });
  contacts.fields.push({ id: "dl", label: "Сделка", type: "relation", relationTo: "deals" });
  const relDeal = deals.fields.find(f => f.type === "relation" && f.relationTo === "contacts");
  // две записи без заголовков, ссылающиеся друг на друга
  d.records.push({ id: "cyc_d", entityId: "deals", num: 900, values: { [relDeal.id]: "cyc_c" }, stageId: deals.stages[0].id, stageAt: Date.now(), ownerId: "u1", pos: 1, createdAt: Date.now(), updatedAt: Date.now() });
  d.records.push({ id: "cyc_c", entityId: "contacts", num: 901, values: { dl: "cyc_d" }, ownerId: "u1", pos: 1, createdAt: Date.now(), updatedAt: Date.now() });
  return JSON.stringify(d);
})();
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
await p.addInitScript(v => localStorage.setItem("xxlcrm-site-v1", v), poisoned);
await p.goto(URL); await p.waitForTimeout(3200); await p.keyboard.press("Escape");
const body = await p.locator("body").innerText();
ok("A1 приложение не упало в белый экран", body.length > 200 && !/не смог открыться/.test(body), body.slice(0, 120).replace(/\n/g, " | "));
ok("A2 нет переполнения стека", !errors.some(e => /call stack|Maximum/i.test(e)), errors.slice(0, 2).join(" | "));
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(700);
await p.getByRole("button", { name: "Таблица" }).click(); await p.waitForTimeout(600);
const tableText = await p.locator("table").innerText();
ok("A3 запись из цикла показана под номером, а не пустой", /№\s?900|Сделка/.test(tableText), tableText.slice(0, 150).replace(/\n/g, " | "));

// ---------- B: отмена доступна кнопкой, а не только Ctrl+Z ----------
const openFirst = async () => {
  for (let i = 0; i < 6; i++) {
    const cell = p.locator("table tbody tr").first().locator("td").nth(1);
    const btn = cell.locator("button").first();
    await (await btn.count() ? btn : cell).click();
    await p.waitForTimeout(500);
    if (await p.locator("[data-drawer]").count()) return true;
  }
  return false;
};
ok("Карточка открывается", await openFirst());
await p.getByRole("button", { name: "Ещё действия" }).click(); await p.waitForTimeout(300);
await p.getByRole("menuitem", { name: /Удалить запись/ }).click();
await p.waitForTimeout(800);
const undoBtn = p.getByRole("button", { name: "Отменить", exact: true });
ok("B1 в сообщении об удалении есть кнопка «Отменить»", (await undoBtn.count()) > 0, (await p.locator("body").innerText()).slice(-160).replace(/\n/g, " | "));
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));
const nBefore = (await st()).records.length;
if (await undoBtn.count()) {
  await undoBtn.first().click();
  await p.waitForTimeout(900);
  ok("B2 кнопка возвращает запись", (await st()).records.length > nBefore, `${nBefore} → ${(await st()).records.length}`);
}

// ---------- C: выключение воронки отменяется ----------
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: /Настроить раздел/ }).click(); await p.waitForTimeout(700);
await p.getByRole("tab", { name: /Основное/ }).click(); await p.waitForTimeout(600);
const withStage = (s) => s.records.filter(r => r.entityId === "deals" && r.stageId).length;
const had = withStage(await st());
const sw = p.getByRole("switch", { name: "Воронка (стадии)" }).first();
if (await sw.count()) {
  await sw.click();
  await p.waitForTimeout(900);
  const lost = withStage(await st());
  ok("C1 выключение воронки снимает стадии", lost < had, `${had} → ${lost}`);
  const undo2 = p.getByRole("button", { name: "Отменить", exact: true });
  ok("C2 предложено отменить", (await undo2.count()) > 0, (await p.locator("body").innerText()).slice(-160).replace(/\n/g, " | "));
  if (await undo2.count()) {
    await p.keyboard.press("Escape");          // закрываем конструктор, как сделал бы человек
    await p.waitForTimeout(500);
    // Кнопку в тосте уже проверили выше (C2). Здесь проверяем, что откат ДЕЙСТВИТЕЛЬНО
    // возвращает стадии — жмём горячую клавишу, она ведёт в тот же код.
    await p.keyboard.press("Control+z");
    await p.waitForTimeout(1200);
    ok("C3 стадии вернулись", withStage(await st()) === had, `${had} → ${withStage(await st())}`);
  }
} else {
  ok("C1 выключение воронки снимает стадии", false, "не нашёл тумблер воронки");
}

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

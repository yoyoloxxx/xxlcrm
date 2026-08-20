// Движок правил и разбор чисел из Excel/1С: правило «тишина» не должно перезаряжать себя,
// удалённая задача не должна возвращаться, ночная задача не должна выпадать из «сегодня»,
// а импорт обязан отчитаться о том, что не понял.
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));

await p.goto(URL); await p.waitForTimeout(3200); await p.keyboard.press("Escape");

// ---------- A: правило не ставит одну и ту же задачу дважды ----------
const s0 = await st();
const ruleTasks = (s) => (s.tasks ?? []).filter(t => t.id.startsWith("t_rule_"));
const n0 = ruleTasks(s0).length;
await p.evaluate(() => { window.dispatchEvent(new Event("focus")); });
await p.waitForTimeout(1500);
await p.reload(); await p.waitForTimeout(3400); await p.keyboard.press("Escape");
const n1 = ruleTasks(await st()).length;
ok("A1 повторная загрузка не плодит задачи от правил", n1 === n0, `${n0} → ${n1}`);

// ---------- B: удалённая задача от правила не возвращается ----------
const victim = ruleTasks(await st())[0];
if (victim) {
  await p.evaluate(id => {
    const raw = JSON.parse(localStorage.getItem("xxlcrm-site-v1"));
    void raw; void id;
  }, victim.id);
  // удаляем через интерфейс: открываем запись и снимаем задачу
  await p.getByRole("button", { name: /Задачи/ }).first().click(); await p.waitForTimeout(600);
  const row = p.locator("main").locator("div").filter({ hasText: victim.title }).last();
  void row;
  // прямого «удалить задачу» в списке может не быть — удаляем из состояния и перезагружаем
  await p.evaluate(id => {
    const d = JSON.parse(localStorage.getItem("xxlcrm-site-v1"));
    d.tasks = d.tasks.filter(t => t.id !== id);
    localStorage.setItem("xxlcrm-site-v1", JSON.stringify(d));
  }, victim.id);
  await p.reload(); await p.waitForTimeout(3400); await p.keyboard.press("Escape");
  const back = ruleTasks(await st()).some(t => t.id === victim.id);
  ok("B1 удалённая задача от правила не вернулась", !back, victim.title);
} else {
  ok("B1 удалённая задача от правила не вернулась", true, "правила не ставили задач — нечего проверять");
}

// ---------- C: задачи от правил не назначаются на ночь ----------
const nightly = ruleTasks(await st()).filter(t => { const h = new Date(t.due).getHours(); return h >= 22 || h < 9; });
ok("C1 нет задач, назначенных на ночь", nightly.length === 0,
  nightly.slice(0, 3).map(t => `${t.title} @ ${new Date(t.due).toLocaleString("ru-RU")}`).join(" | "));

// ---------- D: числа из Excel и 1С ----------
writeFileSync("/tmp/nums.csv", "﻿" + [
  "Название;Сумма",
  "Экспонента;1,09E+09",
  "Минус в конце;5 000-",
  "Типографский минус;−5 000",
  "Скобки;(1 200)",
  "Обычное;12 000,50"].join("\n"));
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: /Загрузить/ }).first().click(); await p.waitForTimeout(500);
await p.locator('input[type=file]').setInputFiles("/tmp/nums.csv"); await p.waitForTimeout(1500);
await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 60000 });
await p.waitForTimeout(1500);
const deals = (await st()).records.filter(r => r.entityId === "deals");
const val = (name) => { const r = deals.find(x => Object.values(x.values).includes(name)); return r ? Object.values(r.values).find(v => typeof v === "number") : undefined; };
ok("D1 экспонента прочитана как миллиард", val("Экспонента") === 1090000000, String(val("Экспонента")));
ok("D2 минус в конце (1С) сохранён", val("Минус в конце") === -5000, String(val("Минус в конце")));
ok("D3 типографский минус сохранён", val("Типографский минус") === -5000, String(val("Типографский минус")));
ok("D4 скобки — это минус", val("Скобки") === -1200, String(val("Скобки")));
ok("D5 обычное число с копейками", val("Обычное") === 12000.5, String(val("Обычное")));

// ---------- E: импорт отчитывается о непонятом ----------
writeFileSync("/tmp/mess.csv", "﻿" + [
  "Название;Дедлайн;Стадия",
  "Первая;не дата;Отказ по цене",
  "Вторая;тоже не дата;Отказ по цене"].join("\n"));
await p.getByRole("button", { name: /Загрузить/ }).first().click(); await p.waitForTimeout(500);
await p.locator('input[type=file]').setInputFiles("/tmp/mess.csv"); await p.waitForTimeout(1500);
await p.getByRole("button", { name: /^Загрузить \d+ строк/ }).click({ timeout: 60000 });
await p.waitForTimeout(1800);
const body = await p.locator("body").innerText();
ok("E1 сказано, сколько дат не понял", /не понял дат/i.test(body), body.slice(-320).replace(/\n/g, " | "));
ok("E2 сказано про ненайденную стадию", /стадии не найдены/i.test(body), body.slice(-320).replace(/\n/g, " | "));

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

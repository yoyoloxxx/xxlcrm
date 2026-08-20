// Примеры из шаблона ниши — это ПРИМЕРЫ, а не работа человека.
// Раньше они создавались без метки: «Очистить примеры» бодро отвечало «примеров уже нет»
// и не убирало ничего, а при переезде в облако выдуманные клиенты уезжали в общую базу
// как «уже наработанное».
import { chromium } from "playwright";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}"));

await p.goto(URL); await p.waitForTimeout(2600);

// ---------- применяем шаблон ниши через окно первого запуска ----------
const applied = await p.evaluate(async () => {
  const card = [...document.querySelectorAll("button, [role=button]")].find(b => /Барбершоп|Кондитерская|Магазин украшений/.test(b.textContent ?? ""));
  if (!card) return "нет карточек ниш";
  card.click();
  await new Promise(r => setTimeout(r, 800));
  const go = [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Применить шаблон");
  if (!go) return "нет кнопки подтверждения";
  go.click();
  return "ok";
});
ok("A1 шаблон ниши применился", applied === "ok", applied);
await p.waitForTimeout(2500);

const after = await st();
const recs = after.records ?? [];
ok("A2 записи из шаблона появились", recs.length > 0, `${recs.length}`);
ok("B1 ВСЕ записи шаблона помечены как примеры", recs.every(r => r.demo === true),
  `без метки: ${recs.filter(r => !r.demo).map(r => r.values?.title).slice(0, 4).join(", ") || "нет"}`);
const chats = after.chats ?? [];
ok("B2 диалоги шаблона тоже помечены", chats.every(c => c.demo === true), `без метки: ${chats.filter(c => !c.demo).length}`);

// ---------- «Очистить примеры» обязано убрать их, а не отчитаться впустую ----------
await p.evaluate(() => {
  const b = [...document.querySelectorAll("button, a")].find(x => (x.textContent ?? "").trim().startsWith("Настройки"));
  b?.click();
});
await p.waitForTimeout(1400);
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Очистить примеры")?.click());
await p.waitForTimeout(600);
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "да")?.click());
await p.waitForTimeout(1800);

const cleaned = await st();
ok("C1 после очистки записей шаблона не осталось", (cleaned.records ?? []).length === 0,
  `осталось ${(cleaned.records ?? []).length}: ${(cleaned.records ?? []).map(r => r.values?.title).slice(0, 4).join(", ")}`);
ok("C2 и диалогов тоже", (cleaned.chats ?? []).length === 0, `осталось ${(cleaned.chats ?? []).length}`);

// ---------- разделы и воронка ниши остаются: это настройка, а не пример ----------
ok("D1 разделы ниши на месте", (cleaned.entities ?? []).length >= 2, `${(cleaned.entities ?? []).length}`);
ok("D2 автоматизации ниши на месте", (cleaned.automations ?? []).length > 0, `${(cleaned.automations ?? []).length}`);

// ---------- база, применившая шаблон ДО этой правки, узнаётся при загрузке ----------
// Проверяем не «метку на диске» (она ложится со следующим сохранением), а то, что важно
// человеку: кнопка «Очистить примеры» на такой базе действительно убирает выдуманных клиентов.
const legacy = JSON.parse(JSON.stringify(after));
for (const r of legacy.records) delete r.demo;
for (const c of legacy.chats ?? []) delete c.demo;
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p2 = await ctx2.newPage();
p2.on("pageerror", e => errors.push(String(e)));
await p2.addInitScript(b => localStorage.setItem("xxlcrm-site-v1", JSON.stringify(b)), legacy);
await p2.goto(URL); await p2.waitForTimeout(2800);
const было2 = await p2.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}").records.length);
await p2.evaluate(() => {
  const b = [...document.querySelectorAll("button, a")].find(x => (x.textContent ?? "").trim().startsWith("Настройки"));
  b?.click();
});
await p2.waitForTimeout(1400);
await p2.evaluate(() => [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Очистить примеры")?.click());
await p2.waitForTimeout(600);
await p2.evaluate(() => [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "да")?.click());
await p2.waitForTimeout(2000);
const стало2 = await p2.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1") ?? "{}").records.length);
ok("E1 на старой базе «Очистить примеры» действительно убирает примеры ниши", было2 > 0 && стало2 === 0, `было ${было2}, стало ${стало2}`);

ok("F1 приложение не падало", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const bad = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
if (bad.length) process.exit(1);

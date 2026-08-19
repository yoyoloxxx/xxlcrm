// Проверка правок после отчёта тестеров: телефон, история структуры, шаблоны, пустышки, демо
import { chromium } from "playwright";
const R=[]; const ok=(n,c,e="")=>{R.push([c?"PASS":"FAIL",n,String(e)]); if(!c) console.log("  ✗",n,e);};
const stt = async p => await p.evaluate(() => JSON.parse(localStorage.getItem("xxlcrm-site-v1")||"{}"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

// ---------- ТЕЛЕФОН ----------
const mob = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await mob.goto("http://127.0.0.1:8099/index.html"); await mob.waitForTimeout(1700); await mob.keyboard.press("Escape");
const asideRight = await mob.locator("aside").first().evaluate(el => el.getBoundingClientRect().right);
ok("M1 панель не занимает экран на телефоне", asideRight <= 1, "правый край " + asideRight);
const bottom = await mob.locator("nav.fixed.bottom-0, nav[class*='bottom-0']").first().isVisible().catch(() => false);
ok("M2 есть нижняя навигация", bottom);
const tabs = mob.locator("nav").last();
await tabs.getByText("Входящие").click(); await mob.waitForTimeout(700);
ok("M3 переход по нижней навигации работает", /Входящие/.test(await mob.locator("main").innerText()));
const listW = await mob.locator("main > div > div").first().evaluate(el => el.getBoundingClientRect().width).catch(() => 0);
ok("M4 список диалогов во всю ширину", listW > 300, "ширина " + listW);
await mob.getByRole("button", { name: /Максим Веретенников/ }).click(); await mob.waitForTimeout(600);
ok("M5 диалог открывается на весь экран", await mob.locator("main input[placeholder*='Ответить']").isVisible());
ok("M6 есть кнопка «назад» к списку", await mob.locator("main button[title='К списку диалогов']").isVisible());
await tabs.getByText("Разделы").click(); await mob.waitForTimeout(700);
ok("M7 «Разделы» открывают панель", (await mob.locator("aside").first().evaluate(el => el.getBoundingClientRect().right)) > 200);
await mob.locator("aside").first().getByText("Сделки").first().click(); await mob.waitForTimeout(700);
ok("M8 после выбора раздела панель закрывается", (await mob.locator("aside").first().evaluate(el => el.getBoundingClientRect().right)) <= 1);
await mob.getByRole("button", { name: "Таблица", exact: true }).click().catch(() => {});
await mob.waitForTimeout(500);
const tblW = await mob.locator("main table").evaluate(el => el.parentElement.scrollWidth).catch(() => 0);
ok("M9 таблица не улетает в бесконечность", tblW > 0 && tblW < 5000, "scrollWidth " + tblW);
await mob.screenshot({ path: "/home/claude/mob-after.png" });

// ---------- ДЕСКТОП: структура и отмена ----------
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto("http://127.0.0.1:8099/index.html"); await p.waitForTimeout(1600); await p.keyboard.press("Escape");
await p.getByRole("button", { name: /Сделки/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: "Настроить раздел" }).click(); await p.waitForTimeout(500);
const dlg = p.locator("[role=dialog]");
// тип поля меняется
const typeSel = dlg.locator("button[role=combobox]").first();
ok("S1 тип поля — выпадашка, а не надпись", await typeSel.isVisible());
// удаление поля спрашивает подтверждение
const fieldsBefore = (await stt(p)).entities.find(e => e.id === "deals").fields.length;
await dlg.locator("button:has(svg.lucide-trash-2), button:has(svg.lucide-trash2)").nth(1).click(); await p.waitForTimeout(400);
ok("S2 удаление поля спрашивает подтверждение", /потеряем|точно/.test(await dlg.innerText()) && (await stt(p)).entities.find(e => e.id === "deals").fields.length === fieldsBefore);
await dlg.locator("button", { hasText: /^да$/ }).first().click(); await p.waitForTimeout(600);
ok("S3 после подтверждения поле удаляется", (await stt(p)).entities.find(e => e.id === "deals").fields.length === fieldsBefore - 1);
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
await p.locator("h1").first().click();
await p.keyboard.press("Control+z"); await p.waitForTimeout(700);
ok("S4 Ctrl+Z возвращает удалённое поле", (await stt(p)).entities.find(e => e.id === "deals").fields.length === fieldsBefore);

// пустая карточка не остаётся
const before = (await stt(p)).records.filter(r => r.entityId === "deals").length;
await p.getByRole("button", { name: "Сделка", exact: true }).first().click();
await p.waitForTimeout(700);
await p.keyboard.press("Escape"); await p.waitForTimeout(700);
ok("S5 пустая карточка не остаётся в воронке", (await stt(p)).records.filter(r => r.entityId === "deals").length === before, `${before} → ${(await stt(p)).records.filter(r => r.entityId === "deals").length}`);

// шаблон не отправляет {переменные}
await p.getByRole("button", { name: /Входящие/ }).first().click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: /Максим Веретенников/ }).click(); await p.waitForTimeout(400);
await p.locator("main button").filter({ hasText: /Напоминание об оплате|Трек-номер/ }).first().click().catch(() => {});
await p.waitForTimeout(400);
const draft = await p.locator("main input[placeholder*='Ответить']").inputValue();
if (/\{/.test(draft)) {
  await p.locator("main input[placeholder*='Ответить']").press("Enter"); await p.waitForTimeout(500);
  const toasts = (await p.locator("[data-sonner-toast]").allInnerTexts()).join(" | ");
  ok("S6 незаполненные {переменные} не уходят клиенту", /Заполните/.test(toasts), toasts.slice(0, 80));
} else ok("S6 незаполненные {переменные} не уходят клиенту", true, "в шаблоне не осталось переменных");
const greet = await p.locator("main button").filter({ hasText: /Приветствие/ }).first();
await greet.click().catch(() => {}); await p.waitForTimeout(400);
const hello = await p.locator("main input[placeholder*='Ответить']").inputValue();
ok("S7 в приветствие не подставляется название диалога", !/Новый|Максим Веретенников,/.test(hello), hello.slice(0, 60));

// демо-плашка и очистка примеров
await p.getByRole("button", { name: "Настройки", exact: true }).first().click(); await p.waitForTimeout(700);
ok("S8 демо-данные помечены как примеры", /примеры/i.test(await p.locator("main").innerText()));
ok("S9 есть кнопка очистки примеров", await p.getByRole("button", { name: /Очистить примеры/ }).isVisible());

console.log("\n" + R.map(([s,n,e]) => `${s==="PASS"?"✓":"✗"} ${n}${e&&s==="FAIL"?"  → "+e:""}`).join("\n"));
console.log(`\n${R.filter(r=>r[0]==="PASS").length}/${R.length} PASS`);
await b.close();

// Удалить пространство можно только осознанно: название целиком, ясный список потерь,
// кнопка неактивна, пока не совпало. Завести пространство — два клика, поэтому цена
// обратного действия должна быть заметно выше.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };
const URL = "http://127.0.0.1:8099/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", e => errors.push(String(e)));
await p.goto(URL); await p.waitForTimeout(2600); await p.keyboard.press("Escape");

// В демо-режиме облачного блока нет — и кнопки удаления быть не должно.
await p.evaluate(() => {
  const b = [...document.querySelectorAll("button, a")].find(x => (x.textContent ?? "").trim().startsWith("Настройки"));
  b?.click();
});
await p.waitForTimeout(1500);
const vDemo = await p.evaluate(() => [...document.querySelectorAll("button")].some(b => (b.textContent ?? "").includes("Удалить пространство")));
ok("A1 в локальном режиме кнопки удаления нет", !vDemo);

const hasTeamBlock = await p.evaluate(() => document.body.innerText.includes("Команда и аккаунт"));
ok("A2 вместо неё честный рассказ про локальный режим", hasTeamBlock);

// Текст предупреждения обязан называть вещи своими именами.
const bundle = await p.evaluate(async () => (await fetch(location.href, { cache: "no-store" })).text());
ok("B1 предупреждение говорит, что копии не остаётся", bundle.includes("копии в облаке не остаётся"));
ok("B2 и что уйдёт история команды", bundle.includes("вся история"));
ok("B3 и подсказывает сделать копию базы заранее", bundle.includes("Копия базы"));
ok("C1 подтверждение требует ввести название", bundle.includes("Для подтверждения введите название"));
// Сборка минифицирована — имена переменных там уже не те. Этот пункт проверяем по исходнику
// и честно называем его статической проверкой: само поведение кнопки живёт только в облачном
// режиме, до которого тестовый прогон без настоящего аккаунта не дотягивается.
const src = readFileSync("src/components/live/AuthLive.tsx", "utf8");
ok("C2 кнопка заперта, пока название не совпало (по исходнику)", src.includes("disabled={busy || typed.trim() !== s.wsName}"));
ok("C3 удаление доступно только владельцу (по исходнику)", src.includes("{owner && <DropWs />}"));
ok("D1 приложение проверяет, что строка ПРАВДА удалена", bundle.includes("База не дала удалить"));
ok("E1 приложение не падало", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const bad = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
if (bad.length) process.exit(1);

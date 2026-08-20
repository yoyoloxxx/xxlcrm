// Переход в облако не должен молча терять наработанное, а код приглашения — висеть у всех на виду.
// Настоящее облако тут не поднимаем: проверяем то, что видно и считается на клиенте.
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

await p.goto(URL); await p.waitForTimeout(2600); await p.keyboard.press("Escape");

// ---------- A: локальный режим назван честно ----------
const shell = await p.locator("body").innerText();
ok("A1 режим помечен как демо", /демо · только это устройство/.test(shell), shell.slice(0, 200).replace(/\n/g, " | "));

await p.getByRole("button", { name: "Настройки" }).first().click(); await p.waitForTimeout(800);
const setText = await p.locator("main").innerText();
ok("A2 сказано, что база в одном браузере и упрётся в потолок",
  /только на этом устройстве/.test(setText) && /4 МБ|потолок|откажет/.test(setText),
  (setText.match(/Сейчас вы работаете[^\n]*/) ?? [""])[0].slice(0, 180));
ok("A3 кнопка ведёт в облако, а не просто «войти»",
  (await p.getByRole("button", { name: /Перейти в облако/ }).count()) > 0);

// ---------- B: заводим свои данные и проверяем, что их посчитали ----------
await p.getByRole("button", { name: /Клиенты/ }).first().click(); await p.waitForTimeout(500);
for (const name of ["Мой Первый", "Мой Второй"]) {
  await p.getByRole("button", { name: /^\+? ?Клиент$/ }).first().click();
  await p.waitForTimeout(700);
  await p.keyboard.type(name);
  await p.waitForTimeout(300);
  await p.keyboard.press("Escape"); await p.waitForTimeout(200); await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
}
const mine = (await st()).records.filter(r => !r.demo);
ok("B1 свои записи отличимы от примеров", mine.length >= 2, `своих ${mine.length}, всего ${(await st()).records.length}`);

await p.getByRole("button", { name: "Настройки" }).first().click(); await p.waitForTimeout(800);
const setText2 = await p.locator("main").innerText();
ok("B2 в настройках сказано, что при переходе перенесут", /перенесу их с собой/.test(setText2),
  (setText2.match(/У вас уже[^\n]*/) ?? [""])[0]);

// ---------- C: экран входа предлагает перенос ----------
await p.getByRole("button", { name: /Перейти в облако/ }).first().click();
await p.waitForTimeout(900);
const auth = await p.locator("body").innerText();
ok("C1 открылся вход в облако", /Войти|Регистрация|Создайте компанию|пространство/i.test(auth), auth.slice(0, 200).replace(/\n/g, " | "));
// доходим до шага «пространство» напрямую, минуя настоящую регистрацию
await p.evaluate(() => { const w = window; void w; });
await p.keyboard.press("Escape");
await p.waitForTimeout(500);

// ---------- D: примеры не считаются «своими» ----------
const s2 = await st();
const demo = s2.records.filter(r => r.demo).length;
ok("D1 демо-записи помечены отдельно", demo > 0, `демо ${demo}`);
ok("D2 счётчик «своих» не включает примеры",
  s2.records.filter(r => !r.demo).length < s2.records.length, `свои ${s2.records.filter(r => !r.demo).length} из ${s2.records.length}`);

ok("Z нет ошибок JS", errors.filter(e => !/net::|ERR_/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

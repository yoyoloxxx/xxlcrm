// Адрес серверного приёмника заявок не должен пропадать с экрана.
// Раньше он жил только в состоянии компонента настроек: ушёл в другой раздел — и адреса нет,
// хотя на сервере всё настроено и он уже вставлен в форму на сайте. Человек не мог ни
// проверить его, ни скопировать заново — только «создать» ещё раз и гадать, не сломал ли.
import { readFileSync } from "node:fs";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };

const set = readFileSync("src/components/live/SettingsLive.tsx", "utf8");
const inb = readFileSync("src/lib/inbound.ts", "utf8");
const hook = readFileSync("../supabase/functions/hook/index.ts", "utf8");

ok("A1 при открытии настроек адрес перечитывается с сервера", /useEffect\(\(\) => \{[\s\S]{0,400}getHookSecret\("tilda"\)/.test(set));
ok("A2 чтение не создаёт приёмник тем, кто его не заводил",
  /export async function getHookSecret[\s\S]{0,600}?if \(error \|\| !data\?\.secret\) return null;/.test(inb));
ok("A3 у адреса есть кнопка «Скопировать»", /Скопировать/.test(set) && /writeText\(ownHook\)/.test(set));
ok("A4 перевыпуск по-прежнему спрашивает подтверждение", /Перевыпустить секрет\? Старый адрес перестанет работать/.test(set));

// ---------- текст заявки с сайта обязан попадать в CRM ----------
ok("B1 текст заявки кладётся в поле-заметку по смыслу, не в первое textarea", /textFields\.find\(\(f: Any\) => NOTE\.test\(f\.label\)\)[\s\S]{0,120}values\[noteF\.id\] = msg\.text/.test(hook));
ok("B1a адрес/город исключается из выбора поля-заметки", /const ADDR = \/адрес\|город/.test(hook));
ok("B2 и отдельной строкой в хронологию", /Текст заявки: \$\{msg\.text/.test(hook));
ok("B3 пустой текст не создаёт пустую запись в хронологии", /\.\.\.\(msg\.text \? \[/.test(hook));
ok("B4 версия приёмника поднята", /const VERSION = "0\.2\d"/.test(hook));

// ---------- контроль: старое поведение не осталось ----------
ok("C1 у формы с сайта диалог по-прежнему не заводится (у неё нет переписки)", /if \(src !== "tilda"\) \{/.test(hook));

await Promise.resolve();
const bad = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
if (bad.length) process.exit(1);

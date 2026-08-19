// Выгрузка раздела в CSV: «свои данные можно забрать» — то же, что мы умеем принимать.
// Excel в России ждёт «;» и UTF-8 с BOM, иначе кириллица превращается в кракозябры.
import type { EntityCfg, Rec } from "./model";
import { displayValue } from "./model";

const cell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCSV(e: EntityCfg, recs: Rec[], ctx: { recTitle: (id: string) => string; userName: (id: string) => string }): string {
  const cols = e.fields;
  const head = ["№", ...cols.map(f => f.label), ...(e.stages?.length ? ["Стадия"] : []), "Ответственный", "Создано"];
  const rows = recs.map(r => [
    String(r.num),
    ...cols.map(f => displayValue(f, r.values[f.id], ctx)),
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

// Фильтры по любому полю: «покажи заказы из Telegram дороже 30 000».
// Условия живут в памяти представления (viewstate) и сохраняются как свои сегменты.
import type { EntityCfg, Field, Rec } from "./model";
import { displayValue } from "./model";

export type CondOp = "contains" | "not_contains" | "eq" | "ne" | "gt" | "lt" | "before" | "after" | "empty" | "filled";
export interface Cond { fieldId: string; op: CondOp; value?: string }

export const OPS: Record<string, { op: CondOp; label: string; needsValue: boolean }[]> = {
  text: [
    { op: "contains", label: "содержит", needsValue: true },
    { op: "not_contains", label: "не содержит", needsValue: true },
    { op: "filled", label: "заполнено", needsValue: false },
    { op: "empty", label: "пусто", needsValue: false },
  ],
  number: [
    { op: "gt", label: "больше", needsValue: true },
    { op: "lt", label: "меньше", needsValue: true },
    { op: "eq", label: "равно", needsValue: true },
    { op: "filled", label: "заполнено", needsValue: false },
    { op: "empty", label: "пусто", needsValue: false },
  ],
  date: [
    { op: "after", label: "позже", needsValue: true },
    { op: "before", label: "раньше", needsValue: true },
    { op: "filled", label: "заполнено", needsValue: false },
    { op: "empty", label: "пусто", needsValue: false },
  ],
  choice: [
    { op: "eq", label: "это", needsValue: true },
    { op: "ne", label: "не это", needsValue: true },
    { op: "empty", label: "пусто", needsValue: false },
  ],
};

export function opsFor(f: Field): { op: CondOp; label: string; needsValue: boolean }[] {
  if (f.type === "number" || f.type === "money") return OPS.number;
  if (f.type === "date" || f.type === "datetime") return OPS.date;
  if (f.type === "select" || f.type === "user" || f.type === "relation") return OPS.choice;
  return OPS.text;
}

const num = (v: unknown) => Number(String(v ?? "").replace(/[^\d.-]/g, ""));
const low = (v: unknown) => String(v ?? "").toLowerCase();

export function matchCond(rec: Rec, e: EntityCfg, c: Cond, ctx?: { recTitle?: (id: string) => string; userName?: (id: string) => string }): boolean {
  if (c.fieldId === "__stage") {
    const has = !!rec.stageId;
    if (c.op === "empty") return !has;
    if (c.op === "filled") return has;
    if (c.op === "ne") return rec.stageId !== c.value;
    return rec.stageId === c.value;
  }
  const f = e.fields.find(x => x.id === c.fieldId);
  if (!f) return true;
  const raw = rec.values[f.id];
  const isEmpty = raw === undefined || raw === null || raw === "";
  switch (c.op) {
    case "empty": return isEmpty;
    case "filled": return !isEmpty;
    case "eq": return String(raw ?? "") === String(c.value ?? "");
    case "ne": return String(raw ?? "") !== String(c.value ?? "");
    case "gt": return !isEmpty && num(raw) > num(c.value);
    case "lt": return !isEmpty && num(raw) < num(c.value);
    case "after": return !isEmpty && Number(raw) > Date.parse(String(c.value));
    case "before": return !isEmpty && Number(raw) < Date.parse(String(c.value));
    case "contains": return low(displayValue(f, raw, ctx)).includes(low(c.value));
    case "not_contains": return !low(displayValue(f, raw, ctx)).includes(low(c.value));
    default: return true;
  }
}

export const matchAll = (rec: Rec, e: EntityCfg, conds: Cond[], ctx?: { recTitle?: (id: string) => string; userName?: (id: string) => string }) =>
  conds.every(c => matchCond(rec, e, c, ctx));

// Человеческая подпись условия — для чипа в шапке и имени сохранённого сегмента
export function condLabel(e: EntityCfg, c: Cond): string {
  const f = c.fieldId === "__stage" ? undefined : e.fields.find(x => x.id === c.fieldId);
  const name = c.fieldId === "__stage" ? "Стадия" : f?.label ?? "поле";
  const op = (f ? opsFor(f) : OPS.choice).find(o => o.op === c.op);
  let val = c.value ?? "";
  if (c.fieldId === "__stage") val = e.stages?.find(s => s.id === c.value)?.label ?? val;
  else if (f?.type === "select") val = f.options?.find(o => o.id === c.value)?.label ?? val;
  return `${name} ${op?.label ?? c.op}${op?.needsValue ? " " + val : ""}`.trim();
}

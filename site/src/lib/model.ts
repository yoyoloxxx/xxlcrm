// XXLcrm site — модель данных живой части (порт из прототипа, обрезан до шага 1)
export type FieldType = "text" | "textarea" | "number" | "money" | "phone" | "email" | "url" | "date" | "datetime" | "select" | "relation" | "user";

export interface Option { id: string; label: string; color: string }
export interface Field { id: string; label: string; type: FieldType; options?: Option[]; relationTo?: string; required?: boolean; inTable?: boolean }
export type StageKind = "open" | "won" | "lost";
export interface Stage { id: string; label: string; color: string; kind: StageKind }
export interface EntityCfg {
  id: string; name: string; namePlural: string; icon: string;
  fields: Field[]; titleFieldId: string; stages?: Stage[];
}
export interface Rec {
  id: string; entityId: string; num: number;
  values: Record<string, unknown>;
  stageId?: string; stageAt?: number; ownerId: string;
  createdAt: number; updatedAt: number;
}
export type TaskKind = "call" | "meet" | "todo" | "msg";
export interface Task { id: string; title: string; kind: TaskKind; recordId?: string; ownerId: string; due: number; done: boolean; doneAt?: number }
export type ActKind = "created" | "stage" | "field" | "comment" | "task";
export interface Activity { id: string; recordId: string; ts: number; kind: ActKind; text: string; userId?: string }
export interface User { id: string; name: string; role: string; hue: number }

let idc = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}${(++idc).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
export const DAY = 86400000;
export const now = () => Date.now();
export const days = (n: number) => now() + n * DAY;

export const fmtMoney = (v: unknown) => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? "" : new Intl.NumberFormat("ru-RU").format(Number(v)) + " ₽";
export const fmtDate = (ts?: number | string) => { if (!ts) return ""; return new Date(Number(ts)).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); };
export const fmtDateTime = (ts?: number | string) => { if (!ts) return ""; const d = new Date(Number(ts)); return fmtDate(ts) + ", " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); };
export const relTime = (ts: number) => {
  const diff = now() - ts;
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + " мин назад";
  if (new Date(ts).toDateString() === new Date().toDateString()) return "сегодня в " + new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diff < 2 * DAY) return "вчера";
  return fmtDate(ts);
};
export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

export function displayValue(f: Field, v: unknown, ctx?: { recTitle?: (id: string) => string; userName?: (id: string) => string }): string {
  if (v === undefined || v === null || v === "") return "";
  switch (f.type) {
    case "money": return fmtMoney(v);
    case "date": return fmtDate(v as number);
    case "datetime": return fmtDateTime(v as number);
    case "select": return f.options?.find(o => o.id === v)?.label ?? "";
    case "relation": return ctx?.recTitle?.(v as string) ?? "";
    case "user": return ctx?.userName?.(v as string) ?? "";
    default: return String(v);
  }
}

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
  pos?: number; // ручной порядок внутри колонки (дробная позиция — совместимо с numeric в Postgres)
  createdAt: number; updatedAt: number;
}
export type TaskKind = "call" | "meet" | "todo" | "msg";
export interface Task { id: string; title: string; kind: TaskKind; recordId?: string; ownerId: string; due: number; done: boolean; doneAt?: number }
export type ActKind = "created" | "stage" | "field" | "comment" | "task";
export interface Activity { id: string; recordId: string; ts: number; kind: ActKind; text: string; userId?: string; editKey?: string }
export interface User { id: string; name: string; role: string; hue: number }

export type Channel = "tg" | "wa" | "max" | "ig";
export interface ChatMsg { id: string; ts: number; out: boolean; text: string }
export interface Chat {
  id: string; name: string; phone?: string; channel: Channel; recordId?: string; unread: number; msgs: ChatMsg[];
  ext?: ChatExt; // реальные внешние id; демо-чаты без ext
}
// tgu — ЛИЧНЫЙ Telegram-аккаунт (MTProto), tg — Telegram-бот
export interface ChatExt { tg?: number; wa?: string; max?: number; tgu?: string }
export interface ReplyTemplate { id: string; name: string; text: string }

export type IntStatus = "off" | "connecting" | "ok" | "error";
export type TguStage = "creds" | "code" | "password"; // шаги входа в личный Telegram
export interface Integrations {
  tgUser: { apiId: string; apiHash: string; phone: string; session: string; status: IntStatus; stage?: TguStage; name?: string; error?: string };
  tg: { token: string; status: IntStatus; botName?: string; offset?: number; error?: string };
  wa: { apiUrl: string; idInstance: string; apiToken: string; status: IntStatus; error?: string };
  max: { token: string; status: IntStatus; botName?: string; marker?: number; error?: string };
  tilda: { hookId: string; status: IntStatus; seen: string[]; error?: string };
  autoLead: boolean;
}
export const defaultIntegrations = (): Integrations => ({
  tgUser: { apiId: "", apiHash: "", phone: "", session: "", status: "off" },
  tg: { token: "", status: "off" },
  wa: { apiUrl: "https://api.green-api.com", idInstance: "", apiToken: "", status: "off" },
  max: { token: "", status: "off" },
  tilda: { hookId: "", status: "off", seen: [] },
  autoLead: true,
});
export const channelName = (ch: Channel) => (ch === "tg" ? "Telegram" : ch === "wa" ? "WhatsApp" : ch === "max" ? "MAX" : "Instagram");

// ---------- конструктор разделов ----------
export const FIELD_TYPES: { type: FieldType; label: string; group: string }[] = [
  { type: "text", label: "Текст", group: "База" },
  { type: "textarea", label: "Длинный текст", group: "База" },
  { type: "number", label: "Число", group: "База" },
  { type: "money", label: "Деньги", group: "База" },
  { type: "phone", label: "Телефон", group: "Контакты" },
  { type: "email", label: "Email", group: "Контакты" },
  { type: "url", label: "Ссылка", group: "Контакты" },
  { type: "date", label: "Дата", group: "Время" },
  { type: "datetime", label: "Дата и время", group: "Время" },
  { type: "select", label: "Список (выбор)", group: "Выбор" },
  { type: "user", label: "Сотрудник", group: "Связи" },
  { type: "relation", label: "Связь с разделом", group: "Связи" },
];
export const PALETTE = ["#8A8578", "#BC9F5C", "#7D8A5C", "#B0725A", "#6E8B8A", "#6E8B4F", "#A8543F", "#5C7A9E", "#8B6E86", "#A8547C"];
// ---------- автоматизации: универсальные правила «когда → тогда» ----------
export type RuleTrigger =
  | { type: "record_created"; entityId: string }
  | { type: "stage_enter"; entityId: string; stageId: string }   // stageId либо "kind:won"/"kind:lost" — любая финальная
  | { type: "stage_stuck"; entityId: string; days: number }
  | { type: "quiet"; entityId: string; days: number };           // тишина: нет активности N дней
export interface Rule {
  id: string; name: string; enabled: boolean; fired: number;
  trigger: RuleTrigger;
  action: { type: "task"; title: string; kind: TaskKind; afterHours: number };
}
export const defaultRules = (): Rule[] => [
  { id: uid("rule"), name: "Новая запись → связаться за час", enabled: true, fired: 0,
    trigger: { type: "record_created", entityId: "deals" },
    action: { type: "task", title: "Связаться с клиентом", kind: "call", afterHours: 1 } },
  { id: uid("rule"), name: "Застряла на стадии 3 дня", enabled: true, fired: 0,
    trigger: { type: "stage_stuck", entityId: "deals", days: 3 },
    action: { type: "task", title: "Подтолкнуть: клиент завис на стадии", kind: "call", afterHours: 2 } },
  { id: uid("rule"), name: "Успех → взять отзыв и продать ещё", enabled: true, fired: 0,
    trigger: { type: "stage_enter", entityId: "deals", stageId: "kind:won" },
    action: { type: "task", title: "Взять отзыв и предложить следующий заказ", kind: "msg", afterHours: 24 } },
  { id: uid("rule"), name: "Спящий клиент: тишина 60 дней", enabled: true, fired: 0,
    trigger: { type: "quiet", entityId: "deals", days: 60 },
    action: { type: "task", title: "Напомнить о себе: давно не общались", kind: "msg", afterHours: 1 } },
];

export const defaultStages = (): Stage[] => [
  { id: uid("s"), label: "Новая", color: "#8A8578", kind: "open" },
  { id: uid("s"), label: "В работе", color: "#BC9F5C", kind: "open" },
  { id: uid("s"), label: "Успех", color: "#6E8B4F", kind: "won" },
  { id: uid("s"), label: "Отказ", color: "#A8543F", kind: "lost" },
];

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

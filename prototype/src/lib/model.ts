// XXLcrm prototype — модель данных конструктора (9 примитивов)

export type FieldType =
  | "text" | "textarea" | "number" | "money" | "phone" | "email" | "url"
  | "date" | "datetime" | "checkbox" | "select" | "multiselect" | "tags"
  | "relation" | "user" | "rating" | "autonumber" | "rollup";

export interface Option { id: string; label: string; color: string }
export interface RollupCfg { entityId: string; viaFieldId: string; agg: "count" | "sum"; targetFieldId?: string }
export interface Field {
  id: string; label: string; type: FieldType;
  options?: Option[]; relationTo?: string; required?: boolean; inTable?: boolean;
  rollup?: RollupCfg;
}
export type StageKind = "open" | "won" | "lost";
export interface Stage { id: string; label: string; color: string; kind: StageKind; wip?: number }
export type ViewType = "table" | "kanban" | "calendar" | "cards";
export type FilterOp = "contains" | "notContains" | "is" | "isNot" | "gt" | "lt" | "empty" | "notEmpty" | "true" | "false" | "before" | "after";
export interface FilterRule { id: string; fieldId: string; op: FilterOp; value?: unknown }
export interface View {
  id: string; name: string; type: ViewType;
  dateFieldId?: string; hidden?: string[];
  sort?: { fieldId: string; dir: 1 | -1 } | null;
  filters?: FilterRule[]; filterMode?: "and" | "or";
  groupBy?: string;
}
export interface Entity {
  id: string; name: string; namePlural: string; icon: string; color: string;
  fields: Field[]; titleFieldId: string;
  pipeline?: { stages: Stage[] };
  views: View[];
}
export interface Rec {
  id: string; entityId: string; num: number;
  values: Record<string, unknown>;
  stageId?: string; stageAt?: number; ownerId: string;
  createdAt: number; updatedAt: number;
}
export type TaskKind = "call" | "meet" | "todo" | "msg";
export interface Task {
  id: string; title: string; kind: TaskKind;
  recordId?: string; ownerId: string; due: number;
  done: boolean; doneAt?: number;
}
export type ActKind = "created" | "stage" | "field" | "comment" | "task" | "auto";
export interface Activity { id: string; recordId: string; ts: number; kind: ActKind; text: string; userId?: string }

export type TriggerType = "record.created" | "stage.changed" | "stale";
export type AutoAction =
  | { kind: "task"; title: string; inDays: number; taskKind: TaskKind }
  | { kind: "notify"; text: string }
  | { kind: "stage"; stageId: string };
export interface Automation {
  id: string; name: string; enabled: boolean; entityId: string;
  trigger: TriggerType; stageId?: string; days?: number;
  actions: AutoAction[]; fired: number;
}

export type WidgetType = "number" | "funnel" | "bars" | "plan" | "activity";
export interface Widget {
  id: string; type: WidgetType; title: string; entityId?: string;
  metric?: "count" | "sum"; fieldId?: string; groupFieldId?: string;
  target?: number; openOnly?: boolean; period?: "all" | "month" | "week" | "today";
}

export interface User { id: string; name: string; role: string; hue: number }
export interface Notice { id: string; ts: number; text: string; icon?: string }

export type Channel = "tg" | "wa" | "max";
export interface ChatMsg { id: string; ts: number; out: boolean; text: string }
export interface Chat {
  id: string; name: string; phone?: string; channel: Channel; recordId?: string; unread: number; msgs: ChatMsg[];
  ext?: { tg?: number; wa?: string }; // реальные внешние идентификаторы (chat_id Telegram / chatId Green API)
}
export interface AiCfg { baseUrl: string; apiKey: string; model: string }

export type IntStatus = "off" | "connecting" | "ok" | "error";
export interface Integrations {
  tg: { token: string; status: IntStatus; botName?: string; offset?: number; error?: string };
  wa: { apiUrl: string; idInstance: string; apiToken: string; status: IntStatus; error?: string };
  tilda: { hookId: string; status: IntStatus; seen: string[]; error?: string };
  autoLead: boolean; // автосоздание лида из нового внешнего диалога / заявки Tilda
}
export const defaultIntegrations = (): Integrations => ({
  tg: { token: "", status: "off" },
  wa: { apiUrl: "https://api.green-api.com", idInstance: "", apiToken: "", status: "off" },
  tilda: { hookId: "", status: "off", seen: [] },
  autoLead: true,
});

export interface Workspace {
  name: string; templateKey: string;
  entities: Entity[]; records: Rec[]; tasks: Task[]; activities: Activity[];
  automations: Automation[]; widgets: Widget[]; users: User[]; notices: Notice[];
  chats: Chat[]; ai?: AiCfg; integrations?: Integrations;
}

// ---------- утилиты ----------
let seed = 7;
export const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
export const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
let idc = 0;
export const uid = (p = "id") => `${p}_${(++idc).toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`;

export const DAY = 86400000;
export const now = () => Date.now();
export const days = (n: number) => now() + n * DAY;
export const atHour = (dayOffset: number, h: number, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.getTime(); };
export const isToday = (ts: number) => new Date(ts).toDateString() === new Date().toDateString();
export const sameMonth = (ts: number) => { const a = new Date(ts), b = new Date(); return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear(); };

export const fmtMoney = (v: unknown) => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? "" : new Intl.NumberFormat("ru-RU").format(Number(v)) + " ₽";
export const fmtDate = (ts?: number | string) => { if (!ts) return ""; const d = new Date(Number(ts)); return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); };
export const fmtDateTime = (ts?: number | string) => { if (!ts) return ""; const d = new Date(Number(ts)); return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); };
export const relTime = (ts: number) => {
  const diff = now() - ts;
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + " мин назад";
  if (diff < DAY && isToday(ts)) return "сегодня в " + new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diff < 2 * DAY) return "вчера";
  return fmtDate(ts);
};
export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

// Палитра опций/стадий: приглушённые тёплые тона (латунь, графит, олива, терракота…)
export const PALETTE = ["#8A8578", "#BC9F5C", "#7D8A5C", "#B0725A", "#6E8B8A", "#8B6E86", "#A8543F", "#5C7A9E", "#9C8A3F", "#4E4A40"];
export const opt = (label: string, i = 0): Option => ({ id: uid("o"), label, color: PALETTE[i % PALETTE.length] });
export const stg = (label: string, i: number, kind: StageKind = "open"): Stage =>
  ({ id: uid("s"), label, kind, color: kind === "won" ? "#6E8B4F" : kind === "lost" ? "#A8543F" : PALETTE[i % PALETTE.length] });

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
  { type: "checkbox", label: "Чекбокс", group: "Выбор" },
  { type: "select", label: "Список", group: "Выбор" },
  { type: "multiselect", label: "Мультисписок", group: "Выбор" },
  { type: "tags", label: "Теги", group: "Выбор" },
  { type: "rating", label: "Рейтинг", group: "Выбор" },
  { type: "relation", label: "Связь с разделом", group: "Связи" },
  { type: "user", label: "Сотрудник", group: "Связи" },
  { type: "rollup", label: "Рол-ап (по связям)", group: "Связи" },
  { type: "autonumber", label: "Автономер", group: "База" },
];

// Операторы фильтров по типу поля
export const OPS_BY_TYPE = (t: FieldType): { op: FilterOp; label: string; needsValue: boolean }[] => {
  const base = [{ op: "empty" as FilterOp, label: "пусто", needsValue: false }, { op: "notEmpty" as FilterOp, label: "не пусто", needsValue: false }];
  if (["text", "textarea", "phone", "email", "url", "tags", "multiselect"].includes(t))
    return [{ op: "contains", label: "содержит", needsValue: true }, { op: "notContains", label: "не содержит", needsValue: true }, ...base];
  if (["number", "money", "rating"].includes(t))
    return [{ op: "gt", label: "больше", needsValue: true }, { op: "lt", label: "меньше", needsValue: true }, { op: "is", label: "равно", needsValue: true }, ...base];
  if (["date", "datetime"].includes(t))
    return [{ op: "after", label: "после", needsValue: true }, { op: "before", label: "до", needsValue: true }, ...base];
  if (t === "checkbox")
    return [{ op: "true", label: "включён", needsValue: false }, { op: "false", label: "выключен", needsValue: false }];
  return [{ op: "is", label: "равно", needsValue: true }, { op: "isNot", label: "не равно", needsValue: true }, ...base];
};

export function matchRule(f: Field, raw: unknown, rule: FilterRule, disp: string): boolean {
  const emptyV = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
  switch (rule.op) {
    case "empty": return emptyV;
    case "notEmpty": return !emptyV;
    case "true": return !!raw;
    case "false": return !raw;
    case "contains": return disp.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "notContains": return !disp.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "gt": return Number(raw) > Number(rule.value);
    case "lt": return Number(raw) < Number(rule.value);
    case "before": return !emptyV && Number(raw) < Number(rule.value);
    case "after": return !emptyV && Number(raw) > Number(rule.value);
    case "is": return ["number", "money", "rating"].includes(f.type) ? Number(raw) === Number(rule.value) : raw === rule.value;
    case "isNot": return raw !== rule.value;
    default: return true;
  }
}

export const field = (label: string, type: FieldType, extra: Partial<Field> = {}): Field =>
  ({ id: uid("f"), label, type, inTable: true, ...extra });

export const displayValue = (f: Field, v: unknown, ctx?: { recTitle?: (id: string) => string; userName?: (id: string) => string }): string => {
  if (v === undefined || v === null || v === "") return "";
  switch (f.type) {
    case "money": return fmtMoney(v);
    case "date": return fmtDate(v as number);
    case "datetime": return fmtDateTime(v as number);
    case "checkbox": return v ? "Да" : "Нет";
    case "select": return f.options?.find(o => o.id === v)?.label ?? "";
    case "multiselect": return (v as string[]).map(id => f.options?.find(o => o.id === id)?.label).filter(Boolean).join(", ");
    case "tags": return (v as string[]).join(", ");
    case "relation": return ctx?.recTitle?.(v as string) ?? "";
    case "user": return ctx?.userName?.(v as string) ?? "";
    case "rating": return "★".repeat(Number(v));
    default: return String(v);
  }
};

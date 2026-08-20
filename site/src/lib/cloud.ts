// Облачный слой: аккаунты, пространство команды, общая база и realtime (Supabase).
// Принцип «не переделывать»: компоненты и экшены A.* не знают про облако — cloud.ts
// подписывается на cloudHooks.save и превращает изменения стора в точечные upsert/delete.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supa } from "./supa";
import type { Rec, Task, Activity, Chat, ReplyTemplate, User, EntityCfg, Rule, Route } from "./model";
import { uid, defaultRules, defaultRoutes } from "./model";
import { getState, enterCloud, applyRemote, setAuthStage, setWsMeta, cloudHooks, cloudPendingHook, clone, ruleHooks, allowUnload, flushSaves, localBackup, isPrivateChat } from "./store";
import { DEFAULT_TEMPLATES, ENTITIES } from "./data";
import { planTransfer } from "./transfer";
import { inboundBoot, inboundSubscribe } from "./inbound";
import { toast } from "sonner";

let wsId: string | null = null;
let channel: RealtimeChannel | null = null;

// снимки последнего сохранённого состояния: id → канонический JSON модели (для диффа и гашения эха)
let cfgSnap = ""; // канон структуры и правил (ws_config: entities + automations)
let cfgSeen = 0;  // updated_at конфига, который мы видели последним — чтобы не затирать чужое
let cloudBroken = false;
/** Что показывать в шапке: «синхронно» — только когда это правда. */
export const cloudState = () => ({ broken: cloudBroken });
const bump = () => applyRemote(() => { /* только перерисовать шапку */ });
let cfgHasAutomations = true; // колонка automations может ещё не существовать — деградируем мягко

// В колонке ws_config.automations лежит либо старый массив правил, либо новый объект {rules, routes}:
// маршруты приёма — общая настройка команды, но отдельная колонка потребовала бы миграции базы.
type AutoCol = Rule[] | { rules?: Rule[]; routes?: Route[] } | null | undefined;
const colRules = (raw: AutoCol): Rule[] | null => (Array.isArray(raw) ? raw : raw?.rules ?? null);
const colRoutes = (raw: AutoCol): Route[] | null => (Array.isArray(raw) || !raw ? null : raw.routes ?? null);
const autoCol = (rules: Rule[], routes: Route[]) => ({ rules, routes });
const snap = {
  records: new Map<string, string>(),
  tasks: new Map<string, string>(),
  activities: new Map<string, string>(),
  chats: new Map<string, string>(),
  reply_templates: new Map<string, string>(),
};

const canon = (x: unknown) => JSON.stringify(x);

// ---------- маппинг модель ↔ строка таблицы ----------
type Row = Record<string, unknown>;
const num = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));

const M = {
  records: {
    toRow: (r: Rec): Row => ({ id: r.id, workspace_id: wsId, entity_id: r.entityId, num: r.num, values: r.values, stage_id: r.stageId ?? null, stage_at: r.stageAt ?? null, owner_id: r.ownerId ?? null, pos: r.pos ?? null, created_at: r.createdAt, updated_at: r.updatedAt }),
    fromRow: (w: Row): Rec => ({ id: String(w.id), entityId: String(w.entity_id), num: Number(w.num ?? 0), values: (w.values as Record<string, unknown>) ?? {}, stageId: (w.stage_id as string) ?? undefined, stageAt: num(w.stage_at), ownerId: String(w.owner_id ?? ""), pos: num(w.pos), createdAt: num(w.created_at) ?? 0, updatedAt: num(w.updated_at) ?? 0 }),
    list: () => getState().records,
    set: (items: Rec[]) => { getState().records.length = 0; getState().records.push(...items); },
  },
  tasks: {
    toRow: (t: Task): Row => ({ id: t.id, workspace_id: wsId, title: t.title, kind: t.kind, record_id: t.recordId ?? null, owner_id: t.ownerId ?? null, due: t.due ?? null, done: t.done, done_at: t.doneAt ?? null }),
    fromRow: (w: Row): Task => ({ id: String(w.id), title: String(w.title ?? ""), kind: (w.kind as Task["kind"]) ?? "todo", recordId: (w.record_id as string) ?? undefined, ownerId: String(w.owner_id ?? ""), due: num(w.due) ?? 0, done: !!w.done, doneAt: num(w.done_at) }),
  },
  activities: {
    // edit_key раньше терялся по дороге в облако — и задача от правила, которую человек
    // удалил, возвращалась каждый час, потому что метка «уже ставили» не доезжала
    toRow: (a: Activity): Row => ({ id: a.id, workspace_id: wsId, record_id: a.recordId, ts: a.ts, kind: a.kind, text: a.text, user_id: a.userId ?? null, edit_key: a.editKey ?? null }),
    fromRow: (w: Row): Activity => ({ id: String(w.id), recordId: String(w.record_id), ts: num(w.ts) ?? 0, kind: (w.kind as Activity["kind"]) ?? "comment", text: String(w.text ?? ""), userId: (w.user_id as string) ?? undefined, editKey: (w.edit_key as string) ?? undefined }),
  },
  chats: {
    toRow: (c: Chat): Row => ({ id: c.id, workspace_id: wsId, name: c.name, phone: c.phone ?? null, channel: c.channel, record_id: c.recordId ?? null, unread: c.unread, ext: c.ext ?? null, msgs: c.msgs.slice(-500), updated_at: Date.now() }),
    fromRow: (w: Row): Chat => ({ id: String(w.id), name: String(w.name ?? ""), phone: (w.phone as string) ?? undefined, channel: (w.channel as Chat["channel"]) ?? "tg", recordId: (w.record_id as string) ?? undefined, unread: Number(w.unread ?? 0), ext: (w.ext as Chat["ext"]) ?? undefined, msgs: (w.msgs as Chat["msgs"]) ?? [] }),
  },
  reply_templates: {
    toRow: (t: ReplyTemplate): Row => ({ id: t.id, workspace_id: wsId, name: t.name, text: t.text }),
    fromRow: (w: Row): ReplyTemplate => ({ id: String(w.id), name: String(w.name ?? ""), text: String(w.text ?? "") }),
  },
};

const ruAuthErr = (m: string): string => {
  if (/already registered/i.test(m)) return "Такой email уже зарегистрирован — попробуйте войти";
  if (/invalid login credentials/i.test(m)) return "Неверный email или пароль";
  if (/at least 6/i.test(m) || /password/i.test(m) && /short|weak/i.test(m)) return "Пароль слишком короткий — минимум 6 символов";
  if (/valid email/i.test(m) || /invalid.*email/i.test(m)) return "Проверьте формат email";
  if (/rate limit/i.test(m)) return "Слишком много попыток — подождите минуту";
  if (/not confirmed/i.test(m)) return "Email не подтверждён — напишите мне, поправлю настройки";
  if (/failed to fetch|network/i.test(m)) return "Нет связи с облаком — проверьте интернет";
  return m.slice(0, 120);
};

// ---------- аккаунт ----------
export async function cloudBoot(): Promise<void> {
  try {
    const { data } = await supa.auth.getSession();
    if (data.session) await afterLogin();
  } catch { /* офлайн — остаёмся в демо-режиме */ }
}

export async function signUp(email: string, password: string): Promise<string | null> {
  const { error } = await supa.auth.signUp({ email: email.trim(), password });
  if (error) return ruAuthErr(error.message);
  await afterLogin();
  return null;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supa.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return ruAuthErr(error.message);
  await afterLogin();
  return null;
}

export async function signOutCloud(): Promise<void> {
  // Сначала дать несохранённому уйти в базу — выход не должен тихо съедать последние правки.
  flushSaves();
  const till = Date.now() + 4000;                    // потолок: лежит сеть — человек всё равно выходит
  while ((saving || dirtyAgain) && Date.now() < till) await new Promise(r => setTimeout(r, 120));
  if (saving || dirtyAgain || cloudBroken) {
    if (!window.confirm("Часть изменений не ушла в облако. Выйти всё равно? Несохранённое пропадёт.")) return;
  }
  try { await supa.auth.signOut(); } catch { /* сессии нет */ }
  allowUnload();             // уход намеренный: сторож «не закрывайте вкладку» здесь только запирал человека в мёртвом интерфейсе
  window.location.reload();  // чистый возврат в демо-режим
}

/** Сколько личного лежит в ОБЛАКЕ прямо сейчас. Считаем по базе, а не по экрану:
    строки могли попасть туда с другого устройства. */
export async function cloudPrivateWeight(): Promise<{ chats: number; acts: number } | null> {
  if (!wsId) return null;
  const chats = await supa.from("chats").select("id, msgs").eq("workspace_id", wsId).not("ext->>tgu", "is", null);
  if (chats.error) return null;
  const texts = privTexts(chats.data ?? []);
  const acts = await supa.from("activities").select("id, text").eq("workspace_id", wsId);
  const hit = acts.error ? [] : (acts.data ?? []).filter((a: Row) => quotesPrivate(String(a.text ?? ""), texts));
  return { chats: (chats.data ?? []).length, acts: hit.length };
}

const privTexts = (rows: Row[]): string[] => {
  const out: string[] = [];
  for (const r of rows) for (const m of (r.msgs as { text?: string }[] | null) ?? []) {
    const t = (m?.text ?? "").trim();
    if (t) out.push(t);
  }
  return out;
};
// Событие в карточке — это «Telegram, клиент: <текст сообщения>». Совпадение по хвосту, а не
// по вхождению: короткое «ок» иначе снесло бы чужие комментарии.
const quotesPrivate = (actText: string, texts: string[]) => texts.some(t => actText.endsWith(t));

/** Убрать личную переписку из общего пространства. Копия на устройстве остаётся. */
export async function purgePrivateFromCloud(): Promise<{ chats: number; acts: number } | string> {
  if (!wsId) return "Облако не подключено";
  const chats = await supa.from("chats").select("id, msgs").eq("workspace_id", wsId).not("ext->>tgu", "is", null);
  if (chats.error) return chats.error.message;
  const rows = chats.data ?? [];
  const texts = privTexts(rows);

  const acts = await supa.from("activities").select("id, text").eq("workspace_id", wsId);
  if (acts.error) return acts.error.message;
  const actIds = (acts.data ?? []).filter((a: Row) => quotesPrivate(String(a.text ?? ""), texts)).map((a: Row) => String(a.id));

  for (let i = 0; i < actIds.length; i += 300) {
    const { error } = await supa.from("activities").delete().in("id", actIds.slice(i, i + 300));
    if (error) return error.message;
  }
  const chatIds = rows.map((r: Row) => String(r.id));
  for (let i = 0; i < chatIds.length; i += 300) {
    const { error } = await supa.from("chats").delete().in("id", chatIds.slice(i, i + 300));
    if (error) return error.message;
  }
  // Снимки: иначе следующее сохранение зальёт всё обратно.
  for (const id of chatIds) snap.chats.delete(id);
  for (const id of actIds) snap.activities.delete(id);
  // И из карточек на экране: цитата личного сообщения в ленте клиента — то же самое разглашение.
  const gone = new Set(actIds);
  applyRemote(s => { s.activities = s.activities.filter(a => !gone.has(a.id)); });
  return { chats: chatIds.length, acts: actIds.length };
}

const LAST_WS = "xxl-ws-last";   // куда возвращаться, если пространств несколько

/** Пространства, в которых человек состоит. Нужны, чтобы было куда переключиться. */
export async function myWorkspaces(): Promise<{ id: string; name: string; owner: boolean }[]> {
  const u = (await supa.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supa.from("members").select("workspace_id, role, workspaces(name)").eq("user_id", u.id);
  if (error || !data) return [];
  return data.map((m: Row) => ({
    id: String(m.workspace_id),
    name: String((m.workspaces as { name?: string } | null)?.name ?? "Пространство"),
    owner: m.role === "owner",
  })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Перейти в другое своё пространство, не выходя из аккаунта. */
export async function switchWs(id: string): Promise<string | null> {
  const u = (await supa.auth.getUser()).data.user;
  if (!u) return "Сессия истекла — войдите заново";
  await openWorkspace(id, u.id);
  return null;
}

async function afterLogin(): Promise<void> {
  const u = (await supa.auth.getUser()).data.user;
  if (!u) return;
  const { data, error } = await supa
    .from("members")
    .select("workspace_id, user_id, name, role, hue, workspaces(name, invite_code)")
    .eq("user_id", u.id);
  if (error) { toast.error("Облако: " + ruAuthErr(error.message)); return; }
  if (!data?.length) { setAuthStage("ws"); return; }
  // Раньше открывалось data[0] — то есть какое придётся. У человека с двумя пространствами
  // CRM после перезагрузки показывала не то, где лежит работа, и вернуться было нечем.
  let last: string | null = null;
  try { last = window.localStorage.getItem(LAST_WS); } catch { /* приватный режим */ }
  const rows = data as Row[];
  const pick = rows.find(m => String(m.workspace_id) === last)
    ?? rows.find(m => m.role === "owner")
    ?? rows[0];
  await openWorkspace(String(pick.workspace_id), u.id);
}

/** Сколько в локальной базе НЕ демо — чтобы спросить человека ДО перехода, а не после. */
export function localWeight(): { records: number; chats: number; tasks: number; any: boolean } {
  const s = getState();
  const records = s.records.filter(r => !r.demo).length;
  const chats = s.chats.filter(c => !c.demo).length;
  const tasks = s.tasks.filter(t => !t.demo).length;
  return { records, chats, tasks, any: records + chats + tasks > 0 };
}

/** То, из чего берём перенос: либо текущее состояние, либо локальная копия из браузера. */
type Src = { entities: EntityCfg[]; automations: Rule[]; routes: Route[]; records: Rec[]; tasks: Task[]; activities: Activity[]; chats: Chat[] };

/** Сколько своего лежит в локальной копии — той, что осталась в браузере после переезда. */
export function backupWeight(): { records: number; chats: number; tasks: number; any: boolean } {
  const b = localBackup();
  if (!b) return { records: 0, chats: 0, tasks: 0, any: false };
  const records = b.records.filter(r => !r.demo).length;
  const chats = b.chats.filter(c => !c.demo).length;
  const tasks = b.tasks.filter(t => !t.demo).length;
  return { records, chats, tasks, any: records + chats + tasks > 0 };
}

/** Перенести локальную копию в ПРОСТРАНСТВО, В КОТОРОМ МЫ УЖЕ РАБОТАЕМ.
    Раньше перенос был только внутри создания пространства: если человек сначала вошёл в облако,
    а потом вспомнил про наработанное — забрать его было нечем, и оно оставалось на устройстве
    навсегда. Структуру чужого пространства не трогаем: кладём только записи, задачи, диалоги
    и историю. Повторный запуск безопасен — строки идут upsert-ом по тем же id. */
export async function moveBackupHere(): Promise<string | null> {
  const s = getState();
  if (s.mode !== "cloud" || !wsId) return "Перенос возможен только в облачном пространстве";
  const b = localBackup();
  if (!b) return "Локальной копии в этом браузере нет";
  const w = backupWeight();
  if (!w.any) return "В локальной копии нет ничего, кроме примеров";
  const u = (await supa.auth.getUser()).data.user;
  if (!u) return "Сессия истекла — войдите заново";
  // структуру берём из ТЕКУЩЕГО пространства: разделы команды важнее разделов копии
  const bad = await uploadLocal(wsId, u.id, { ...b, entities: s.entities, automations: s.automations, routes: s.routes });
  if (bad) return bad;
  await openWorkspace(wsId, u.id);          // перечитываем — записи должны появиться на экране
  toast.success("База перенесена в это пространство", {
    description: `${w.records} записей · ${w.chats} диалогов · ${w.tasks} задач. Копия осталась и на этом устройстве.`,
  });
  return null;
}

/** Перенос накопленного локально в только что созданное пространство.
    Делается ДО первой загрузки — тогда человек сразу видит свои данные уже в облаке.
    Раньше вход в облако просто подменял состояние, и работа месяцами пропадала с экрана. */
async function uploadLocal(newWs: string, meId: string, src?: Src): Promise<string | null> {
  const s = src ?? getState();
  if (!s.records.some(r => !r.demo) && !s.chats.some(c => !c.demo) && !s.tasks.some(t => !t.demo)) return null;

  // Новые id и переписанные ссылки считает planTransfer: id в базе — первичный ключ на всю
  // таблицу, и перенос по старым id УТАЩИЛ БЫ записи из пространства, куда их клали раньше.
  const plan = planTransfer(s, uid);

  wsId = newWs;                                  // мапперы кладут workspace_id из этой переменной
  // Локальные id сотрудников («u1», «u2») в облаке ничего не значат: всё становится вашим,
  // а команду вы позовёте потом и раздадите ответственных заново.
  const rec = plan.records.map(r => ({ ...M.records.toRow(r), owner_id: meId }));
  const tsk = plan.tasks.map(t => ({ ...M.tasks.toRow(t), owner_id: meId }));
  const act = plan.activities.map(a => ({ ...M.activities.toRow(a), user_id: meId }));
  const cht = plan.chats.map(c => M.chats.toRow(c));

  const push = async (table: string, rows: Row[]): Promise<string | null> => {
    for (let i = 0; i < rows.length; i += 300) {
      const { error } = await supa.from(table).upsert(rows.slice(i, i + 300));
      if (error) return `${table}: ${error.message}`;
    }
    return null;
  };
  // структура — первой: без неё записи не на что положить
  const cfg = await supa.from("ws_config").upsert({
    workspace_id: newWs, entities: s.entities, automations: autoCol(s.automations, s.routes), updated_at: Date.now(),
  });
  if (cfg.error && !/automations/i.test(cfg.error.message)) return "структура: " + cfg.error.message;
  if (cfg.error) {
    const retry = await supa.from("ws_config").upsert({ workspace_id: newWs, entities: s.entities, updated_at: Date.now() });
    if (retry.error) return "структура: " + retry.error.message;
  }
  return (await push("records", rec)) ?? (await push("tasks", tsk))
      ?? (await push("activities", act)) ?? (await push("chats", cht));
}

export async function createWs(wsName: string, displayName: string, moveLocal = false): Promise<string | null> {
  const { data, error } = await supa.rpc("create_workspace", { ws_name: wsName, display_name: displayName });
  if (error) return ruAuthErr(error.message);
  const newWs = String(data);
  // стартовые шаблоны ответов — сразу в общую базу
  await supa.from("reply_templates").insert(DEFAULT_TEMPLATES.map(t => ({ id: uid("tpl"), workspace_id: newWs, name: t.name, text: t.text })));
  const u = (await supa.auth.getUser()).data.user;
  if (moveLocal) {
    const weight = localWeight();
    const bad = await uploadLocal(newWs, u?.id ?? "");
    // Раньше здесь человек оставался в окне входа с созданным, но пустым пространством —
    // и повторить перенос было НЕЧЕМ. Теперь заводим внутрь: там есть кнопка «перенести сюда».
    if (bad) {
      if (u) await openWorkspace(newWs, u.id);
      queueMicrotask(() => toast.error("Пространство создано, но база не переехала — " + bad, {
        duration: 20000,
        description: "Данные остались на этом устройстве, ничего не потеряно. Повторить: Настройки → «Перенести базу сюда».",
      }));
      return null;
    }
    if (weight.any) queueMicrotask(() => toast.success("База перенесена в облако", {
      description: `${weight.records} записей · ${weight.chats} диалогов · ${weight.tasks} задач. Копия осталась и на этом устройстве.`,
    }));
  }
  if (u) await openWorkspace(newWs, u.id);
  return null;
}

export async function joinWs(code: string, displayName: string): Promise<string | null> {
  const { data, error } = await supa.rpc("join_workspace", { code, display_name: displayName });
  if (error) return /не найден/i.test(error.message) ? "Код приглашения не найден — проверьте у владельца" : ruAuthErr(error.message);
  const u = (await supa.auth.getUser()).data.user;
  if (u) await openWorkspace(String(data), u.id);
  return null;
}

/** Я ли владелец этого пространства. Код приглашения и управление командой — только ему. */
export function iAmOwner(): boolean {
  const s = getState();
  return s.users.find(u => u.id === s.currentUserId)?.role === "Владелец";
}

/** Перевыпуск кода приглашения: старый перестаёт работать. Нужен, когда код разошёлся
    по чатам или сотрудник ушёл — иначе он остаётся вечным ключом ко всей базе. */
export async function rotateInvite(): Promise<string | null> {
  const s = getState();
  if (!s.wsId) return null;
  const code = Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  const { error } = await supa.from("workspaces").update({ invite_code: code }).eq("id", s.wsId);
  if (error) {
    toast.error("Не удалось перевыпустить код", { description: /policy|denied|permission/i.test(error.message) ? "Это может только владелец пространства" : error.message.slice(0, 90) });
    return null;
  }
  setWsMeta(s.wsName, code);
  toast.success("Код приглашения перевыпущен", { description: "Старый больше не работает" });
  return code;
}

/** Убрать сотрудника из пространства. Его записи остаются — уходит только доступ. */
export async function removeMember(userId: string): Promise<boolean> {
  const s = getState();
  if (!s.wsId) return false;
  const { error } = await supa.from("members").delete().eq("workspace_id", s.wsId).eq("user_id", userId);
  if (error) {
    toast.error("Не удалось убрать сотрудника", { description: /policy|denied|permission/i.test(error.message) ? "Это может только владелец" : error.message.slice(0, 90) });
    return false;
  }
  applyRemote(st2 => { st2.users = st2.users.filter(u => u.id !== userId); });
  toast("Сотрудник убран из пространства", { description: "Его записи и переписка остались на месте" });
  return true;
}

// ---------- загрузка пространства ----------
async function openWorkspace(id: string, meId: string): Promise<void> {
  wsId = id;
  const [recs, tasks, acts, chats, tpls, mems, wss, cfg] = await Promise.all([
    supa.from("records").select("*").eq("workspace_id", id),
    supa.from("tasks").select("*").eq("workspace_id", id),
    supa.from("activities").select("*").eq("workspace_id", id),
    supa.from("chats").select("*").eq("workspace_id", id),
    supa.from("reply_templates").select("*").eq("workspace_id", id),
    supa.from("members").select("*").eq("workspace_id", id),
    supa.from("workspaces").select("name, invite_code").eq("id", id).single(),
    supa.from("ws_config").select("*").eq("workspace_id", id).maybeSingle(),
  ]);
  // ВАЖНО: ошибка ЛЮБОГО из запросов — повод не входить вовсе. Раньше отказ по одному только
  // ws_config пропускался: структура подменялась заводской, записи команды пропадали с экрана,
  // а следом эта заводская структура затирала настоящую в базе.
  const err = recs.error ?? tasks.error ?? acts.error ?? chats.error ?? tpls.error ?? mems.error ?? wss.error ?? cfg.error;
  if (err) {
    toast.error("Не удалось загрузить пространство", {
      duration: 20000,
      description: err.message.slice(0, 120) + " · ничего не меняю, попробуйте войти ещё раз",
    });
    return;
  }

  const cfgEnts = (cfg.data?.entities as EntityCfg[] | null) ?? null;
  const cfgAuto = ((cfg.data as Row | null)?.automations as AutoCol) ?? null;
  const cfgRules = colRules(cfgAuto);
  const cfgRoutes = colRoutes(cfgAuto);
  const data = {
    entities: cfgEnts?.length ? cfgEnts : clone(ENTITIES),
    automations: cfgRules ?? defaultRules(),
    routes: cfgRoutes ?? defaultRoutes(),
    records: (recs.data ?? []).map(M.records.fromRow),
    tasks: (tasks.data ?? []).map(M.tasks.fromRow),
    activities: (acts.data ?? []).map(M.activities.fromRow).sort((a, b) => a.ts - b.ts),
    chats: (chats.data ?? []).map(M.chats.fromRow),
    replyTemplates: (tpls.data ?? []).map(M.reply_templates.fromRow),
  };
  const users: User[] = (mems.data ?? []).map((m: Row) => ({ id: String(m.user_id), name: String(m.name), role: m.role === "owner" ? "Владелец" : "Сотрудник", hue: Number(m.hue ?? 42) }));

  enterCloud(data, { wsId: id, wsName: String(wss.data?.name ?? "Пространство"), inviteCode: String(wss.data?.invite_code ?? ""), users, meId });

  // снимки для диффа
  cfgSnap = canon({ e: data.entities, a: data.automations, r: data.routes });
  cfgSeen = Number((cfg.data as Row | null)?.updated_at ?? 0);
  // Заводскую структуру записываем в базу ТОЛЬКО если её там правда нет (первый вход),
  // а не потому, что запрос не прошёл: это стирало настройку всей команды.
  const cfgRowExists = !!cfg.data;
  if (!cfgRowExists || !cfgEnts?.length || !cfgRules || !cfgRoutes) {
    try { await saveCfg(id, data.entities, data.automations, data.routes); }
    catch (e) { toast.error("Настройки пространства не сохранились", { description: String((e as Error).message).slice(0, 120) }); }
  }
  snap.records = new Map(data.records.map(r => [r.id, canon(r)]));
  snap.tasks = new Map(data.tasks.map(t => [t.id, canon(t)]));
  snap.activities = new Map(data.activities.map(a => [a.id, canon(a)]));
  snap.chats = new Map(data.chats.map(c => [c.id, canon(c)]));
  snap.reply_templates = new Map(data.replyTemplates.map(t => [t.id, canon(t)]));

  cloudHooks.save = scheduleSave;
  cloudPendingHook.has = () => saving || dirtyAgain || cloudBroken;
  try { window.localStorage.setItem(LAST_WS, id); } catch { /* приватный режим */ }
  // Подписки — дело полезное, но НЕ обязательное: исключение отсюда раньше вылетало наружу
  // и подвешивало кнопку, которая ждала openWorkspace. Данные уже загружены — работать можно.
  try { subscribeRealtime(id); } catch (e) { console.warn("realtime:", e); }
  void inboundBoot(id);      // что сервер принял, пока приложение было закрыто
  try { inboundSubscribe(id); } catch (e) { console.warn("inbound realtime:", e); }
  toast.success(`Облако подключено: ${wss.data?.name}`, { description: "Данные общие для команды и синхронизируются сами" });
}

// сохранить конфиг пространства; если колонки automations ещё нет в базе — сохраняем без неё
async function saveCfg(id: string, entities: EntityCfg[], automations: Rule[], routes: Route[]): Promise<void> {
  // Конфиг пишется целиком, поэтому перед записью смотрим, не изменил ли его коллега:
  // раньше обычное создание заявки затирало поле, которое кто-то добавил минуту назад.
  const { data: cur, error: curErr } = await supa.from("ws_config").select("updated_at").eq("workspace_id", id).maybeSingle();
  if (!curErr && cur && Number(cur.updated_at ?? 0) > cfgSeen) {
    const fresh = await supa.from("ws_config").select("*").eq("workspace_id", id).maybeSingle();
    if (!fresh.error && fresh.data) {
      const remoteEnts = (fresh.data.entities as EntityCfg[] | null) ?? null;
      if (remoteEnts?.length) {
        cfgSeen = Number(fresh.data.updated_at ?? 0);
        applyRemote(st2 => { st2.entities = remoteEnts; });
        cfgSnap = canon({ e: remoteEnts, a: automations, r: routes });
        toast("Структуру разделов обновил коллега — забрал его версию", { description: "Ваши правки структуры примените ещё раз" });
        return;
      }
    }
  }
  const stamp = Date.now();
  cfgSeen = stamp;
  if (cfgHasAutomations) {
    const { error } = await supa.from("ws_config").upsert({ workspace_id: id, entities, automations: autoCol(automations, routes), updated_at: stamp });
    if (!error) return;
    if (/automations/i.test(error.message)) cfgHasAutomations = false; // колонка не создана — падаем на entities-only
    else throw new Error("ws_config: " + error.message);
  }
  const { error } = await supa.from("ws_config").upsert({ workspace_id: id, entities, updated_at: stamp });
  if (error) throw new Error("ws_config: " + error.message);
}

// ---------- сохранение: дифф → upsert/delete ----------
let saving = false;
let dirtyAgain = false;

function scheduleSave() { void doSave(); }

async function doSave(): Promise<void> {
  if (!wsId) return;
  if (saving) { dirtyAgain = true; return; }
  saving = true;
  try {
    const st = getState();
    const cfgJ = canon({ e: st.entities, a: st.automations, r: st.routes });
    if (cfgJ !== cfgSnap) {
      await saveCfg(wsId, st.entities, st.automations, st.routes);
      cfgSnap = cfgJ;
    }
    const collections: { table: keyof typeof snap; items: { id: string }[]; toRow: (x: never) => Row }[] = [
      { table: "records", items: st.records, toRow: M.records.toRow as (x: never) => Row },
      { table: "tasks", items: st.tasks, toRow: M.tasks.toRow as (x: never) => Row },
      { table: "activities", items: st.activities, toRow: M.activities.toRow as (x: never) => Row },
      // Личная переписка в общее пространство не уходит вообще: команда её видеть не должна.
      { table: "chats", items: st.chats.filter(c => !isPrivateChat(c)), toRow: M.chats.toRow as (x: never) => Row },
      { table: "reply_templates", items: st.replyTemplates, toRow: M.reply_templates.toRow as (x: never) => Row },
    ];
    // Одна непроходящая таблица не должна останавливать сохранение остальных: раньше
    // единственная плохая строка навсегда замораживала запись всей работы.
    const problems: string[] = [];
    for (const c of collections) {
      const seen = new Set<string>();
      const changed: { id: string; j: string; row: Row }[] = [];
      for (const item of c.items) {
        seen.add(item.id);
        const j = canon(item);
        if (snap[c.table].get(item.id) !== j) changed.push({ id: item.id, j, row: c.toRow(item as never) });
      }
      // Строку, которую мы намеренно перестали выгружать (личный диалог), нельзя молча
      // сносить в облаке: удаление — отдельное осознанное действие человека, не побочный эффект.
      const held = c.table === "chats" ? new Set(getState().chats.filter(isPrivateChat).map(x => x.id)) : null;
      const deletes = [...snap[c.table].keys()].filter(id => !seen.has(id) && !held?.has(id));
      // Пачками: импорт на 10 000 строк уходил одним запросом, упирался в размер и вставал
      // намертво. По 300 строк — и то, что прошло, отмечаем сразу, чтобы не переделывать.
      for (let i = 0; i < changed.length; i += 300) {
        const part = changed.slice(i, i + 300);
        const { error } = await supa.from(c.table).upsert(part.map(x => x.row));
        if (error) { problems.push(c.table + ": " + error.message); break; }
        for (const x of part) snap[c.table].set(x.id, x.j);
      }
      if (deletes.length) {
        const { error } = await supa.from(c.table).delete().in("id", deletes);
        if (error) problems.push(c.table + " (удаление): " + error.message);
        else for (const id of deletes) snap[c.table].delete(id);
      }
    }
    if (problems.length) throw new Error(problems.join(" · "));
    if (cloudBroken) { cloudBroken = false; bump(); }
  } catch (err) {
    if (!cloudBroken) { cloudBroken = true; bump(); }
    // Раньше здесь стояло «Изменения сохранены локально» — неправда: в облачном режиме
    // локальной копии нет, и человек, закрыв вкладку, терял работу, считая её сохранённой.
    toast.error("Изменения НЕ сохранены: " + String((err as Error).message).slice(0, 80), {
      duration: 20000,
      description: "Не закрывайте вкладку. Повторю при следующем действии — или проверьте интернет и нажмите что-нибудь ещё раз.",
    });
  } finally {
    saving = false;
    if (dirtyAgain) { dirtyAgain = false; void doSave(); }
  }
}

// ---------- realtime: чужие изменения приходят сами ----------
function subscribeRealtime(id: string): void {
  // unsubscribe оставляет канал в клиенте, и supa.channel() с тем же именем вернёт ЕГО же —
  // а добавить обработчики в уже подписанный канал supabase-js не даёт.
  if (channel) { try { void supa.removeChannel(channel); } catch { /* уже мёртв */ } channel = null; }
  channel = supa.channel("ws-" + id);
  const tables: (keyof typeof snap)[] = ["records", "tasks", "activities", "chats", "reply_templates"];
  for (const t of tables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `workspace_id=eq.${id}` }, payload => onRemote(t, payload.eventType, (payload.new ?? payload.old) as Row));
  }
  channel.on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `workspace_id=eq.${id}` }, () => { void refreshMembers(); });
  channel.on("postgres_changes", { event: "*", schema: "public", table: "ws_config", filter: `workspace_id=eq.${id}` }, payload => {
    const row = payload.new as Row | null;
    const incE = (row?.entities as EntityCfg[] | undefined) ?? undefined;
    if (!incE?.length) return;
    const rawA = row?.automations as AutoCol;
    const incA = colRules(rawA) ?? getState().automations;
    const incR = colRoutes(rawA) ?? getState().routes;
    const j = canon({ e: incE, a: incA, r: incR });
    if (j === cfgSnap) return; // эхо
    cfgSnap = j;
    applyRemote(s => { s.entities = incE; s.automations = incA; s.routes = incR; });
    toast("Структура, правила и маршруты обновлены коллегой");
  });
  channel.subscribe();
}

function onRemote(table: keyof typeof snap, eventType: string, row: Row): void {
  if (!row?.id) return;
  const st = getState();
  const rid = String(row.id);
  if (eventType === "DELETE") {
    if (!snap[table].has(rid)) return;
    snap[table].delete(rid);
    applyRemote(s => {
      if (table === "records") { s.records = s.records.filter(r => r.id !== rid); if (s.drawerRecordId === rid) s.drawerRecordId = null; }
      else if (table === "tasks") s.tasks = s.tasks.filter(t => t.id !== rid);
      else if (table === "activities") s.activities = s.activities.filter(a => a.id !== rid);
      else if (table === "chats") { s.chats = s.chats.filter(c => c.id !== rid); if (s.activeChatId === rid) s.activeChatId = null; }
      else s.replyTemplates = s.replyTemplates.filter(t => t.id !== rid);
    });
    return;
  }
  // INSERT / UPDATE
  if (table === "records") {
    const inc = M.records.fromRow(row);
    const local = st.records.find(r => r.id === inc.id);
    if (local && local.updatedAt > inc.updatedAt) return;      // у нас свежее — не даём эху откатить правки
    if (snap.records.get(inc.id) === canon(inc)) return;       // эхо собственной записи
    snap.records.set(inc.id, canon(inc));
    const isNew = !local;
    applyRemote(s => { const i = s.records.findIndex(r => r.id === inc.id); if (i >= 0) s.records[i] = inc; else s.records.push(inc); });
    // Заявку из Telegram/WhatsApp/MAX/сайта создаёт сервер — в браузере createRecord не вызывался,
    // и правило «создана запись» молчало. Теперь событие даём и на пришедшую извне запись:
    // id задачи детерминированный, поэтому дубля у второго участника команды не будет.
    if (isNew) queueMicrotask(() => ruleHooks.created?.(inc.id));
  } else if (table === "tasks") {
    const inc = M.tasks.fromRow(row);
    if (snap.tasks.get(inc.id) === canon(inc)) return;
    snap.tasks.set(inc.id, canon(inc));
    applyRemote(s => { const i = s.tasks.findIndex(t => t.id === inc.id); if (i >= 0) s.tasks[i] = inc; else s.tasks.push(inc); });
  } else if (table === "activities") {
    const inc = M.activities.fromRow(row);
    if (snap.activities.get(inc.id) === canon(inc)) return;
    snap.activities.set(inc.id, canon(inc));
    applyRemote(s => { const i = s.activities.findIndex(a => a.id === inc.id); if (i >= 0) s.activities[i] = inc; else s.activities.push(inc); });
  } else if (table === "chats") {
    const inc = M.chats.fromRow(row);
    const local = st.chats.find(c => c.id === inc.id);
    if (local && local.msgs.length > inc.msgs.length) return;  // локально уже больше сообщений — эхо устарело
    if (snap.chats.get(inc.id) === canon(inc)) return;
    snap.chats.set(inc.id, canon(inc));
    applyRemote(s => {
      const i = s.chats.findIndex(c => c.id === inc.id);
      if (i >= 0) { if (s.activeChatId === inc.id) inc.unread = 0; s.chats[i] = inc; }
      else s.chats.unshift(inc);
    });
  } else {
    const inc = M.reply_templates.fromRow(row);
    if (snap.reply_templates.get(inc.id) === canon(inc)) return;
    snap.reply_templates.set(inc.id, canon(inc));
    applyRemote(s => { const i = s.replyTemplates.findIndex(t => t.id === inc.id); if (i >= 0) s.replyTemplates[i] = inc; else s.replyTemplates.push(inc); });
  }
}

async function refreshMembers(): Promise<void> {
  if (!wsId) return;
  const { data } = await supa.from("members").select("*").eq("workspace_id", wsId);
  if (!data) return;
  const before = getState().users.length;
  const users: User[] = data.map((m: Row) => ({ id: String(m.user_id), name: String(m.name), role: m.role === "owner" ? "Владелец" : "Сотрудник", hue: Number(m.hue ?? 42) }));
  applyRemote(s => { s.users = users; });
  if (users.length > before) toast.success("В команде новый участник: " + users[users.length - 1].name);
}

export async function renameWs(name: string): Promise<void> {
  if (!wsId || !name.trim()) return;
  const { error } = await supa.from("workspaces").update({ name: name.trim() }).eq("id", wsId);
  if (error) { toast.error("Не удалось переименовать: " + error.message.slice(0, 80)); return; }
  setWsMeta(name.trim(), getState().inviteCode);
}

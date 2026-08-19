// Облачный слой: аккаунты, пространство команды, общая база и realtime (Supabase).
// Принцип «не переделывать»: компоненты и экшены A.* не знают про облако — cloud.ts
// подписывается на cloudHooks.save и превращает изменения стора в точечные upsert/delete.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supa } from "./supa";
import type { Rec, Task, Activity, Chat, ReplyTemplate, User, EntityCfg, Rule, Route } from "./model";
import { uid, defaultRules, defaultRoutes } from "./model";
import { getState, enterCloud, applyRemote, setAuthStage, setWsMeta, cloudHooks, clone } from "./store";
import { DEFAULT_TEMPLATES, ENTITIES } from "./data";
import { toast } from "sonner";

let wsId: string | null = null;
let channel: RealtimeChannel | null = null;

// снимки последнего сохранённого состояния: id → канонический JSON модели (для диффа и гашения эха)
let cfgSnap = ""; // канон структуры и правил (ws_config: entities + automations)
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
    toRow: (a: Activity): Row => ({ id: a.id, workspace_id: wsId, record_id: a.recordId, ts: a.ts, kind: a.kind, text: a.text, user_id: a.userId ?? null }),
    fromRow: (w: Row): Activity => ({ id: String(w.id), recordId: String(w.record_id), ts: num(w.ts) ?? 0, kind: (w.kind as Activity["kind"]) ?? "comment", text: String(w.text ?? ""), userId: (w.user_id as string) ?? undefined }),
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
  try { await supa.auth.signOut(); } catch { /* сессии нет */ }
  window.location.reload(); // чистый возврат в демо-режим
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
  await openWorkspace(String(data[0].workspace_id), u.id);
}

export async function createWs(wsName: string, displayName: string): Promise<string | null> {
  const { data, error } = await supa.rpc("create_workspace", { ws_name: wsName, display_name: displayName });
  if (error) return ruAuthErr(error.message);
  const newWs = String(data);
  // стартовые шаблоны ответов — сразу в общую базу
  await supa.from("reply_templates").insert(DEFAULT_TEMPLATES.map(t => ({ id: uid("tpl"), workspace_id: newWs, name: t.name, text: t.text })));
  const u = (await supa.auth.getUser()).data.user;
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
  const err = recs.error ?? tasks.error ?? acts.error ?? chats.error ?? tpls.error ?? mems.error ?? wss.error;
  if (err) { toast.error("Не удалось загрузить пространство: " + err.message.slice(0, 100)); return; }

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
  if (!cfgEnts?.length || !cfgRules || !cfgRoutes) await saveCfg(id, data.entities, data.automations, data.routes);
  snap.records = new Map(data.records.map(r => [r.id, canon(r)]));
  snap.tasks = new Map(data.tasks.map(t => [t.id, canon(t)]));
  snap.activities = new Map(data.activities.map(a => [a.id, canon(a)]));
  snap.chats = new Map(data.chats.map(c => [c.id, canon(c)]));
  snap.reply_templates = new Map(data.replyTemplates.map(t => [t.id, canon(t)]));

  cloudHooks.save = scheduleSave;
  subscribeRealtime(id);
  toast.success(`Облако подключено: ${wss.data?.name}`, { description: "Данные общие для команды и синхронизируются сами" });
}

// сохранить конфиг пространства; если колонки automations ещё нет в базе — сохраняем без неё
async function saveCfg(id: string, entities: EntityCfg[], automations: Rule[], routes: Route[]): Promise<void> {
  if (cfgHasAutomations) {
    const { error } = await supa.from("ws_config").upsert({ workspace_id: id, entities, automations: autoCol(automations, routes), updated_at: Date.now() });
    if (!error) return;
    if (/automations/i.test(error.message)) cfgHasAutomations = false; // колонка не создана — падаем на entities-only
    else throw new Error("ws_config: " + error.message);
  }
  const { error } = await supa.from("ws_config").upsert({ workspace_id: id, entities, updated_at: Date.now() });
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
      { table: "chats", items: st.chats, toRow: M.chats.toRow as (x: never) => Row },
      { table: "reply_templates", items: st.replyTemplates, toRow: M.reply_templates.toRow as (x: never) => Row },
    ];
    for (const c of collections) {
      const seen = new Set<string>();
      const changed: { id: string; j: string; row: Row }[] = [];
      for (const item of c.items) {
        seen.add(item.id);
        const j = canon(item);
        if (snap[c.table].get(item.id) !== j) changed.push({ id: item.id, j, row: c.toRow(item as never) });
      }
      const deletes = [...snap[c.table].keys()].filter(id => !seen.has(id));
      if (changed.length) {
        const { error } = await supa.from(c.table).upsert(changed.map(x => x.row));
        if (error) throw new Error(c.table + ": " + error.message);
        for (const x of changed) snap[c.table].set(x.id, x.j);
      }
      if (deletes.length) {
        const { error } = await supa.from(c.table).delete().in("id", deletes);
        if (error) throw new Error(c.table + ": " + error.message);
        for (const id of deletes) snap[c.table].delete(id);
      }
    }
  } catch (err) {
    toast.error("Синхронизация не прошла: " + String((err as Error).message).slice(0, 90), { description: "Изменения сохранены локально, повторю при следующем действии" });
  } finally {
    saving = false;
    if (dirtyAgain) { dirtyAgain = false; void doSave(); }
  }
}

// ---------- realtime: чужие изменения приходят сами ----------
function subscribeRealtime(id: string): void {
  channel?.unsubscribe();
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
    applyRemote(s => { const i = s.records.findIndex(r => r.id === inc.id); if (i >= 0) s.records[i] = inc; else s.records.push(inc); });
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

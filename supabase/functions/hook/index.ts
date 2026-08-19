// XXLcrm · приёмник входящих (Supabase Edge Function «hook»).
// Telegram-вебхук и формы с сайта приходят СЮДА, а не в открытую вкладку браузера:
// сообщение сразу становится диалогом, а по маршруту канала — ещё и заявкой в нужном разделе.
// Деплой: verify_jwt = false (Telegram не присылает Authorization).
//
//   POST /functions/v1/hook?ws=<workspace_id>&src=tg|tilda&k=<secret>
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

type Any = Record<string, any>;
const json = (body: Any, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

// ---------- разбор входящего ----------
interface Msg { ext: Any; name: string; phone?: string; text: string; fields?: Any }

function parseTelegram(body: Any): Msg | null {
  const m = body?.message ?? body?.edited_message ?? body?.channel_post;
  if (!m?.chat) return null;
  const from = m.from ?? m.chat ?? {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || String(m.chat.id);
  const text = m.text ?? m.caption ?? (m.photo ? "[фото]" : m.document ? "[файл]" : m.voice ? "[голосовое]" : "[вложение]");
  return { ext: { tg: m.chat.id }, name, phone: m.contact?.phone_number, text };
}

function parseForm(fields: Any): Msg {
  const pick = (keys: string[]) => {
    const hit = Object.entries(fields).find(([k]) => keys.some(kk => k.toLowerCase().includes(kk)));
    return hit ? String(hit[1] ?? "") : undefined;
  };
  const name = pick(["name", "имя", "фио"]) ?? "";
  const phone = pick(["phone", "тел"]);
  const text = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ");
  return { ext: {}, name, phone, text, fields };
}

async function readPayload(req: Request): Promise<Any> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return await req.json().catch(() => ({}));
  if (ct.includes("form")) {
    const fd = await req.formData().catch(() => null);
    if (!fd) return {};
    const o: Any = {};
    for (const [k, v] of fd.entries()) o[k] = typeof v === "string" ? v : "[файл]";
    return o;
  }
  const raw = await req.text().catch(() => "");
  try { return JSON.parse(raw); } catch { return raw ? { text: raw } : {}; }
}

// ---------- превращение входящего в диалог и заявку ----------
async function ingest(ws: string, src: string, msg: Msg): Promise<void> {
  const { data: cfg } = await db.from("ws_config").select("entities, automations").eq("workspace_id", ws).maybeSingle();
  const entities: Any[] = (cfg?.entities as Any[]) ?? [];
  const autoCol: Any = cfg?.automations ?? {};
  const routes: Any[] = Array.isArray(autoCol) ? [] : (autoCol.routes ?? []);
  const route: Any = routes.find(r => r.source === src) ?? { source: src, auto: true, createClient: true };

  const pipeline = entities.find(e => e.id === "deals" && e.stages?.length) ?? entities.find(e => e.stages?.length);
  const entity = entities.find(e => e.id === route.entityId) ?? pipeline;
  const stage = entity?.stages?.find((s: Any) => s.id === route.stageId) ?? entity?.stages?.[0];
  const clientEnt = entities.find(e => e.id === "contacts") ?? entities.find(e => !e.stages?.length && e.fields?.some((f: Any) => f.type === "phone"));

  // ответственный: конкретный сотрудник, «по очереди» (кому меньше активных) или владелец пространства
  const { data: members } = await db.from("members").select("user_id, role").eq("workspace_id", ws);
  const owner = (members ?? []).find((m: Any) => m.role === "owner")?.user_id ?? (members ?? [])[0]?.user_id ?? null;
  let ownerId: string | null = owner;
  if (route.ownerId && route.ownerId !== "auto" && (members ?? []).some((m: Any) => m.user_id === route.ownerId)) ownerId = route.ownerId;
  else if (route.ownerId === "auto" && entity) {
    const { data: load } = await db.from("records").select("owner_id").eq("workspace_id", ws).eq("entity_id", entity.id);
    const count = new Map<string, number>();
    for (const m of members ?? []) count.set(m.user_id, 0);
    for (const r of load ?? []) if (r.owner_id) count.set(r.owner_id, (count.get(r.owner_id) ?? 0) + 1);
    ownerId = [...count.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? owner;
  }

  const nowMs = Date.now();
  const message = { id: uid("m"), ts: nowMs, out: false, text: msg.text };

  // 1) диалог: старый — дописываем, нового — заводим
  let chat: Any | null = null;
  if (src !== "tilda") {
    const extKey = Object.keys(msg.ext)[0];
    const extVal = msg.ext[extKey];
    const { data: chats } = await db.from("chats").select("*").eq("workspace_id", ws).eq("channel", src);
    chat = (chats ?? []).find((c: Any) => c.ext && String(c.ext[extKey]) === String(extVal)) ?? null;
    if (chat) {
      const msgs = [...((chat.msgs as Any[]) ?? []), message].slice(-500);
      await db.from("chats").update({ msgs, unread: (chat.unread ?? 0) + 1, updated_at: nowMs }).eq("id", chat.id);
      return; // существующий диалог — заявку повторно не создаём
    }
    chat = {
      id: uid("c"), workspace_id: ws, name: msg.name || msg.phone || "Клиент", phone: msg.phone ?? null,
      channel: src, record_id: null, unread: 1, ext: msg.ext, msgs: [message], updated_at: nowMs,
    };
  }

  if (!route.auto || !entity) {
    if (chat) await db.from("chats").insert(chat);
    return;
  }

  // 2) клиент: узнаём по телефону, иначе заводим карточку (если маршрут просит)
  let clientId: string | null = null;
  const phoneD = digits(msg.phone);
  if (clientEnt && phoneD.length >= 7) {
    const { data: recs } = await db.from("records").select("id, values").eq("workspace_id", ws).eq("entity_id", clientEnt.id);
    const phoneF = clientEnt.fields?.find((f: Any) => f.type === "phone");
    const hit = phoneF ? (recs ?? []).find((r: Any) => digits(r.values?.[phoneF.id]) === phoneD) : undefined;
    if (hit) clientId = hit.id;
  }
  if (!clientId && clientEnt && route.createClient && clientEnt.id !== entity.id) {
    const values: Any = { [clientEnt.titleFieldId]: msg.name || msg.phone || "Клиент" };
    const phoneF = clientEnt.fields?.find((f: Any) => f.type === "phone");
    if (phoneF && msg.phone) values[phoneF.id] = msg.phone;
    const srcOpt = sourceOption(clientEnt, src);
    if (srcOpt) values[srcOpt.fieldId] = srcOpt.optionId;
    clientId = uid("r");
    await db.from("records").insert({
      id: clientId, workspace_id: ws, entity_id: clientEnt.id, num: await nextNum(ws, clientEnt.id),
      values, stage_id: clientEnt.stages?.[0]?.id ?? null, stage_at: nowMs, owner_id: ownerId, pos: nowMs,
      created_at: nowMs, updated_at: nowMs,
    });
  }

  // 3) заявка: если у клиента уже есть открытая — не плодим вторую
  if (clientId) {
    const { data: open } = await db.from("records").select("id, values, stage_id").eq("workspace_id", ws).eq("entity_id", entity.id);
    const relF = entity.fields?.find((f: Any) => f.type === "relation" && f.relationTo === clientEnt?.id);
    const openOne = relF ? (open ?? []).find((r: Any) =>
      r.values?.[relF.id] === clientId && entity.stages?.find((s: Any) => s.id === r.stage_id)?.kind === "open") : undefined;
    if (openOne) {
      if (chat) { chat.record_id = openOne.id; await db.from("chats").insert(chat); }
      await db.from("activities").insert({
        id: uid("a"), workspace_id: ws, record_id: openOne.id, ts: nowMs, kind: "comment",
        text: `Клиент снова написал (${srcName(src)}) — диалог привязан к текущей записи`, user_id: null,
      });
      return;
    }
  }

  const values: Any = { [entity.titleFieldId]: msg.name || msg.phone || "Заявка" };
  const relF = entity.fields?.find((f: Any) => f.type === "relation" && f.relationTo === clientEnt?.id);
  if (relF && clientId) values[relF.id] = clientId;
  const srcOpt = sourceOption(entity, src);
  if (srcOpt) values[srcOpt.fieldId] = srcOpt.optionId;

  const recId = uid("r");
  await db.from("records").insert({
    id: recId, workspace_id: ws, entity_id: entity.id, num: await nextNum(ws, entity.id),
    values, stage_id: stage?.id ?? null, stage_at: nowMs, owner_id: ownerId, pos: nowMs,
    created_at: nowMs, updated_at: nowMs,
  });
  await db.from("activities").insert([
    { id: uid("a"), workspace_id: ws, record_id: recId, ts: nowMs, kind: "created", text: "Запись создана", user_id: null },
    { id: uid("a"), workspace_id: ws, record_id: recId, ts: nowMs + 1, kind: "comment", text: `Пришло с сервера: ${srcName(src)}${msg.phone ? " · " + msg.phone : ""}`, user_id: null },
  ]);
  if (chat) { chat.record_id = recId; await db.from("chats").insert(chat); }
}

async function nextNum(ws: string, entityId: string): Promise<number> {
  const { count } = await db.from("records").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("entity_id", entityId);
  return (count ?? 0) + 1;
}

function sourceOption(e: Any, src: string): { fieldId: string; optionId: string } | undefined {
  const f = e.fields?.find((x: Any) => x.type === "select" && (x.id === "source" || /источник|канал/i.test(x.label ?? "")));
  if (!f?.options?.length) return undefined;
  const want = src === "wa" ? /whatsapp|ватс/i : src === "tg" ? /telegram|телеграм/i : src === "max" ? /max|макс/i
    : src === "ig" ? /instagram|инстаг/i : /сайт|tilda|тильда|форма/i;
  const o = f.options.find((x: Any) => want.test(x.label ?? ""));
  return o ? { fieldId: f.id, optionId: o.id } : undefined;
}

const srcName = (s: string) => (s === "tg" ? "Telegram" : s === "wa" ? "WhatsApp" : s === "max" ? "MAX" : s === "tilda" ? "сайт" : s);

// ---------- точка входа ----------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  const url = new URL(req.url);
  const ws = url.searchParams.get("ws") ?? "";
  const src = url.searchParams.get("src") ?? "tg";
  const key = req.headers.get("x-telegram-bot-api-secret-token") ?? url.searchParams.get("k") ?? "";
  if (!ws) return json({ ok: false, error: "no workspace" }, 400);

  const { data: hook } = await db.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", src).maybeSingle();
  if (!hook?.secret || hook.secret !== key) return json({ ok: false, error: "bad key" }, 401);

  const payload = await readPayload(req);
  const msg = src === "tg" ? parseTelegram(payload) : parseForm(payload);
  if (!msg || (!msg.text && !msg.name)) return json({ ok: true, skipped: true });

  let processed = true, error: string | null = null;
  try {
    await ingest(ws, src, msg);
  } catch (e) {
    processed = false;                       // не вышло — приложение доделает при открытии
    error = String((e as Error).message ?? e).slice(0, 300);
    console.error("ingest failed", error);
  }
  await db.from("inbound").insert({
    workspace_id: ws, source: src, ext: msg.ext, name: msg.name, phone: msg.phone ?? null,
    text: msg.text, fields: msg.fields ?? null, ts: Date.now(), processed, error,
  });
  return json({ ok: true });
});

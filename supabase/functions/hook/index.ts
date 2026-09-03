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

const VERSION = "0.23"; // клиент спрашивает версию перед включением канала — чтобы не слать вебхуки в старую функцию
type Any = Record<string, any>;
// CORS открыт: форму с заявкой можно повесить на любой сайт и слать fetch-ом прямо в приёмник
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
const json = (body: Any, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
// Тот же порог, что и в приложении: меньше семи цифр — не телефон, склеивать по нему нельзя.
// «» === «» приклеивало заявку без телефона к случайному чужому клиенту.
const digits = (v: unknown): string => {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 7) return "\u0000нет";
  return d.length >= 10 ? d.slice(-10) : d;
};

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

// Green API присылает вебхук WhatsApp; берём только текстовые входящие
function parseWhatsApp(body: Any): Msg | null {
  if (body?.typeWebhook !== "incomingMessageReceived") return null;
  const text = body.messageData?.textMessageData?.textMessage ?? body.messageData?.extendedTextMessageData?.text;
  const chatId: string | undefined = body.senderData?.chatId;
  if (!text || !chatId) return null;
  const phone = "+" + String(chatId).replace(/@.*$/, "");
  return { ext: { wa: chatId }, name: body.senderData?.senderName || phone, phone, text };
}

// Instagram: вебхук Meta (Messenger Platform). Эхо своих же исходящих пропускаем.
function parseInstagram(body: Any): Msg | null {
  if (body?.object !== "instagram" && body?.object !== "page") return null;
  for (const entry of body?.entry ?? []) {
    for (const ev of entry?.messaging ?? []) {
      if (ev?.message?.is_echo) continue;
      const text: string | undefined = ev?.message?.text;
      const sid = ev?.sender?.id;
      if (text && sid) return { ext: { ig: String(sid) }, name: "Instagram · " + String(sid).slice(-6), text };
    }
  }
  return null;
}

// ВКонтакте: Callback API сообщества. Имя собеседника подтягиваем отдельно (users.get), если есть токен.
function parseVk(body: Any): Msg | null {
  if (body?.type !== "message_new") return null;
  const m = body?.object?.message ?? body?.object;
  const text: string | undefined = m?.text;
  const peer = Number(m?.peer_id ?? m?.from_id);
  if (!text || !peer) return null;
  return { ext: { vk: peer }, name: "ВКонтакте · " + peer, text };
}
// Авито: Messenger API v3 (вебхук). Свои же исходящие (author_id = наш аккаунт) пропускаем в ingest.
function parseAvito(body: Any): Msg | null {
  const v = body?.payload?.value;
  if (body?.payload?.type !== "message" || !v) return null;
  const text: string | undefined = v?.content?.text;
  const chat: string | undefined = v?.chat_id;
  if (!text || !chat) return null;
  return { ext: { avito: String(chat) }, name: "Авито · " + String(v.author_id ?? ""), text };
}

// MAX Bot API — зеркально Telegram
function parseMax(body: Any): Msg | null {
  if (body?.update_type !== "message_created") return null;
  const text: string | undefined = body?.message?.body?.text;
  const chatId: number | undefined = body?.message?.recipient?.chat_id;
  if (!text || typeof chatId !== "number") return null;
  return { ext: { max: chatId }, name: body?.message?.sender?.name ?? "MAX", text };
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

// Supabase-клиент НЕ бросает исключение на ошибку базы — он возвращает {error}. Раньше эти
// ошибки никто не смотрел: заявка не сохранялась, но помечалась «обработана», а владельцу
// уходило уведомление о заявке, которой нет. Теперь любой отказ базы — это исключение.
async function must<T>(p: PromiseLike<{ data: T; error: Any }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message ?? error}`);
  return data;
}

// Чужой текст: невидимые управляющие символы направления письма и полотна в 200 000 символов
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g;
const clean = (v: unknown, max = 4000): string => String(v ?? "").replace(BIDI, "").slice(0, max);

const BODY_MAX = 64 * 1024;               // 64 КБ хватит любой заявке; больше — не читаем
const cut = (v: string) => (v.length > 8000 ? v.slice(0, 8000) + "…" : v);

async function readPayload(req: Request): Promise<Any> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > BODY_MAX) return {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return await req.json().catch(() => ({}));
  if (ct.includes("form")) {
    const fd = await req.formData().catch(() => null);
    if (!fd) return {};
    const o: Any = {};
    for (const [k, v] of fd.entries()) o[k] = typeof v === "string" ? v : "[файл]";
    return o;
  }
  const raw = (await req.text().catch(() => "")).slice(0, BODY_MAX);
  try { return JSON.parse(raw); } catch { return raw ? { text: raw } : {}; }
}

// ---------- уведомления владельцу в Telegram ----------
// Смысл: приём работает при закрытом браузере, значит и узнавать о заявке нужно не из браузера.
async function tgBot(ws: string): Promise<string | null> {
  const { data } = await db.from("channel_hooks").select("bot_token").eq("workspace_id", ws).eq("source", "tg").maybeSingle();
  return (data?.bot_token as string) ?? null;
}

async function notify(ws: string, text: string): Promise<void> {
  const token = await tgBot(ws);
  if (!token) return;
  const { data: targets } = await db.from("notify_targets").select("chat_id").eq("workspace_id", ws);
  await Promise.all((targets ?? []).map((t: Any) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: t.chat_id, text, disable_web_page_preview: true }),
  }).catch(() => null)));
}

// «/start notify_...» у своего бота = подписка на уведомления.
// ws берём ИЗ ПРОВЕРЕННОГО СЕКРЕТОМ адреса, а не из текста сообщения: иначе любой, кто узнал
// id чужого пространства, писал боту «/start notify_<чужой ws>» и получал чужие заявки себе в ТГ.
async function handleStart(ws: string, body: Any): Promise<boolean> {
  const m = body?.message;
  const text: string = m?.text ?? "";
  if (!m?.chat || !text.startsWith("/start")) return false;
  const arg = text.split(/\s+/)[1] ?? "";
  if (!arg.startsWith("notify_") || !ws) return false;
  // Бот публичный: его имя есть на сайте и в самой CRM, написать ему может кто угодно.
  // Поэтому мало префикса — в ссылке-приглашении лежит метка пространства, и без неё
  // подписка не оформляется. Иначе посторонний получал бы каждую заявку себе в личку.
  // Метка — СЕКРЕТ пространства (channel_hooks, source «notify»), который выдаёт владелец и
  // может перевыпустить. Раньше меткой были первые символы id пространства, а id лежит в адресе
  // приёмника на сайте и у каждого бывшего сотрудника — подписаться на все заявки мог любой.
  const marker = arg.slice(7);
  const { data: ns } = await db.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", "notify").maybeSingle();
  const want = String(ns?.secret ?? "");
  if (!want || marker.length < 8 || marker !== want) {
    console.log("notify: чужая или пустая метка");
    return true;                      // молча: не подсказываем, что метка бывает правильной
  }
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "";
  const { count } = await db.from("notify_targets").select("chat_id", { count: "exact", head: true }).eq("workspace_id", ws);
  if ((count ?? 0) < 10) await db.from("notify_targets").upsert({ workspace_id: ws, chat_id: String(m.chat.id), name });
  const token = await tgBot(ws);
  if (token) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: m.chat.id, text: "Готово. Буду присылать сюда новые заявки — даже когда CRM закрыта." }),
    }).catch(() => null);
  }
  return true;
}

// ---------- превращение входящего в диалог и заявку ----------
async function ingest(ws: string, src: string, msg: Msg, onlyChat = false): Promise<boolean> {
  // Колонки automations может не быть в старой схеме. Раньше запрос падал целиком и заявка
  // молча терялась — теперь структуру берём отдельным запросом, а маршруты по возможности.
  const { data: cfg } = await db.from("ws_config").select("entities").eq("workspace_id", ws).maybeSingle();
  const entities: Any[] = (cfg?.entities as Any[]) ?? [];
  let autoCol: Any = {};
  try {
    const { data: a } = await db.from("ws_config").select("automations").eq("workspace_id", ws).maybeSingle();
    autoCol = a?.automations ?? {};
  } catch { autoCol = {}; }
  const routes: Any[] = Array.isArray(autoCol) ? [] : (autoCol.routes ?? []);
  const route: Any = { ...(routes.find(r => r.source === src) ?? { source: src, auto: true, createClient: true }), ...(onlyChat ? { auto: false } : {}) };

  const pipeline = entities.find(e => e.id === "deals" && e.stages?.length) ?? entities.find(e => e.stages?.length);
  const entity = entities.find(e => e.id === route.entityId) ?? pipeline;
  const stage = entity?.stages?.find((s: Any) => s.id === route.stageId) ?? entity?.stages?.[0];
  const clientEnt = entities.find(e => e.id === "contacts") ?? entities.find(e => !e.stages?.length && e.fields?.some((f: Any) => f.type === "phone"));

  // ответственный: конкретный сотрудник, «по очереди» (кому меньше активных) или владелец пространства
  const { data: members } = await db.from("members").select("user_id, role, name").eq("workspace_id", ws);
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
  msg = { ...msg, name: clean(msg.name, 120), text: clean(msg.text, 4000), phone: msg.phone ? clean(msg.phone, 40) : undefined };
  const message = { id: uid("m"), ts: nowMs, out: false, text: msg.text };

  // 1) диалог: старый — дописываем, нового — заводим
  let chat: Any | null = null;      // новый диалог: вставим в конце
  let existing: Any | null = null;  // уже существующий: только допишем сообщение
  if (src !== "tilda") {
    const extKey = Object.keys(msg.ext)[0];
    // Пересыльщик без id собеседника (голый JSON) — диалог не заводим, только заявка:
    // иначе все такие сообщения склеивались бы в один общий «диалог ни с кем».
    if (extKey === undefined) { existing = null; chat = null; }
    else {
    const extVal = msg.ext[extKey];
    // Фильтруем на стороне базы: раньше на КАЖДОЕ сообщение грузились все диалоги канала целиком, с перепиской
    const { data: chats } = await db.from("chats").select("*").eq("workspace_id", ws).eq("channel", src).eq(`ext->>${extKey}`, String(extVal)).limit(5);
    existing = (chats ?? []).find((c: Any) => c.ext && String(c.ext[extKey]) === String(extVal)) ?? null;
    if (existing) {
      // Дописываем сообщение НА СТОРОНЕ БАЗЫ: чтение-изменение-запись всего массива теряло
      // сообщение, если два прилетели одновременно — второе затирало первое.
      const appended = await db.rpc("chat_append_msg", { p_chat: existing.id, p_msg: message });
      if (appended.error) {
        // функции ещё нет (не выполнили миграцию) — старый путь, но хотя бы с проверкой ошибки
        const msgs = [...((existing.msgs as Any[]) ?? []), message].slice(-500);
        await must(db.from("chats").update({ msgs, unread: (existing.unread ?? 0) + 1, updated_at: nowMs }).eq("id", existing.id), "дозапись диалога");
      }
      // Продолжение живой заявки — новую не создаём. Но если запись удалили или она уже закрыта,
      // человек пишет по новому поводу: это новая заявка, иначе сообщение потеряется в старом диалоге.
      if (await liveRecord(ws, existing.record_id, entities)) return true;
    } else {
      // id диалога выводим из внешнего ключа: два сообщения, пришедшие одновременно,
      // попадут в ОДНУ строку, а не заведут два диалога и двух клиентов
      chat = {
        id: chatIdFor(ws, src, String(extVal)), workspace_id: ws, name: clean(msg.name || msg.phone || "Клиент", 120), phone: msg.phone ?? null,
        channel: src, record_id: null, unread: 1, ext: msg.ext, msgs: [message], updated_at: nowMs,
      };
    }
    }
  }

  if (!route.auto || !entity) {
    if (chat) { await db.from("chats").insert(chat); return true; }
    // Форма с сайта при «только диалог»: диалога у формы нет — раньше заявка ложилась в журнал
    // и исчезала для всех. Оставляем строку необработанной: клиент разберёт её при открытии.
    return src === "tilda" || src === "ig" ? false : true;
  }

  // 2) клиент: узнаём по телефону, иначе заводим карточку (если маршрут просит)
  let clientId: string | null = null;
  const phoneD = digits(msg.phone);
  if (clientEnt && phoneD.length >= 7) {
    const recs = await allRows(db.from("records").select("id, values").eq("workspace_id", ws).eq("entity_id", clientEnt.id));
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
    await must(db.from("records").insert({
      id: clientId, workspace_id: ws, entity_id: clientEnt.id, num: await nextNum(ws, clientEnt.id),
      values, stage_id: clientEnt.stages?.[0]?.id ?? null, stage_at: nowMs, owner_id: ownerId, pos: nowMs,
      created_at: nowMs, updated_at: nowMs,
    }), "карточка клиента");
  }

  // 3) заявка: если у клиента уже есть открытая — не плодим вторую
  if (clientId) {
    const open = await allRows(db.from("records").select("id, values, stage_id").eq("workspace_id", ws).eq("entity_id", entity.id));
    const relF = entity.fields?.find((f: Any) => f.type === "relation" && f.relationTo === clientEnt?.id);
    const openOne = relF ? (open ?? []).find((r: Any) =>
      r.values?.[relF.id] === clientId && entity.stages?.find((s: Any) => s.id === r.stage_id)?.kind === "open") : undefined;
    if (openOne) {
      await attachChat(chat, existing, openOne.id);
      await db.from("activities").insert({
        id: uid("a"), workspace_id: ws, record_id: openOne.id, ts: nowMs, kind: "comment",
        text: `Клиент снова написал (${srcName(src)}) — диалог привязан к текущей записи`, user_id: null,
      });
      return true;
    }
  }

  const values: Any = { [entity.titleFieldId]: msg.name || msg.phone || "Заявка" };
  const relF = entity.fields?.find((f: Any) => f.type === "relation" && f.relationTo === clientEnt?.id);
  if (relF && clientId) values[relF.id] = clientId;
  const srcOpt = sourceOption(entity, src);
  if (srcOpt) values[srcOpt.fieldId] = srcOpt.optionId;
  // ТО, ЧТО ЧЕЛОВЕК НАПИСАЛ, — главное в заявке. У формы с сайта диалога нет (чат заводится
  // только для мессенджеров), и раньше текст не попадал в CRM вообще: он уходил лишь в
  // уведомление в Telegram. Не подключил уведомления — не узнал, о чём была заявка.
  // Кладём в поле-заметку ПО СМЫСЛУ, а не в первое попавшееся textarea: у ниши «украшения»
  // первым идёт «Адрес доставки», и «хочу серьги» попадало бы туда. Адрес/город — не заметка.
  const textFields = (entity.fields ?? []).filter((f: Any) => f.type === "textarea");
  const NOTE = /коммент|заметк|сообщен|бриф|пожелан|вопрос|текст|описан|детал/i;
  const ADDR = /адрес|город|достав|индекс|улиц/i;
  const noteF = textFields.find((f: Any) => NOTE.test(f.label))
    ?? textFields.find((f: Any) => !ADDR.test(f.label));   // любое, кроме явного адреса
  if (noteF && msg.text) values[noteF.id] = msg.text.slice(0, 2000);

  const recId = uid("r");
  await must(db.from("records").insert({
    id: recId, workspace_id: ws, entity_id: entity.id, num: await nextNum(ws, entity.id),
    values, stage_id: stage?.id ?? null, stage_at: nowMs, owner_id: ownerId, pos: nowMs,
    created_at: nowMs, updated_at: nowMs,
  }), "заявка");
  await db.from("activities").insert([
    { id: uid("a"), workspace_id: ws, record_id: recId, ts: nowMs, kind: "created", text: "Запись создана", user_id: null },
    { id: uid("a"), workspace_id: ws, record_id: recId, ts: nowMs + 1, kind: "comment", text: `Пришло с сервера: ${srcName(src)}${msg.phone ? " · " + msg.phone : ""}`, user_id: null },
    // и сам текст — отдельной строкой в хронологии, чтобы он был виден даже если
    // подходящего поля в разделе нет (человек мог перекроить карточку под себя)
    ...(msg.text ? [{ id: uid("a"), workspace_id: ws, record_id: recId, ts: nowMs + 2, kind: "comment", text: `Текст заявки: ${msg.text.slice(0, 1000)}`, user_id: null }] : []),
  ]);
  await attachChat(chat, existing, recId);

  // и сразу пишем владельцу в Telegram — заявка не должна ждать, пока кто-то откроет CRM
  const ownerName = (members ?? []).find((m: Any) => m.user_id === ownerId)?.name ?? "";
  await notify(ws, [
    `Новая заявка · ${srcName(src)}`,
    String(values[entity.titleFieldId] ?? ""),
    msg.phone ? msg.phone : "",
    `${entity.name} · ${stage?.label ?? "без стадии"}${ownerName ? " · " + ownerName : ""}`,
    "",
    msg.text.slice(0, 300),
  ].filter(x => x !== "").join("\n"));
  return true;
}

// PostgREST отдаёт максимум 1000 строк — дальше листаем, иначе клиент №1001 «не узнаётся» и дублируется
async function allRows(q: Any): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await q.range(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Жива ли запись, к которой привязан диалог: существует и ещё не закрыта
async function liveRecord(ws: string, recordId: string | null, entities: Any[]): Promise<boolean> {
  if (!recordId) return false;
  const { data } = await db.from("records").select("id, entity_id, stage_id").eq("workspace_id", ws).eq("id", recordId).maybeSingle();
  if (!data) return false;                                  // запись удалили — диалог висит в пустоту
  const e = entities.find(x => x.id === data.entity_id);
  const stages: Any[] = e?.stages ?? [];
  // Раздел без воронки: закрывать нечего, а значит каждое следующее сообщение НЕ повод
  // заводить новую запись. Раньше маршрут в справочник плодил карточку на каждое сообщение.
  if (!stages.length) return entities.some(x => x.id === data.entity_id && !x.stages?.length) ? true : false;
  return stages.find((s: Any) => s.id === data.stage_id)?.kind === "open";
}

// привязать диалог к записи: новый диалог вставляем, существующий — перепривязываем
async function attachChat(fresh: Any | null, existing: Any | null, recordId: string): Promise<void> {
  if (fresh) { fresh.record_id = recordId; await must(db.from("chats").upsert(fresh, { onConflict: "id" }), "диалог"); }
  else if (existing) await must(db.from("chats").update({ record_id: recordId }).eq("id", existing.id), "привязка диалога");
}

// Детерминированный id диалога: одинаковый для одного и того же внешнего собеседника
function chatIdFor(ws: string, src: string, ext: string): string {
  let h = 2166136261;
  for (const ch of `${ws}|${src}|${ext}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return "c_srv_" + (h >>> 0).toString(36) + "_" + ext.replace(/[^\w]/g, "").slice(-12);
}

// Раньше номер был «сколько записей + 1»: после любого удаления номера начинали повторяться.
async function nextNum(ws: string, entityId: string): Promise<number> {
  const { data } = await db.from("records").select("num").eq("workspace_id", ws).eq("entity_id", entityId)
    .order("num", { ascending: false }).limit(1);
  return ((data?.[0]?.num as number) ?? 0) + 1;
}

function sourceOption(e: Any, src: string): { fieldId: string; optionId: string } | undefined {
  const f = e.fields?.find((x: Any) => x.type === "select" && (x.id === "source" || /источник|канал/i.test(x.label ?? "")));
  if (!f?.options?.length) return undefined;
  const want = src === "wa" ? /whatsapp|ватс/i : src === "tg" ? /telegram|телеграм/i : src === "max" ? /max|макс/i
    : src === "ig" ? /instagram|инстаг/i : src === "vk" ? /вконтакте|vk|вк/i : src === "avito" ? /авито|avito/i : /сайт|tilda|тильда|форма/i;
  const o = f.options.find((x: Any) => want.test(x.label ?? ""));
  return o ? { fieldId: f.id, optionId: o.id } : undefined;
}

const srcName = (s: string) => (s === "tg" ? "Telegram" : s === "wa" ? "WhatsApp" : s === "max" ? "MAX" : s === "tilda" ? "сайт" : s === "ig" ? "Instagram" : s === "vk" ? "ВКонтакте" : s === "avito" ? "Авито" : s);

// ---------- отправка ответов через сервер (Meta / VK / Avito): токены не покидают базу ----------
async function avitoToken(ws: string, row: Any): Promise<string> {
  const meta: Any = row?.meta ?? {};
  if (row?.bot_token && Number(meta.token_exp ?? 0) > Date.now() + 60_000) return String(row.bot_token);
  const r = await fetch("https://api.avito.ru/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: String(meta.client_id ?? ""), client_secret: String(meta.client_secret ?? "") }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.access_token) throw new Error("Avito: не выдал токен — проверьте client_id/client_secret");
  const token = String(d.access_token);
  await db.from("channel_hooks").update({ bot_token: token, meta: { ...meta, token_exp: Date.now() + Number(d.expires_in ?? 86400) * 1000 } })
    .eq("workspace_id", ws).eq("source", "avito");
  return token;
}
async function sendOut(ws: string, src: string, to: string, text: string): Promise<Any> {
  const { data: row } = await db.from("channel_hooks").select("bot_token, meta").eq("workspace_id", ws).eq("source", src).maybeSingle();
  if (!row) throw new Error("канал не настроен");
  if (src === "ig") {
    if (!row.bot_token) throw new Error("нет токена страницы Meta — вставьте его в карточке Instagram");
    const r = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(row.bot_token)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, message: { text }, messaging_type: "RESPONSE" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.error) throw new Error("Meta: " + String(d?.error?.message ?? r.status).slice(0, 120));
    return { ok: true, id: d?.message_id };
  }
  if (src === "vk") {
    if (!row.bot_token) throw new Error("нет токена сообщества ВКонтакте");
    const q = new URLSearchParams({ peer_id: to, message: text, random_id: String(Date.now() % 2147483647), access_token: String(row.bot_token), v: "5.199" });
    const r = await fetch("https://api.vk.com/method/messages.send", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: q });
    const d = await r.json().catch(() => ({}));
    if (d?.error) throw new Error("VK: " + String(d.error.error_msg ?? d.error.error_code).slice(0, 120));
    return { ok: true, id: d?.response };
  }
  if (src === "avito") {
    const meta: Any = row.meta ?? {};
    const token = await avitoToken(ws, row);
    const r = await fetch(`https://api.avito.ru/messenger/v1/accounts/${meta.user_id}/chats/${to}/messages`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ message: { text }, type: "text" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("Avito: " + String(d?.error?.message ?? d?.message ?? r.status).slice(0, 120));
    return { ok: true, id: d?.id };
  }
  throw new Error("этот канал не умеет отправлять через сервер");
}
// Подключение Авито: client_credentials → id аккаунта → регистрация вебхука на наш приёмник
async function avitoSetup(ws: string, secret: string, clientId: string, clientSecret: string): Promise<Any> {
  await db.from("channel_hooks").update({ meta: { client_id: clientId, client_secret: clientSecret }, bot_token: null }).eq("workspace_id", ws).eq("source", "avito");
  const { data: row } = await db.from("channel_hooks").select("bot_token, meta").eq("workspace_id", ws).eq("source", "avito").maybeSingle();
  const token = await avitoToken(ws, row);
  const me = await fetch("https://api.avito.ru/core/v1/accounts/self", { headers: { authorization: "Bearer " + token } }).then(r => r.json()).catch(() => ({}));
  const userId = me?.id;
  if (!userId) throw new Error("Avito: не удалось узнать id аккаунта");
  const hookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/hook?ws=${ws}&src=avito&k=${secret}`;
  const reg = await fetch("https://api.avito.ru/messenger/v3/webhook", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ url: hookUrl }),
  });
  if (!reg.ok) throw new Error("Avito: вебхук не зарегистрирован (HTTP " + reg.status + ")");
  const { data: cur } = await db.from("channel_hooks").select("meta").eq("workspace_id", ws).eq("source", "avito").maybeSingle();
  await db.from("channel_hooks").update({ meta: { ...(cur?.meta ?? {}), user_id: String(userId) } }).eq("workspace_id", ws).eq("source", "avito");
  return { ok: true, user_id: String(userId) };
}
// Кто зовёт: по JWT пользователя (заголовок Authorization) → участник ли он пространства
async function callerIsMember(req: Request, ws: string): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false } });
  const { data } = await anon.auth.getUser(jwt);
  const uid = data?.user?.id;
  if (!uid) return false;
  const { data: m } = await db.from("members").select("user_id").eq("workspace_id", ws).eq("user_id", uid).maybeSingle();
  return !!m;
}

// ---------- утренний дайджест: pg_cron → сюда по ключу из app_settings ----------
const MSK = 3 * 3600_000;
async function digest(): Promise<Any> {
  const { data: tg } = await db.from("notify_targets").select("workspace_id");
  const wss = [...new Set((tg ?? []).map((t: Any) => String(t.workspace_id)))];
  let sent = 0;
  for (const ws of wss) {
    const { data: off } = await db.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", "digest").maybeSingle();
    if (off?.secret === "off") continue;
    const now = Date.now();
    const mskNow = new Date(now + MSK);
    const dayEnd = Date.UTC(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate() + 1) - MSK; // конец сегодняшнего дня по Москве
    const { data: tasks } = await db.from("tasks").select("title, owner_id, due, record_id").eq("workspace_id", ws).eq("done", false).lt("due", dayEnd).order("due").limit(500);
    const { data: mems } = await db.from("members").select("user_id, name").eq("workspace_id", ws);
    const { count: fresh } = await db.from("records").select("id", { count: "exact", head: true }).eq("workspace_id", ws).gt("created_at", now - 86400_000);
    const list: Any[] = tasks ?? [];
    if (!list.length && !fresh) continue;
    const dayStart = dayEnd - 86400_000;                       // начало сегодняшнего дня по Москве
    const overdue = list.filter(t => Number(t.due) < dayStart);
    const byOwner = new Map<string, Any[]>();
    for (const t of list) { const k = String(t.owner_id ?? ""); byOwner.set(k, [...(byOwner.get(k) ?? []), t]); }
    const nameOf = (id: string) => (mems ?? []).find((m: Any) => String(m.user_id) === id)?.name ?? "без ответственного";
    const d = mskNow;
    const lines = [
      `Доброе утро · ${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      `Задач на сегодня: ${list.length}${overdue.length ? ` (просрочено: ${overdue.length})` : ""}${fresh ? ` · новых заявок за сутки: ${fresh}` : ""}`,
    ];
    for (const [uid, ts] of byOwner) {
      const od = ts.filter(t => overdue.includes(t)).length;
      lines.push(`\n${nameOf(uid)}: ${ts.length}${od ? ` (${od} просроч.)` : ""}`);
      for (const t of ts.slice(0, 5)) lines.push(`• ${String(t.title).slice(0, 60)}`);
      if (ts.length > 5) lines.push(`…и ещё ${ts.length - 5}`);
    }
    await notify(ws, lines.join("\n").slice(0, 3900));
    sent++;
  }
  return { ok: true, workspaces: wss.length, sent };
}

// ---------- точка входа ----------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const ws = url.searchParams.get("ws") ?? "";
  // утренний дайджест по ключу из закрытой таблицы (дёргает pg_cron)
  const dk = url.searchParams.get("digest");
  if (dk) {
    const { data: st } = await db.from("app_settings").select("value").eq("key", "digest_key").maybeSingle();
    if (!st?.value || st.value !== dk) return json({ ok: false, error: "bad key" }, 401);
    try { return json(await digest()); } catch (e) { return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 200) }, 500); }
  }
  // проба: «какая версия функции стоит и какие источники понимает»
  if (!ws) return json({ ok: true, version: VERSION, sources: ["tg", "wa", "max", "tilda", "ig", "vk", "avito"], send: ["ig", "vk", "avito"] });
  const src = url.searchParams.get("src") ?? "tg";
  // Действия от имени участника (ответ клиенту, подключение Авито): по JWT пользователя, без секретов в браузере
  const action = url.searchParams.get("action");
  if (action) {
    if (req.method !== "POST") return json({ ok: false, error: "POST" }, 405);
    if (!(await callerIsMember(req, ws))) return json({ ok: false, error: "not a member" }, 403);
    const body = await readPayload(req);
    try {
      if (action === "send") return json(await sendOut(ws, src, String(body?.to ?? ""), clean(body?.text, 4000)));
      if (action === "setup" && src === "avito") {
        const { data: h } = await db.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", "avito").maybeSingle();
        if (!h?.secret) return json({ ok: false, error: "сначала создайте приёмник" }, 400);
        return json(await avitoSetup(ws, String(h.secret), String(body?.client_id ?? ""), String(body?.client_secret ?? "")));
      }
      return json({ ok: false, error: "unknown action" }, 400);
    } catch (e) { return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 200) }, 400); }
  }
  // Telegram подписывает запросы заголовком — параметр k в адресе для него не принимаем:
  // адрес вебхука виден в getWebhookInfo, а заголовок знает только Telegram.
  const key = src === "tg" ? (req.headers.get("x-telegram-bot-api-secret-token") ?? "") : (req.headers.get("x-hook-key") ?? url.searchParams.get("k") ?? "");

  const { data: hook } = await db.from("channel_hooks").select("secret, meta").eq("workspace_id", ws).eq("source", src).maybeSingle();
  // Проверка вебхука Meta (Instagram): GET с hub.challenge, надо вернуть challenge голым текстом.
  // Verify token человек вводит в Meta тот же, что и секрет приёмника — сверяем и его.
  if (req.method === "GET" && url.searchParams.get("hub.mode") === "subscribe") {
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const vt = url.searchParams.get("hub.verify_token") ?? "";
    if (!hook?.secret || (vt !== hook.secret && key !== hook.secret)) return json({ ok: false, error: "bad verify token" }, 401);
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain", ...CORS } });
  }
  if (!hook?.secret || hook.secret !== key) return json({ ok: false, error: "bad key" }, 401);

  const payload = await readPayload(req);
  // Идемпотентность: Telegram повторяет доставку, если не увидел 200 вовремя. Раньше повтор
  // плодил второй такой же диалог и накручивал счётчик непрочитанных.
  // ВКонтакте сначала проверяет адрес: на type=confirmation надо ответить строкой из настроек сообщества
  if (src === "vk" && payload?.type === "confirmation") {
    const conf = String((hook as Any)?.meta?.confirm ?? "");
    return new Response(conf, { status: 200, headers: { "content-type": "text/plain", ...CORS } });
  }
  const dedupId = String(payload?.update_id ?? payload?.idMessage ?? payload?.message?.body?.mid
    ?? payload?.entry?.[0]?.messaging?.[0]?.message?.mid ?? payload?.tranid ?? payload?.message_id ?? payload?.marker
    ?? (src === "vk" ? payload?.object?.message?.id ?? payload?.event_id : "") ?? (src === "avito" ? payload?.payload?.value?.id ?? payload?.id : "") ?? "");
  if (dedupId) {
    const { data: seen, error: seenErr } = await db.from("inbound")
      .select("id").eq("workspace_id", ws).eq("source", src).eq("ext_key", dedupId).limit(1);
    if (!seenErr && seen && seen.length) return json({ ok: true, duplicate: true });
  }
  if (src === "tg" && await handleStart(ws, payload)) return json({ ok: true, subscribed: true });
  // Форма с сайта и пересыльщики: адрес приёмника по дизайну лежит в коде сайта, значит его знает
  // и спамер. Лимит по пространству и источнику — 20 заявок в минуту — и поле-приманка:
  // роботы заполняют все поля, живые люди скрытое не видят.
  if (src === "tilda" || src === "ig") {
    if (payload?._hp || payload?.website_url_hp) return json({ ok: true });
    const { count } = await db.from("inbound").select("id", { count: "exact", head: true })
      .eq("workspace_id", ws).eq("source", src).gt("ts", Date.now() - 60_000);
    if ((count ?? 0) >= 20) return json({ ok: false, error: "rate" }, 429);
  }
  // «/start» без метки — человек просто нажал кнопку у бота: диалог заводим, заявку и уведомление
  // не создаём, пока он ничего не написал (спам-аккаунты жали Start и плодили сделки).
  const justStart = src === "tg" && /^\/start\b/.test(String(payload?.message?.text ?? ""));
  const msg = src === "tg" ? parseTelegram(payload)
    : src === "wa" ? parseWhatsApp(payload)
    : src === "max" ? parseMax(payload)
    : src === "ig" ? (parseInstagram(payload) ?? parseForm(payload)) // Meta-вебхук либо пересыльщик с JSON {name, phone, text}
    : src === "vk" ? parseVk(payload)
    : src === "avito" ? parseAvito(payload)
    : parseForm(payload);
  // VK ждёт в ответ голое «ok», Avito — 200: иначе оба будут слать повторы
  const done = (b: Any, status = 200) => (src === "vk" ? new Response("ok", { status: 200, headers: { "content-type": "text/plain", ...CORS } }) : json(b, status));
  if (!msg || (!msg.text && !msg.name)) return done({ ok: true, skipped: true });
  // Авито присылает и НАШИ ответы: автор — наш аккаунт → это не входящее
  if (src === "avito" && String(payload?.payload?.value?.author_id ?? "") === String((hook as Any)?.meta?.user_id ?? "-")) return done({ ok: true, own: true });
  // ВКонтакте: имя собеседника — отдельным запросом, если есть токен сообщества
  if (src === "vk" && msg.ext.vk) {
    const { data: vrow } = await db.from("channel_hooks").select("bot_token").eq("workspace_id", ws).eq("source", "vk").maybeSingle();
    if (vrow?.bot_token) {
      const u = await fetch(`https://api.vk.com/method/users.get?user_ids=${msg.ext.vk}&access_token=${encodeURIComponent(vrow.bot_token)}&v=5.199`).then(r => r.json()).catch(() => null);
      const p = u?.response?.[0];
      if (p) msg.name = [p.first_name, p.last_name].filter(Boolean).join(" ") || msg.name;
    }
  }

  let processed = true, error: string | null = null;
  try {
    if (justStart) {
      // только диалог: подставляем маршрут «только диалог» на этот вызов
      const ok = await ingest(ws, src, { ...msg, text: "нажал Start" }, true);
      processed = ok;
    } else processed = await ingest(ws, src, msg);
  } catch (e) {
    processed = false;                       // не вышло — приложение доделает при открытии
    error = String((e as Error).message ?? e).slice(0, 300);
    console.error("ingest failed", error);
    // Владельцу — честное «заявка пришла, но не легла», иначе он узнает о потере от клиента
    await notify(ws, `Заявка пришла (${srcName(src)}), но НЕ сохранилась: ${error}\n${(msg.name || msg.phone || "")}\n${msg.text.slice(0, 200)}`).catch(() => null);
  }
  // Поля формы в журнал — с потолком: 64 КБ мусора на каждую строку раздували базу до потолка
  const fieldsJ = msg.fields ? JSON.stringify(msg.fields) : "";
  const logRow: Any = {
    workspace_id: ws, source: src, ext: msg.ext, name: cut(msg.name ?? ""), phone: msg.phone ? clean(msg.phone, 40) : null,
    text: cut(msg.text ?? ""), fields: fieldsJ && fieldsJ.length <= 4000 ? msg.fields : null, ts: Date.now(), processed, error,
  };
  const logged = await db.from("inbound").insert({ ...logRow, ext_key: dedupId || null });
  // Функцию могли выкатить раньше, чем выполнили SQL-миграцию: тогда колонки ext_key нет,
  // и раньше из-за этого переставал писаться ВЕСЬ журнал входящих. Пишем без неё.
  if (logged.error) await db.from("inbound").insert(logRow);
  return done(processed ? { ok: true } : { ok: false, queued: true, error }, processed ? 200 : 202);
});

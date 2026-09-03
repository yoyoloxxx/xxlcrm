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

const VERSION = "0.22"; // клиент спрашивает версию перед включением канала — чтобы не слать вебхуки в старую функцию
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
    : src === "ig" ? /instagram|инстаг/i : /сайт|tilda|тильда|форма/i;
  const o = f.options.find((x: Any) => want.test(x.label ?? ""));
  return o ? { fieldId: f.id, optionId: o.id } : undefined;
}

const srcName = (s: string) => (s === "tg" ? "Telegram" : s === "wa" ? "WhatsApp" : s === "max" ? "MAX" : s === "tilda" ? "сайт" : s === "ig" ? "Instagram" : s);

// ---------- точка входа ----------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const ws = url.searchParams.get("ws") ?? "";
  // проба: «какая версия функции стоит и какие источники понимает»
  if (!ws) return json({ ok: true, version: VERSION, sources: ["tg", "wa", "max", "tilda", "ig"] });
  const src = url.searchParams.get("src") ?? "tg";
  // Telegram подписывает запросы заголовком — параметр k в адресе для него не принимаем:
  // адрес вебхука виден в getWebhookInfo, а заголовок знает только Telegram.
  const key = src === "tg" ? (req.headers.get("x-telegram-bot-api-secret-token") ?? "") : (req.headers.get("x-hook-key") ?? url.searchParams.get("k") ?? "");

  const { data: hook } = await db.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", src).maybeSingle();
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
  const dedupId = String(payload?.update_id ?? payload?.idMessage ?? payload?.message?.body?.mid
    ?? payload?.entry?.[0]?.messaging?.[0]?.message?.mid ?? payload?.tranid ?? payload?.message_id ?? payload?.marker ?? "");
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
    : parseForm(payload);
  if (!msg || (!msg.text && !msg.name)) return json({ ok: true, skipped: true });

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
  return json(processed ? { ok: true } : { ok: false, queued: true, error }, processed ? 200 : 202);
});

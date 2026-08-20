// Реальные каналы прямо из браузера: Telegram Bot API, WhatsApp (Green API), MAX Bot API, Tilda (webhook-мост).
// Токены хранятся только в localStorage этого браузера. Все ошибки — мягкие: тост + статус, тик продолжается.
import { getState, A, handleIncoming } from "./store";
import { tguInit, tguSend } from "./tg-user-lazy";
import { toast } from "sonner";

const ints = () => getState().integrations;

// ---------- Telegram ----------
const tgApi = (token: string, m: string) => `https://api.telegram.org/bot${token}/${m}`;

export async function tgConnect(token: string): Promise<void> {
  A.intPatch(i => { i.tg = { token: token.trim(), status: "connecting" }; });
  try {
    const res = await fetch(tgApi(token.trim(), "getMe"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.description ?? "неверный токен");
    A.intPatch(i => { i.tg.status = "ok"; i.tg.botName = "@" + data.result.username; i.tg.offset = undefined; });
    toast.success(`Telegram подключён: @${data.result.username}`, { description: "Напишите боту с телефона — диалог появится во «Входящих»" });
  } catch (err) {
    A.intPatch(i => { i.tg.status = "error"; i.tg.error = String((err as Error).message).slice(0, 120); });
    toast.error("Telegram: " + String((err as Error).message).slice(0, 120));
  }
}

interface TgMsg { chat: { id: number; title?: string }; from?: { first_name?: string; last_name?: string; username?: string }; text?: string; caption?: string }

async function tgTick() {
  const cfg = ints().tg;
  if (cfg.status !== "ok" || !cfg.token) return;
  if (cfg.mode === "hook") return; // приём идёт на сервер — из браузера не опрашиваем
  try {
    const res = await fetch(tgApi(cfg.token, `getUpdates?timeout=0&limit=30${cfg.offset ? `&offset=${cfg.offset}` : ""}`));
    const data = await res.json();
    if (!data.ok) {
      if (data.error_code === 409) A.intPatch(i => { i.tg.error = "Конфликт: сайт открыт в двух вкладках"; });
      return;
    }
    for (const u of data.result as { update_id: number; message?: TgMsg }[]) {
      A.intPatch(i => { i.tg.offset = u.update_id + 1; });
      const m = u.message;
      const text = m?.text ?? m?.caption;
      if (!m || !text) continue;
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.chat.title || "Telegram";
      handleIncoming({ tg: m.chat.id }, name, "tg", text, m.from?.username ? "@" + m.from.username : undefined);
    }
  } catch { /* сеть моргнула — следующий тик */ }
}

async function tgSend(chatId: number, text: string): Promise<boolean> {
  const cfg = ints().tg;
  if (cfg.status !== "ok") return false;
  try {
    const res = await fetch(tgApi(cfg.token, "sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return true;
  } catch (err) { toast.error("Telegram не доставил: " + String((err as Error).message ?? err).slice(0, 100)); return false; }
}

// ---------- WhatsApp (Green API) ----------
const waApi = (m: string) => {
  const w = ints().wa;
  return `${w.apiUrl.replace(/\/$/, "")}/waInstance${w.idInstance}/${m}/${w.apiToken}`;
};

export async function waConnect(apiUrl: string, idInstance: string, apiToken: string): Promise<void> {
  A.intPatch(i => { i.wa = { apiUrl: apiUrl.trim() || "https://api.green-api.com", idInstance: idInstance.trim(), apiToken: apiToken.trim(), status: "connecting" }; });
  try {
    const res = await fetch(waApi("getStateInstance"));
    if (!res.ok) throw new Error(`HTTP ${res.status} — проверьте idInstance и токен`);
    const data = await res.json();
    if (data.stateInstance !== "authorized") throw new Error(`инстанс «${data.stateInstance}» — отсканируйте QR в кабинете Green API`);
    A.intPatch(i => { i.wa.status = "ok"; });
    toast.success("WhatsApp подключён (Green API)");
  } catch (err) {
    A.intPatch(i => { i.wa.status = "error"; i.wa.error = String((err as Error).message).slice(0, 140); });
    toast.error("WhatsApp: " + String((err as Error).message).slice(0, 140));
  }
}

async function waTick() {
  const cfg = ints().wa;
  if (cfg.status !== "ok") return;
  if (cfg.mode === "hook") return; // приём идёт на сервер
  try {
    for (let n = 0; n < 5; n++) {
      const res = await fetch(waApi("receiveNotification") + "?receiveTimeout=1");
      if (!res.ok) return;
      const item = await res.json();
      if (!item) return;
      const { receiptId, body } = item;
      try {
        if (body?.typeWebhook === "incomingMessageReceived") {
          const text = body.messageData?.textMessageData?.textMessage ?? body.messageData?.extendedTextMessageData?.text;
          const chatId: string | undefined = body.senderData?.chatId;
          if (text && chatId) {
            const phone = "+" + chatId.replace(/@.*$/, "");
            handleIncoming({ wa: chatId }, body.senderData?.senderName || phone, "wa", text, phone);
          }
        }
      } finally {
        await fetch(waApi("deleteNotification") + "/" + receiptId, { method: "DELETE" });
      }
    }
  } catch { /* следующий тик */ }
}

async function waSend(chatId: string, text: string): Promise<boolean> {
  if (ints().wa.status !== "ok") return false;
  try {
    const res = await fetch(waApi("sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message: text }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return true;
  } catch (err) { toast.error("WhatsApp не доставил: " + String((err as Error).message ?? err).slice(0, 100)); return false; }
}

// ---------- MAX (Bot API, зеркально Telegram) ----------
const maxApi = (m: string, q = "") => `https://botapi.max.ru/${m}?access_token=${encodeURIComponent(ints().max.token)}${q}`;

export async function maxConnect(token: string): Promise<void> {
  A.intPatch(i => { i.max = { token: token.trim(), status: "connecting" }; });
  try {
    const res = await fetch(`https://botapi.max.ru/me?access_token=${encodeURIComponent(token.trim())}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} — проверьте токен бота MAX`);
    const data = await res.json();
    A.intPatch(i => { i.max.status = "ok"; i.max.botName = data?.name ?? data?.username ?? "бот MAX"; i.max.marker = undefined; });
    toast.success(`MAX подключён: ${data?.name ?? "бот"}`);
  } catch (err) {
    A.intPatch(i => { i.max.status = "error"; i.max.error = String((err as Error).message).slice(0, 140); });
    toast.error("MAX: " + String((err as Error).message).slice(0, 140));
  }
}

async function maxTick() {
  const cfg = ints().max;
  if (cfg.status !== "ok" || !cfg.token) return;
  if (cfg.mode === "hook") return; // приём идёт на сервер
  try {
    const res = await fetch(maxApi("updates", `&limit=30&timeout=0${cfg.marker ? `&marker=${cfg.marker}` : ""}`));
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.marker === "number") A.intPatch(i => { i.max.marker = data.marker; });
    for (const u of data?.updates ?? []) {
      if (u?.update_type !== "message_created") continue;
      const text: string | undefined = u?.message?.body?.text;
      const chatId: number | undefined = u?.message?.recipient?.chat_id;
      const name: string = u?.message?.sender?.name ?? "MAX";
      if (text && typeof chatId === "number") handleIncoming({ max: chatId }, name, "max", text);
    }
  } catch { /* следующий тик */ }
}

async function maxSend(chatId: number, text: string): Promise<boolean> {
  if (ints().max.status !== "ok") return false;
  try {
    const res = await fetch(maxApi("messages", `&chat_id=${chatId}`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return true;
  } catch (err) { toast.error("MAX не доставил: " + String((err as Error).message ?? err).slice(0, 100)); return false; }
}

// ---------- Tilda (webhook-мост) ----------
export async function tildaCreateHook(): Promise<void> {
  A.intPatch(i => { i.tilda.status = "connecting"; i.tilda.error = undefined; });
  try {
    const res = await fetch("https://webhook.site/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_status: 200, default_content: "ok", default_content_type: "text/plain" }),
    });
    if (!res.ok) throw new Error("webhook.site недоступен (HTTP " + res.status + ")");
    const data = await res.json();
    A.intPatch(i => { i.tilda = { hookId: data.uuid, status: "ok", seen: [] }; });
    toast.success("URL для Tilda создан", { description: "Тильда: Настройки сайта → Формы → Webhook" });
  } catch (err) {
    A.intPatch(i => { i.tilda.status = "error"; i.tilda.error = String((err as Error).message).slice(0, 120); });
    toast.error("Tilda-мост: " + String((err as Error).message).slice(0, 120));
  }
}

const TILDA_SKIP = new Set(["formid", "formname", "tranid", "cookies", "tildaspec-referer", "submit"]);

async function tildaTick() {
  const cfg = ints().tilda;
  if (cfg.status !== "ok" || !cfg.hookId) return;
  try {
    const res = await fetch(`https://webhook.site/token/${cfg.hookId}/requests?sorting=newest&size=10`);
    if (!res.ok) return;
    const data = await res.json();
    const reqs: { uuid: string; content?: string; method?: string; query?: Record<string, string> }[] = data?.data ?? [];
    for (const rq of reqs.reverse()) {
      if (!rq || cfg.seen.includes(rq.uuid) || rq.method === "GET") continue;
      A.intPatch(i => { i.tilda.seen = [...i.tilda.seen.slice(-80), rq.uuid]; });
      const fields = parseTilda(rq.content ?? "", rq.query);
      if (Object.keys(fields).length) A.tildaLead(fields);
    }
  } catch { /* следующий тик */ }
}

function parseTilda(content: string, query?: Record<string, string>): Record<string, string> {
  let raw: Record<string, string> = {};
  const c = content.trim();
  if (c.startsWith("{")) { try { raw = Object.fromEntries(Object.entries(JSON.parse(c)).map(([k, v]) => [k, String(v)])); } catch { /* не JSON */ } }
  if (!Object.keys(raw).length && c.includes("=")) { try { raw = Object.fromEntries(new URLSearchParams(c).entries()); } catch { /* не form */ } }
  if (!Object.keys(raw).length && query) raw = query;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (TILDA_SKIP.has(k.toLowerCase()) || !String(v).trim()) continue;
    out[k] = String(v).trim();
  }
  return out;
}

export const tildaHookUrl = () => (ints().tilda.hookId ? `https://webhook.site/${ints().tilda.hookId}` : "");

// ---------- отправка (общий приём handleIncoming живёт в store) ----------
export async function sendChatMessage(chatId: string, text: string) {
  const chat = getState().chats.find(c => c.id === chatId);
  if (!chat) return;
  const msgId = A.chatSend(chatId, text);
  // Пузырь появляется сразу — так и надо. Но если канал не доставил, помечаем сообщение
  // как неотправленное: раньше оно навсегда оставалось в переписке как будто ушло,
  // и человек был уверен, что клиент его прочитал.
  let okSent: boolean | undefined;
  if (chat.ext?.tgu !== undefined) { await tguSend(chat.ext.tgu, text); okSent = undefined; }
  else if (chat.ext?.tg !== undefined) okSent = await tgSend(chat.ext.tg, text);
  else if (chat.ext?.wa !== undefined) okSent = await waSend(chat.ext.wa, text);
  else if (chat.ext?.max !== undefined) okSent = await maxSend(chat.ext.max, text);
  if (okSent === false && msgId) A.chatMarkFailed(chatId, msgId);
}

// ---------- движок ----------
let timer: number | undefined;
let busy = false;
export function initIntegrations() {
  if (timer) return;
  void tguInit(); // личный Telegram: событийный (MTProto), не поллинг
  timer = window.setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await Promise.all([tgTick(), waTick(), maxTick(), tildaTick()]); } finally { busy = false; }
  }, 4000);
}

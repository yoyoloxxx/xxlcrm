// Реальные интеграции прототипа: Telegram Bot API, WhatsApp через Green API, Tilda через webhook-мост.
// Всё работает прямо из браузера (CORS у этих API открыт); токены хранятся только локально.
import { getState, A, entityById, recTitle } from "./store";
import { toast } from "sonner";

const ints = () => getState().ws?.integrations;

// ---------- Telegram ----------
const tgApi = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function tgConnect(token: string): Promise<void> {
  A.intPatch(i => { i.tg.token = token.trim(); i.tg.status = "connecting"; i.tg.error = undefined; });
  try {
    const res = await fetch(tgApi(token.trim(), "getMe"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.description ?? "неверный токен");
    A.intPatch(i => { i.tg.status = "ok"; i.tg.botName = "@" + data.result.username; i.tg.offset = undefined; });
    toast.success(`Telegram подключён: @${data.result.username}`, { description: "Напишите боту с телефона — сообщение появится во «Входящих»" });
  } catch (err) {
    A.intPatch(i => { i.tg.status = "error"; i.tg.error = String((err as Error).message).slice(0, 120); });
    toast.error("Telegram: " + String((err as Error).message).slice(0, 120));
  }
}

async function tgTick() {
  const cfg = ints()?.tg;
  if (!cfg || cfg.status !== "ok" || !cfg.token) return;
  try {
    const res = await fetch(tgApi(cfg.token, `getUpdates?timeout=0&limit=30${cfg.offset ? `&offset=${cfg.offset}` : ""}`));
    const data = await res.json();
    if (!data.ok) {
      if (data.error_code === 409) A.intPatch(i => { i.tg.error = "Конфликт: прототип открыт в двух вкладках"; });
      return;
    }
    for (const u of data.result as { update_id: number; message?: TgMsg; channel_post?: TgMsg }[]) {
      A.intPatch(i => { i.tg.offset = u.update_id + 1; });
      const m = u.message ?? u.channel_post;
      if (!m) continue;
      const text = m.text ?? m.caption;
      if (!text) continue;
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.chat.title || "Telegram";
      handleIncoming("tg", { tg: m.chat.id }, name, text, m.from?.username ? "@" + m.from.username : undefined);
    }
  } catch { /* сеть моргнула — попробуем в следующий тик */ }
}
interface TgMsg { chat: { id: number; title?: string }; from?: { first_name?: string; last_name?: string; username?: string; is_bot?: boolean }; text?: string; caption?: string }

async function tgSend(chatId: number, text: string): Promise<boolean> {
  const cfg = ints()?.tg;
  if (!cfg?.token || cfg.status !== "ok") return false;
  try {
    const res = await fetch(tgApi(cfg.token, "sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return true;
  } catch (err) {
    toast.error("Telegram не доставил: " + String((err as Error).message ?? err).slice(0, 100));
    return false;
  }
}

// ---------- WhatsApp (Green API) ----------
const waApi = (m: string) => {
  const w = ints()!.wa;
  return `${w.apiUrl.replace(/\/$/, "")}/waInstance${w.idInstance}/${m}/${w.apiToken}`;
};

export async function waConnect(apiUrl: string, idInstance: string, apiToken: string): Promise<void> {
  A.intPatch(i => { i.wa = { apiUrl: apiUrl.trim() || "https://api.green-api.com", idInstance: idInstance.trim(), apiToken: apiToken.trim(), status: "connecting" }; });
  try {
    const res = await fetch(waApi("getStateInstance"));
    if (!res.ok) throw new Error(`HTTP ${res.status} — проверьте idInstance и токен`);
    const data = await res.json();
    if (data.stateInstance !== "authorized") throw new Error(`инстанс в статусе «${data.stateInstance}» — авторизуйте WhatsApp по QR в кабинете Green API`);
    A.intPatch(i => { i.wa.status = "ok"; });
    toast.success("WhatsApp подключён (Green API)", { description: "Входящие сообщения будут появляться во «Входящих»" });
  } catch (err) {
    A.intPatch(i => { i.wa.status = "error"; i.wa.error = String((err as Error).message).slice(0, 140); });
    toast.error("WhatsApp: " + String((err as Error).message).slice(0, 140));
  }
}

async function waTick() {
  const cfg = ints()?.wa;
  if (!cfg || cfg.status !== "ok") return;
  try {
    for (let n = 0; n < 5; n++) {
      const res = await fetch(waApi("receiveNotification") + "?receiveTimeout=1");
      if (!res.ok) return;
      const item = await res.json();
      if (!item) return;
      const { receiptId, body } = item;
      try {
        if (body?.typeWebhook === "incomingMessageReceived") {
          const text = body.messageData?.textMessageData?.textMessage
            ?? body.messageData?.extendedTextMessageData?.text;
          const chatId: string | undefined = body.senderData?.chatId;
          if (text && chatId) {
            const phone = "+" + chatId.replace(/@.*$/, "");
            handleIncoming("wa", { wa: chatId }, body.senderData?.senderName || phone, text, phone);
          }
        }
      } finally {
        await fetch(waApi("deleteNotification") + "/" + receiptId, { method: "DELETE" });
      }
    }
  } catch { /* следующий тик */ }
}

async function waSend(chatId: string, text: string): Promise<boolean> {
  const cfg = ints()?.wa;
  if (!cfg || cfg.status !== "ok") return false;
  try {
    const res = await fetch(waApi("sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message: text }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return true;
  } catch (err) {
    toast.error("WhatsApp не доставил: " + String((err as Error).message ?? err).slice(0, 100));
    return false;
  }
}

// ---------- Tilda (webhook-мост через webhook.site) ----------
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
    toast.success("URL для Tilda создан", { description: "Вставьте его в Тильде: Формы → Приём данных → Webhook" });
  } catch (err) {
    A.intPatch(i => { i.tilda.status = "error"; i.tilda.error = String((err as Error).message).slice(0, 120); });
    toast.error("Tilda-мост: " + String((err as Error).message).slice(0, 120));
  }
}

const TILDA_SKIP = new Set(["formid", "formname", "tranid", "cookies", "tildaspec-referer", "tilda", "submit"]);

async function tildaTick() {
  const cfg = ints()?.tilda;
  if (!cfg || cfg.status !== "ok" || !cfg.hookId) return;
  try {
    const res = await fetch(`https://webhook.site/token/${cfg.hookId}/requests?sorting=newest&size=10`);
    if (!res.ok) return;
    const data = await res.json();
    const reqs: { uuid: string; content?: string; method?: string; query?: Record<string, string> }[] = data?.data ?? [];
    for (const rq of reqs.reverse()) {
      if (!rq || cfg.seen.includes(rq.uuid) || rq.method === "GET") continue;
      A.intPatch(i => { i.tilda.seen = [...i.tilda.seen.slice(-80), rq.uuid]; });
      const fields = parseTildaPayload(rq.content ?? "", rq.query);
      if (Object.keys(fields).length) A.tildaLead(fields);
    }
  } catch { /* следующий тик */ }
}

function parseTildaPayload(content: string, query?: Record<string, string>): Record<string, string> {
  let raw: Record<string, string> = {};
  const c = content.trim();
  if (c.startsWith("{")) {
    try { raw = Object.fromEntries(Object.entries(JSON.parse(c)).map(([k, v]) => [k, String(v)])); } catch { /* не JSON */ }
  }
  if (!Object.keys(raw).length && c.includes("=")) {
    try { raw = Object.fromEntries(new URLSearchParams(c).entries()); } catch { /* не form-data */ }
  }
  if (!Object.keys(raw).length && query) raw = query;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (TILDA_SKIP.has(k.toLowerCase()) || !String(v).trim()) continue;
    out[k] = String(v).trim();
  }
  return out;
}

// ---------- общий приём входящих ----------
function handleIncoming(channel: "tg" | "wa", ext: { tg?: number; wa?: string }, name: string, text: string, phoneOrHandle?: string) {
  const ws = getState().ws; if (!ws) return;
  const found = ws.chats.find(c => (ext.tg && c.ext?.tg === ext.tg) || (ext.wa && c.ext?.wa === ext.wa));
  if (found) { A.chatIncoming(found.id, text); return; }
  const id = A.chatIncomingExt(ext, name, channel, text, phoneOrHandle);
  if (ints()?.autoLead && id) {
    const lead = A.chatCreateLead(id);
    if (lead) toast.success("Автолид: диалог превращён в запись", { description: recTitle(lead) });
  }
}

// ---------- отправка из инбокса (локально + реальная сеть) ----------
export async function sendChatMessage(chatId: string, text: string) {
  const ws = getState().ws; if (!ws) return;
  const chat = ws.chats.find(c => c.id === chatId); if (!chat) return;
  A.chatSend(chatId, text);
  if (chat.ext?.tg) await tgSend(chat.ext.tg, text);
  else if (chat.ext?.wa) await waSend(chat.ext.wa, text);
}

// ---------- движок ----------
let timer: number | undefined;
let busy = false;
export function initIntegrations() {
  if (timer) return;
  timer = window.setInterval(async () => {
    if (busy) return;
    const s = getState();
    if (s.screen !== "app" || !s.ws?.integrations) return;
    busy = true;
    try { await Promise.all([tgTick(), waTick(), tildaTick()]); } finally { busy = false; }
  }, 4000);
}

export const tildaHookUrl = () => {
  const id = ints()?.tilda.hookId;
  return id ? `https://webhook.site/${id}` : "";
};

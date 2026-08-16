// ЛИЧНЫЙ Telegram-аккаунт через MTProto (GramJS работает прямо в браузере по WebSocket — VPN не нужен).
// Вход как в официальном приложении: номер → код → (облачный пароль). Сессия хранится ТОЛЬКО в localStorage.
// Диалоги рабочего номера появляются во «Входящих», ответы уходят от имени аккаунта.
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import type { NewMessageEvent } from "telegram/events";
import bigInt from "big-integer";
import { getState, A, handleIncoming } from "./store";
import { toast } from "sonner";

// Ключи ПРИЛОЖЕНИЯ XXLcrm (как у официального Telegram Web): владелец продукта получает их один раз
// на my.telegram.org, и тогда пользователи входят только по номеру и коду — без своих api_id/api_hash.
// Пока пусто — форма просит личные ключи (или временные, см. подсказку в настройках).
export const TG_APP = { apiId: "", apiHash: "" };

const tgu = () => getState().integrations.tgUser;
const patch = (fn: (t: ReturnType<typeof tgu>) => void) => A.intPatch(i => fn(i.tgUser));

let client: TelegramClient | null = null;
let codeResolve: ((v: string) => void) | null = null;
let passResolve: ((v: string) => void) | null = null;
let cancelRejects: ((e: Error) => void)[] = [];
const peers = new Map<string, Api.User>(); // tguId → entity (нужен access_hash для отправки)
const justSent: { text: string; ts: number }[] = []; // дедуп эха собственных отправок из CRM

const ruErr = (raw: unknown): string => {
  const m = String((raw as Error)?.message ?? raw ?? "");
  if (m.includes("PHONE_CODE_INVALID") || m.includes("PHONE_CODE_EMPTY")) return "Неверный код — проверьте и попробуйте ещё раз";
  if (m.includes("SESSION_PASSWORD_NEEDED")) return "Нужен облачный пароль (двухэтапная проверка)";
  if (m.includes("Bytes or str") || m.includes("computeCheck") || m.includes("SRP") || m.includes("getByteArray"))
    return "Вход с облачным паролём из браузера сейчас не проходит (ограничение Telegram). Обход: в Telegram → Настройки → Конфиденциальность → Облачный пароль — временно снимите его, войдите здесь по коду, затем включите обратно. Сессия сохранится.";
  if (m.includes("PASSWORD_HASH_INVALID")) return "Неверный облачный пароль";
  if (m.includes("PASSWORD")) return "Не удалось проверить облачный пароль. Обход: временно снимите облачный пароль в Telegram, войдите по коду, включите обратно.";
  if (m.includes("PHONE_NUMBER_INVALID")) return "Неверный номер — формат +79161234567";
  if (m.includes("PHONE_NUMBER_BANNED")) return "Этот номер заблокирован Telegram";
  if (m.includes("FLOOD")) return "Слишком много попыток — Telegram просит подождать";
  if (m.includes("API_ID_PUBLISHED")) return "Эти публичные ключи сейчас перегружены у Telegram — нужны свои (my.telegram.org с телефона через мобильный интернет)";
  if (m.includes("API_ID") || m.includes("API_HASH")) return "Неверные api_id / api_hash — проверьте на my.telegram.org";
  if (m.includes("AUTH_KEY") || m.includes("SESSION_REVOKED") || m.includes("UNAUTHORIZED")) return "Сессия недействительна — войдите заново";
  if (m.includes("CONNECT_TIMEOUT")) return "Не удалось соединиться с Telegram за 20 секунд — проверьте интернет";
  return m.slice(0, 140) || "Не удалось подключиться";
};

// коннект с ограничением по времени: кнопка не должна крутиться вечно при глухой сети
const connectWithTimeout = (c: TelegramClient) => Promise.race([
  c.connect(),
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error("CONNECT_TIMEOUT")), 20000)),
]);

function makeClient(session: string, apiId: number, apiHash: string): TelegramClient {
  const c = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3, useWSS: true });
  try { c.setLogLevel("error" as Parameters<TelegramClient["setLogLevel"]>[0]); } catch { /* не критично */ }
  return c;
}

const userName = (u?: Api.User | null) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || (u?.username ? "@" + u.username : "Telegram");
const userPhone = (u?: Api.User | null) => (u?.phone ? "+" + u.phone : undefined);
const msgText = (m: Api.Message) => m.message || (m.media ? "[вложение]" : "");

// ---------- вход ----------
export async function tguStartLogin(apiIdRaw: string, apiHash: string, phone: string): Promise<void> {
  const effId = apiIdRaw.trim() || TG_APP.apiId;
  const effHash = apiHash.trim() || TG_APP.apiHash;
  const apiId = Number(effId);
  if (!apiId || !effHash || !phone.trim()) return;
  apiIdRaw = effId; apiHash = effHash;
  await destroyClient();
  patch(t => { t.apiId = apiIdRaw.trim(); t.apiHash = apiHash.trim(); t.phone = phone.trim(); t.status = "connecting"; t.stage = undefined; t.error = undefined; });
  const c = makeClient("", apiId, apiHash.trim());
  client = c;
  try {
    await connectWithTimeout(c);
    await c.start({
      phoneNumber: async () => tgu().phone,
      phoneCode: async () =>
        new Promise<string>((res, rej) => { codeResolve = res; cancelRejects.push(rej); patch(t => { t.stage = "code"; }); }),
      password: async () =>
        new Promise<string>((res, rej) => { passResolve = res; cancelRejects.push(rej); patch(t => { t.stage = "password"; t.error = undefined; }); }),
      onError: err => { patch(t => { t.error = ruErr(err); }); },
    });
    const session = (c.session as StringSession).save();
    const me = (await c.getMe()) as Api.User;
    patch(t => { t.session = session; t.status = "ok"; t.stage = undefined; t.error = undefined; t.name = userName(me); });
    toast.success(`Личный Telegram подключён: ${userName(me)}`, { description: "Диалоги появятся во «Входящих», ответы уходят от вашего имени" });
    subscribe(c);
    await syncDialogs(c);
  } catch (err) {
    await destroyClient();
    patch(t => { t.status = "error"; t.stage = undefined; t.error = ruErr(err); });
  }
}

export function tguSubmitCode(code: string) { codeResolve?.(code.trim()); codeResolve = null; }
export function tguSubmitPassword(pw: string) { passResolve?.(pw); passResolve = null; }

export async function tguCancelLogin() {
  cancelRejects.forEach(r => r(new Error("Вход отменён")));
  cancelRejects = []; codeResolve = null; passResolve = null;
  await destroyClient();
  patch(t => { t.status = "off"; t.stage = undefined; t.error = undefined; t.session = ""; });
}

// ---------- автоподключение при старте (сессия уже есть) ----------
export async function tguInit(): Promise<void> {
  const cfg = tgu();
  if (!cfg.session || client) { if (!cfg.session) patch(t => { if (t.status === "connecting") t.status = "off"; }); return; }
  const c = makeClient(cfg.session, Number(cfg.apiId), cfg.apiHash);
  client = c;
  try {
    await connectWithTimeout(c);
    if (!(await c.checkAuthorization())) throw new Error("SESSION_REVOKED");
    const me = (await c.getMe()) as Api.User;
    patch(t => { t.status = "ok"; t.name = userName(me); t.error = undefined; });
    subscribe(c);
    await syncDialogs(c);
  } catch (err) {
    await destroyClient();
    patch(t => { t.status = "error"; t.error = ruErr(err); t.session = ""; });
    toast.error("Личный Telegram: " + ruErr(err));
  }
}

// ---------- выход ----------
export async function tguDisconnect() {
  try { await client?.invoke(new Api.auth.LogOut()); } catch { /* сеть/сессия — не критично */ }
  await destroyClient();
  patch(t => { t.session = ""; t.status = "off"; t.stage = undefined; t.name = undefined; t.error = undefined; });
  toast("Личный Telegram отключён", { description: "История диалогов осталась в CRM" });
}

async function destroyClient() {
  const c = client; client = null;
  if (c) { try { await c.destroy(); } catch { /* уже мёртв */ } }
  peers.clear();
}

// ---------- живые события ----------
function subscribe(c: TelegramClient) {
  c.addEventHandler(onNewMessage, new NewMessage({}));
}

async function onNewMessage(e: NewMessageEvent) {
  try {
    const m = e.message;
    if (!m || !e.isPrivate) return; // берём только личные диалоги
    const peer = m.peerId;
    if (!(peer instanceof Api.PeerUser)) return;
    const id = peer.userId.toString();
    const text = msgText(m);
    if (!text) return;
    let ent = peers.get(id);
    if (!ent) {
      const got = await m.getChat().catch(() => null);
      if (got instanceof Api.User) { ent = got; peers.set(id, got); }
    }
    if (ent?.bot || ent?.self) return; // боты и «Избранное» — не клиенты
    const name = userName(ent);
    const phone = userPhone(ent);
    if (m.out) {
      // отправлено с телефона (или эхо нашей отправки из CRM — тогда пропускаем)
      const nowMs = Date.now();
      const i = justSent.findIndex(x => x.text === text && nowMs - x.ts < 20000);
      if (i >= 0) { justSent.splice(i, 1); return; }
      A.chatEcho({ tgu: id }, name, text, m.date * 1000, phone);
    } else {
      handleIncoming({ tgu: id }, name, "tg", text, phone);
    }
  } catch { /* событие пропало — не роняем ленту */ }
}

// ---------- синхронизация диалогов ----------
async function syncDialogs(c: TelegramClient) {
  try {
    const dialogs = await c.getDialogs({ limit: 30 });
    let n = 0;
    for (const d of dialogs) {
      if (!d.isUser || !(d.entity instanceof Api.User)) continue;
      const u = d.entity;
      if (u.bot || u.self || u.deleted) continue;
      if (n >= 15) break;
      n++;
      const id = u.id.toString();
      peers.set(id, u);
      const history = await c.getMessages(u, { limit: 8 });
      const msgs = [...history].reverse()
        .map(m => ({ ts: m.date * 1000, out: !!m.out, text: msgText(m) }))
        .filter(m => m.text);
      A.tguSyncDialog(id, userName(u), userPhone(u), msgs, Math.min(d.unreadCount ?? 0, 99));
    }
    if (n) toast.success(`Личный Telegram: синхронизировано диалогов — ${n}`);
  } catch (err) {
    toast.error("Личный Telegram: не удалось загрузить диалоги — " + ruErr(err));
  }
}

export async function tguResync() { if (client && tgu().status === "ok") await syncDialogs(client); }

// ---------- отправка ----------
export async function tguSend(id: string, text: string): Promise<void> {
  if (!client || tgu().status !== "ok") { toast.error("Личный Telegram не подключён"); return; }
  justSent.push({ text, ts: Date.now() });
  while (justSent.length > 20) justSent.shift();
  try {
    const ent = peers.get(id) ?? (await client.getInputEntity(bigInt(id)));
    await client.sendMessage(ent, { message: text });
  } catch (err) {
    toast.error("Telegram (личный) не доставил: " + ruErr(err));
  }
}

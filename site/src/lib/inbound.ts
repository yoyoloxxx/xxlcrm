// Серверный приём: вебхук Telegram и приёмник форм живут в Supabase Edge Function «hook».
// Браузер перестаёт быть транспортом — сообщения приходят и превращаются в заявки, даже когда вкладка закрыта.
// Открытое приложение получает их мгновенно через realtime; необработанные (сервер споткнулся) доделывает само.
import { supa, SUPA_URL } from "./supa";
import { getState, A, handleIncoming } from "./store";
import { toast } from "sonner";
import type { InboundSource } from "./model";

export const hookUrl = (ws: string, source: InboundSource, secret: string) =>
  `${SUPA_URL}/functions/v1/hook?ws=${ws}&src=${source}&k=${secret}`;

// Проверка, что развёрнутая серверная функция уже умеет этот источник (иначе вебхук уйдёт в старую версию)
export async function serverSupports(source: InboundSource): Promise<boolean> {
  try {
    const r = await fetch(`${SUPA_URL}/functions/v1/hook`);
    const d = await r.json();
    if (Array.isArray(d?.sources) && d.sources.includes(source)) return true;
  } catch { /* сети нет — считаем, что рано */ }
  toast.error("Серверная функция ещё не обновлена", { description: "Приём этого канала появится после обновления функции hook" });
  return false;
}

const rnd = () => (crypto.randomUUID?.() ?? String(Math.random())).replace(/-/g, "");

// секрет вебхука пространства: создаётся один раз и живёт в базе (его знает и функция, и владелец канала)
/** Перевыпуск секрета приёмника: старый адрес перестаёт работать. Нужен, если адрес утёк —
    например, попал в репозиторий или в переписку. После этого адрес в форме надо заменить. */
export async function rotateHookSecret(source: InboundSource | "notify"): Promise<string | null> {
  const ws = getState().wsId;
  if (!ws) return null;
  const secret = rnd();
  const { error } = await supa.from("channel_hooks").upsert({ workspace_id: ws, source, secret });
  if (error) {
    toast.error("Не удалось перевыпустить секрет", {
      description: /policy|permission|denied/i.test(error.message) ? "Это может только владелец пространства" : error.message.slice(0, 90),
    });
    return null;
  }
  toast.success("Секрет приёмника перевыпущен", { description: "Старый адрес больше не работает — вставьте новый в форму на сайте" });
  return secret;
}

/** Прочитать секрет приёмника, НЕ создавая его. Нужно, чтобы показать уже настроенный
    адрес при открытии настроек: раньше он жил только в состоянии экрана и пропадал при
    уходе с него — человек оставался без адреса, который уже вставил себе на сайт. */
export async function getHookSecret(source: InboundSource | "notify"): Promise<string | null> {
  const ws = getState().wsId;
  if (!ws) return null;
  const { data, error } = await supa.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", source).maybeSingle();
  if (error || !data?.secret) return null;
  return String(data.secret);
}

export async function ensureHookSecret(source: InboundSource | "notify"): Promise<string | null> {
  const ws = getState().wsId;
  if (!ws) return null;
  // Сорвавшийся запрос НЕ повод выписывать новый секрет: старый продолжает работать в
  // Telegram и в опубликованной на сайте форме, а перевыпуск ломает их обоих молча.
  const { data, error: readErr } = await supa.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", source).maybeSingle();
  if (readErr) {
    toast.error("Не удалось прочитать настройки приёмника", {
      description: "Ничего не меняю, чтобы не сломать работающий вебхук. Если вы не владелец пространства — настройка каналов доступна только ему.",
    });
    return null;
  }
  if (data?.secret) return String(data.secret);
  const secret = rnd();
  const { error } = await supa.from("channel_hooks").upsert({ workspace_id: ws, source, secret });
  if (error) {
    toast.error("Не удалось создать приёмник", {
      description: /policy|permission|denied/i.test(error.message) ? "Каналы настраивает владелец пространства" : error.message.slice(0, 90),
    });
    return null;
  }
  return secret;
}

// Telegram: перевести бота с опроса из браузера на серверный вебхук
export async function tgUseServer(token: string): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) { toast.error("Сначала войдите в общее пространство", { description: "Серверный приём работает для пространства команды" }); return false; }
  const secret = await ensureHookSecret("tg");
  if (!secret) return false;
  await supa.from("channel_hooks").update({ bot_token: token }).eq("workspace_id", ws).eq("source", "tg");
  const url = hookUrl(ws, "tg", secret);
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret, drop_pending_updates: false, allowed_updates: ["message", "edited_message"] }),
  }).then(r => r.json()).catch(() => null);
  if (!res?.ok) { toast.error("Telegram не принял вебхук: " + String(res?.description ?? "нет связи").slice(0, 100)); return false; }
  A.intPatch(i => { i.tg.mode = "hook"; });
  toast.success("Telegram переведён на сервер", { description: "Заявки приходят даже при закрытом браузере" });
  return true;
}

// WhatsApp (Green API): вебхук вместо опроса очереди из браузера
export async function waUseServer(): Promise<boolean> {
  const ws = getState().wsId;
  const w = getState().integrations.wa;
  if (!ws) { toast.error("Сначала войдите в общее пространство"); return false; }
  if (!(await serverSupports("wa"))) return false;
  const secret = await ensureHookSecret("wa");
  if (!secret) return false;
  const url = hookUrl(ws, "wa", secret);
  const api = `${w.apiUrl.replace(/\/$/, "")}/waInstance${w.idInstance}/setSettings/${w.apiToken}`;
  const res = await fetch(api, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookUrl: url, incomingWebhook: "yes", outgoingMessageWebhook: "no", stateWebhook: "no" }),
  }).then(r => r.json()).catch(() => null);
  if (!res) { toast.error("Green API не принял вебхук"); return false; }
  A.intPatch(i => { i.wa.mode = "hook"; });
  toast.success("WhatsApp переведён на сервер");
  return true;
}
export async function waUsePolling(): Promise<void> {
  const w = getState().integrations.wa;
  await fetch(`${w.apiUrl.replace(/\/$/, "")}/waInstance${w.idInstance}/setSettings/${w.apiToken}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookUrl: "", incomingWebhook: "no" }),
  }).catch(() => null);
  A.intPatch(i => { i.wa.mode = "poll"; });
  toast("WhatsApp снова читается из браузера");
}

// MAX: подписка на вебхук вместо опроса updates
export async function maxUseServer(token: string): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) { toast.error("Сначала войдите в общее пространство"); return false; }
  if (!(await serverSupports("max"))) return false;
  const secret = await ensureHookSecret("max");
  if (!secret) return false;
  const url = hookUrl(ws, "max", secret);
  const res = await fetch(`https://botapi.max.ru/subscriptions?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
  }).catch(() => null);
  if (!res?.ok) { toast.error("MAX не принял подписку на вебхук"); return false; }
  A.intPatch(i => { i.max.mode = "hook"; });
  toast.success("MAX переведён на сервер");
  return true;
}
export async function maxUsePolling(token: string): Promise<void> {
  const ws = getState().wsId;
  const secret = ws ? await ensureHookSecret("max") : null;
  if (ws && secret) {
    await fetch(`https://botapi.max.ru/subscriptions?access_token=${encodeURIComponent(token)}&url=${encodeURIComponent(hookUrl(ws, "max", secret))}`, { method: "DELETE" }).catch(() => null);
  }
  A.intPatch(i => { i.max.mode = "poll"; });
  toast("MAX снова читается из браузера");
}

// ---------- уведомления о заявках в Telegram ----------
// Метка в ссылке — СЕКРЕТ (строка channel_hooks с source «notify», читает только владелец),
// а не первые символы id пространства: id лежит в адресе приёмника на сайте и у каждого
// бывшего сотрудника — по нему любой мог подписаться на все заявки. Секрет перевыпускается.
export const notifyLink = (botName: string, secret: string) => `https://t.me/${botName.replace(/^@/, "")}?start=notify_${secret}`;
export async function ensureNotifySecret(): Promise<string | null> { return ensureHookSecret("notify"); }
export async function rotateNotifySecret(): Promise<string | null> {
  const ws = getState().wsId;
  if (!ws) return null;
  const secret = rnd().slice(0, 24);
  const { error } = await supa.from("channel_hooks").upsert({ workspace_id: ws, source: "notify", secret });
  if (error) return null;
  return secret;
}
export async function notifyTargets(): Promise<{ chat_id: string; name: string | null }[]> {
  const ws = getState().wsId;
  if (!ws) return [];
  const { data } = await supa.from("notify_targets").select("chat_id, name").eq("workspace_id", ws);
  return (data ?? []) as { chat_id: string; name: string | null }[];
}
export async function notifyRemove(chatId: string): Promise<void> {
  const ws = getState().wsId;
  if (!ws) return;
  await supa.from("notify_targets").delete().eq("workspace_id", ws).eq("chat_id", chatId);
}

export async function tgUsePolling(token: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`).catch(() => null);
  A.intPatch(i => { i.tg.mode = "poll"; });
  toast("Telegram снова читается из браузера", { description: "Работает, только пока открыта вкладка" });
}

// ---------- Instagram: серверный приёмник ----------
// Токенов в браузере нет: приёмник живёт в облаке и принимает сообщения от Meta (после
// обновления функции) и от любого сервиса-пересыльщика уже сейчас — POST JSON {name, phone, text}.
export async function igEnsureReceiver(): Promise<{ url: string; secret: string } | null> {
  const ws = getState().wsId;
  if (!ws) { toast.error("Сначала войдите в общее пространство", { description: "Instagram принимает сервер — нужен аккаунт" }); return null; }
  const secret = await ensureHookSecret("ig");
  if (!secret) return null;
  A.intPatch(i => { i.ig.status = "ok"; i.ig.error = undefined; });
  return { url: hookUrl(ws, "ig", secret), secret };
}
/** Прочитать уже созданный приёмник Instagram, не создавая новый (для показа при открытии настроек) */
export async function igReceiver(): Promise<{ url: string; secret: string } | null> {
  const ws = getState().wsId;
  if (!ws) return null;
  const secret = await getHookSecret("ig");
  if (!secret) return null;
  A.intPatch(i => { if (i.ig.status !== "ok") { i.ig.status = "ok"; i.ig.error = undefined; } });
  return { url: hookUrl(ws, "ig", secret), secret };
}
/** Выключить приёмник Instagram: адрес перестаёт принимать совсем */
export async function igDisableReceiver(): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) return false;
  const { error } = await supa.from("channel_hooks").delete().eq("workspace_id", ws).eq("source", "ig");
  if (error) { toast.error("Не удалось выключить приёмник", { description: error.message.slice(0, 90) }); return false; }
  A.intPatch(i => { i.ig = { status: "off" }; });
  toast("Приёмник Instagram выключен", { description: "Старый адрес больше не принимает" });
  return true;
}

// ---------- ответы через сервер: Instagram (Meta), ВКонтакте, Авито ----------
// Токены этих сервисов живут только в базе (channel_hooks, читает владелец и функция).
// Браузер шлёт «кому и что» с JWT пользователя — функция проверяет, что он участник пространства.
export type ServerSendSrc = "ig" | "vk" | "avito";
export async function serverSend(src: ServerSendSrc, to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const ws = getState().wsId;
  if (!ws) return { ok: false, error: "ответы через сервер работают в общем пространстве" };
  const jwt = (await supa.auth.getSession()).data.session?.access_token;
  if (!jwt) return { ok: false, error: "сессия истекла — войдите заново" };
  try {
    const r = await fetch(`${SUPA_URL}/functions/v1/hook?ws=${ws}&src=${src}&action=send`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + jwt },
      body: JSON.stringify({ to, text }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.ok) return { ok: false, error: String(d?.error ?? `HTTP ${r.status}`).slice(0, 140) };
    return { ok: true };
  } catch (e) { return { ok: false, error: "нет связи с сервером: " + String((e as Error).message ?? e).slice(0, 80) }; }
}

// Токен страницы Meta для ответов в Instagram — сохраняется в базе, в браузере не остаётся
export async function igSetPageToken(token: string): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) return false;
  const secret = await ensureHookSecret("ig");
  if (!secret) return false;
  const t = token.trim();
  const { error } = await supa.from("channel_hooks").update({ bot_token: t || null }).eq("workspace_id", ws).eq("source", "ig");
  if (error) { toast.error("Не удалось сохранить токен", { description: error.message.slice(0, 90) }); return false; }
  A.intPatch(i => { i.ig.status = "ok"; i.ig.error = undefined; i.ig.canSend = !!t; });
  toast.success(t ? "Ответы в Instagram включены" : "Токен страницы удалён — снова только приём");
  return true;
}
/** Есть ли у приёмника Instagram токен страницы (для показа «ответы включены» при открытии) */
export async function igHasPageToken(): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) return false;
  const { data } = await supa.from("channel_hooks").select("bot_token").eq("workspace_id", ws).eq("source", "ig").maybeSingle();
  const has = !!data?.bot_token;
  A.intPatch(i => { if (i.ig.canSend !== has) i.ig.canSend = has; });
  return has;
}

// ВКонтакте: Callback API сообщества. Адрес сервера — наш приёмник; строку подтверждения
// функция отдаёт на проверочный запрос VK; токен сообщества нужен для ответов и имён.
export async function vkReceiver(): Promise<{ url: string; secret: string } | null> {
  const ws = getState().wsId;
  if (!ws) return null;
  const secret = await getHookSecret("vk");
  if (!secret) return null;
  A.intPatch(i => { if (i.vk.status !== "ok") { i.vk.status = "ok"; i.vk.error = undefined; } });
  return { url: hookUrl(ws, "vk", secret), secret };
}
export async function vkSetup(token: string, confirm: string): Promise<{ url: string } | null> {
  const ws = getState().wsId;
  if (!ws) { toast.error("Сначала войдите в общее пространство", { description: "ВКонтакте принимает сервер — нужен аккаунт" }); return null; }
  if (!(await serverSupports("vk"))) return null;
  const secret = await ensureHookSecret("vk");
  if (!secret) return null;
  const t = token.trim(), c = confirm.trim();
  // пустой токен при обновлении = «оставить прежний»: человек мог поменять только строку подтверждения
  const patch: { meta: { confirm: string }; bot_token?: string } = { meta: { confirm: c } };
  if (t) patch.bot_token = t;
  const { error } = await supa.from("channel_hooks").update(patch).eq("workspace_id", ws).eq("source", "vk");
  if (error) { toast.error("Не удалось сохранить настройки ВКонтакте", { description: error.message.slice(0, 90) }); return null; }
  A.intPatch(i => { i.vk = { status: "ok" }; });
  toast.success("Приёмник ВКонтакте готов", { description: "Вставьте адрес в Callback API сообщества и нажмите «Подтвердить»" });
  return { url: hookUrl(ws, "vk", secret) };
}
export async function vkDisable(): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) return false;
  const { error } = await supa.from("channel_hooks").delete().eq("workspace_id", ws).eq("source", "vk");
  if (error) { toast.error("Не удалось выключить приёмник", { description: error.message.slice(0, 90) }); return false; }
  A.intPatch(i => { i.vk = { status: "off" }; });
  toast("Приёмник ВКонтакте выключен", { description: "Старый адрес больше не принимает" });
  return true;
}

// Авито: client_id/client_secret приложения → функция сама получает токен, узнаёт id аккаунта
// и регистрирует вебхук мессенджера на наш приёмник. Секрет приложения в браузере не хранится.
export async function avitoSetup(clientId: string, clientSecret: string): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) { toast.error("Сначала войдите в общее пространство", { description: "Авито принимает сервер — нужен аккаунт" }); return false; }
  if (!(await serverSupports("avito"))) return false;
  const secret = await ensureHookSecret("avito");
  if (!secret) return false;
  const jwt = (await supa.auth.getSession()).data.session?.access_token;
  if (!jwt) { toast.error("Сессия истекла — войдите заново"); return false; }
  A.intPatch(i => { i.avito = { status: "connecting" }; });
  try {
    const r = await fetch(`${SUPA_URL}/functions/v1/hook?ws=${ws}&src=avito&action=setup`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + jwt },
      body: JSON.stringify({ client_id: clientId.trim(), client_secret: clientSecret.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.ok) throw new Error(String(d?.error ?? `HTTP ${r.status}`));
    A.intPatch(i => { i.avito = { status: "ok", userId: String(d.user_id ?? "") }; });
    toast.success("Авито подключён", { description: "Сообщения из объявлений приходят на сервер — даже при закрытом браузере" });
    return true;
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 140);
    A.intPatch(i => { i.avito = { status: "error", error: msg }; });
    toast.error("Авито: " + msg);
    return false;
  }
}
export async function avitoReceiver(): Promise<{ userId: string } | null> {
  const ws = getState().wsId;
  if (!ws) return null;
  const { data } = await supa.from("channel_hooks").select("meta").eq("workspace_id", ws).eq("source", "avito").maybeSingle();
  const userId = (data?.meta as { user_id?: string } | null)?.user_id;
  if (!userId) return null;
  A.intPatch(i => { if (i.avito.status !== "ok") i.avito = { status: "ok", userId: String(userId) }; });
  return { userId: String(userId) };
}
export async function avitoDisable(): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) return false;
  const { error } = await supa.from("channel_hooks").delete().eq("workspace_id", ws).eq("source", "avito");
  if (error) { toast.error("Не удалось отключить Авито", { description: error.message.slice(0, 90) }); return false; }
  A.intPatch(i => { i.avito = { status: "off" }; });
  toast("Авито отключён", { description: "Вебхук в Авито можно удалить в кабинете разработчика" });
  return true;
}

// ---------- утренний дайджест задач в Telegram ----------
// Сервер шлёт его в 08:00 по Москве всем, кто подписан на уведомления. Выключатель — строка
// channel_hooks «digest» со значением off; нет строки = включён.
export async function digestEnabled(): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) return false;
  const { data } = await supa.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", "digest").maybeSingle();
  return data?.secret !== "off";
}
export async function digestSet(on: boolean): Promise<boolean> {
  const ws = getState().wsId;
  if (!ws) return false;
  // «включён» — случайная строка, а не слово on: строка channel_hooks по дизайну проверяется как ключ приёмника
  const { error } = await supa.from("channel_hooks").upsert({ workspace_id: ws, source: "digest", secret: on ? rnd().slice(0, 16) : "off" });
  if (error) {
    toast.error("Не удалось переключить дайджест", { description: /policy|permission|denied/i.test(error.message) ? "Это может только владелец пространства" : error.message.slice(0, 90) });
    return false;
  }
  toast.success(on ? "Утренний дайджест включён" : "Утренний дайджест выключен", { description: on ? "Каждый день в 08:00 по Москве — задачи на сегодня и просроченные, по людям" : undefined });
  return true;
}

// ---------- «Проверить связь»: честная диагностика канала одним нажатием ----------
// Отвечает на главный вопрос «работает или нет — и почему нет», без чтения документации.
export async function channelCheck(src: "tg" | "wa" | "max"): Promise<{ ok: boolean; note: string }> {
  const s = getState();
  const i = s.integrations;
  const waApi = (m: string) => `${i.wa.apiUrl.replace(/\/$/, "")}/waInstance${i.wa.idInstance}/${m}/${i.wa.apiToken}`;
  try {
    if (src === "tg") {
      const me = await fetch(`https://api.telegram.org/bot${i.tg.token}/getMe`).then(r => r.json());
      if (!me?.ok) return { ok: false, note: "токен не работает: " + String(me?.description ?? "нет ответа").slice(0, 80) };
      if (i.tg.mode === "hook") {
        const wi = await fetch(`https://api.telegram.org/bot${i.tg.token}/getWebhookInfo`).then(r => r.json());
        const info = wi?.result ?? {};
        if (!info.url) return { ok: false, note: "приём на сервере включён, но вебхука в Telegram нет — выключите и включите тумблер" };
        if (info.last_error_message) return { ok: false, note: `Telegram: ${String(info.last_error_message).slice(0, 90)} · в очереди ${info.pending_update_count ?? 0}` };
        return { ok: true, note: "бот на связи, сервер принимает" + (info.pending_update_count ? ` · в очереди ${info.pending_update_count}` : "") };
      }
      return { ok: true, note: "бот на связи; приём из этой вкладки — браузер должен быть открыт" };
    }
    if (src === "wa") {
      const st = await fetch(waApi("getStateInstance")).then(r => r.json());
      if (st?.stateInstance !== "authorized") return { ok: false, note: `инстанс «${st?.stateInstance ?? "нет ответа"}» — отсканируйте QR в кабинете Green API` };
      if (i.wa.mode === "hook") {
        const secret = s.wsId ? await getHookSecret("wa") : null;
        const want = s.wsId && secret ? hookUrl(s.wsId, "wa", secret) : "";
        const set = await fetch(waApi("getSettings")).then(r => r.json());
        if (want && set?.webhookUrl !== want) return { ok: false, note: "вебхук Green API смотрит не на наш сервер — выключите и включите тумблер" };
        if (set?.incomingWebhook !== "yes") return { ok: false, note: "в Green API выключены входящие вебхуки — выключите и включите тумблер" };
        return { ok: true, note: "номер авторизован, сервер принимает" };
      }
      return { ok: true, note: "номер авторизован; приём из этой вкладки — браузер должен быть открыт" };
    }
    const me = await fetch(`https://botapi.max.ru/me?access_token=${encodeURIComponent(i.max.token)}`);
    if (!me.ok) return { ok: false, note: `токен не работает (HTTP ${me.status}) — проверьте у @MasterBot` };
    if (i.max.mode === "hook") {
      const secret = s.wsId ? await getHookSecret("max") : null;
      const want = s.wsId && secret ? hookUrl(s.wsId, "max", secret) : "";
      const subs = await fetch(`https://botapi.max.ru/subscriptions?access_token=${encodeURIComponent(i.max.token)}`).then(r => r.json()).catch(() => null);
      const list: { url?: string }[] = subs?.subscriptions ?? [];
      if (want && !list.some(x => x.url === want)) return { ok: false, note: "в MAX нет подписки на наш сервер — выключите и включите тумблер" };
      return { ok: true, note: "бот на связи, сервер подписан" };
    }
    return { ok: true, note: "бот на связи; приём из этой вкладки — браузер должен быть открыт" };
  } catch (e) {
    return { ok: false, note: "сеть или сервис недоступны: " + String((e as Error).message ?? e).slice(0, 80) };
  }
}

// Автовключение серверного приёма сразу после подключения канала в облаке: минимум усилий —
// заявки должны идти и при закрытом браузере. Видно (тост от *UseServer) и переключаемо (тумблер).
export async function autoServerIntake(src: "tg" | "wa" | "max"): Promise<void> {
  const s = getState();
  if (s.mode !== "cloud") return;
  if (s.users.find(u => u.id === s.currentUserId)?.role !== "Владелец") return; // каналы настраивает владелец
  if (s.integrations[src].mode) return; // человек уже выбирал режим — не переигрываем его выбор
  if (!(await serverSupports(src))) return;
  if (src === "tg") await tgUseServer(s.integrations.tg.token);
  else if (src === "wa") await waUseServer();
  else await maxUseServer(s.integrations.max.token);
}

// ---------- разбор журнала входящих ----------
type Row = { id: string; source: string; ext: Record<string, number | string>; name: string | null; phone: string | null; text: string | null; fields: Record<string, string> | null };

function apply(r: Row) {
  if (r.source === "tilda") A.tildaLead(r.fields ?? { text: r.text ?? "" });
  else handleIncoming(r.ext as never, r.name ?? "Клиент", r.source as never, r.text ?? "", r.phone ?? undefined);
}

// при входе в пространство: добираем то, что сервер принял, но не смог разложить
export async function inboundBoot(ws: string): Promise<void> {
  const { data } = await supa.from("inbound").select("*").eq("workspace_id", ws).eq("processed", false).order("ts").limit(200);
  if (!data?.length) return;
  for (const r of data as Row[]) apply(r);
  await supa.from("inbound").update({ processed: true }).in("id", data.map((r: Row) => r.id));
  toast.success(`Разобрано входящих с сервера: ${data.length}`);
}

// Канал живёт до конца сессии. Открыть пространство ВТОРОЙ раз (перенос базы, переход в другое
// пространство) supabase-js не даёт: «cannot add postgres_changes callbacks after subscribe()».
// Раньше это исключение вылетало из openWorkspace и подвешивало вызвавшую кнопку навсегда.
let inboundCh: ReturnType<typeof supa.channel> | null = null;

export function inboundSubscribe(ws: string) {
  if (inboundCh) { try { void supa.removeChannel(inboundCh); } catch { /* канал уже мёртв */ } inboundCh = null; }
  inboundCh = supa.channel("inbound-" + ws)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "inbound", filter: `workspace_id=eq.${ws}` }, payload => {
      const row = payload.new as Row & { processed: boolean };
      if (row.processed) return; // сервер уже создал диалог и заявку — они приедут своим realtime
      apply(row);
      void supa.from("inbound").update({ processed: true }).eq("id", row.id);
    })
    .subscribe();
  return inboundCh;
}

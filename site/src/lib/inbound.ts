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
export async function rotateHookSecret(source: InboundSource): Promise<string | null> {
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

export async function ensureHookSecret(source: InboundSource): Promise<string | null> {
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
// Пространство сервер берёт из проверенного секретом адреса вебхука, а не отсюда:
// раньше по такой ссылке с ЧУЖИМ id можно было подписаться на чужие заявки.
export const notifyLink = (botName: string, ws: string) => `https://t.me/${botName.replace(/^@/, "")}?start=notify_${ws.slice(0, 8)}`;
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

export function inboundSubscribe(ws: string) {
  return supa.channel("inbound-" + ws)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "inbound", filter: `workspace_id=eq.${ws}` }, payload => {
      const row = payload.new as Row & { processed: boolean };
      if (row.processed) return; // сервер уже создал диалог и заявку — они приедут своим realtime
      apply(row);
      void supa.from("inbound").update({ processed: true }).eq("id", row.id);
    })
    .subscribe();
}

// Серверный приём: вебхук Telegram и приёмник форм живут в Supabase Edge Function «hook».
// Браузер перестаёт быть транспортом — сообщения приходят и превращаются в заявки, даже когда вкладка закрыта.
// Открытое приложение получает их мгновенно через realtime; необработанные (сервер споткнулся) доделывает само.
import { supa, SUPA_URL } from "./supa";
import { getState, A, handleIncoming } from "./store";
import { toast } from "sonner";
import type { InboundSource } from "./model";

export const hookUrl = (ws: string, source: InboundSource, secret: string) =>
  `${SUPA_URL}/functions/v1/hook?ws=${ws}&src=${source}&k=${secret}`;

const rnd = () => (crypto.randomUUID?.() ?? String(Math.random())).replace(/-/g, "");

// секрет вебхука пространства: создаётся один раз и живёт в базе (его знает и функция, и владелец канала)
export async function ensureHookSecret(source: InboundSource): Promise<string | null> {
  const ws = getState().wsId;
  if (!ws) return null;
  const { data } = await supa.from("channel_hooks").select("secret").eq("workspace_id", ws).eq("source", source).maybeSingle();
  if (data?.secret) return String(data.secret);
  const secret = rnd();
  const { error } = await supa.from("channel_hooks").upsert({ workspace_id: ws, source, secret });
  if (error) { toast.error("Не удалось создать приёмник: " + error.message.slice(0, 80)); return null; }
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

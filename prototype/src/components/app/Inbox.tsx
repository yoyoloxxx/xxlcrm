// Инбокс: омниканальные диалоги. Демо-чаты — имитация; подключённые Telegram/WhatsApp — настоящие.
import { useEffect, useRef, useState } from "react";
import { A, useApp, channelName, entityById, recById, recTitle } from "@/lib/store";
import { sendChatMessage } from "@/lib/integrations";
import type { Chat } from "@/lib/model";
import { pick, relTime } from "@/lib/model";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./bits";
import { ExternalLink, MessageSquare, Plug, Send, UserPlus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const CH_STYLE: Record<Chat["channel"], { label: string; bg: string; fg: string }> = {
  tg: { label: "TG", bg: "#5C7A9E", fg: "#fff" },
  wa: { label: "WA", bg: "#6E8B4F", fg: "#fff" },
  max: { label: "MAX", bg: "#8B6E86", fg: "#fff" },
};

const SIM_INCOMING = [
  "Здравствуйте! Подскажите, вы ещё работаете сегодня?",
  "Добрый день! Сколько это будет стоить, если заказать до конца недели?",
  "Спасибо, всё получил 👍",
  "А можно счёт на юрлицо?",
  "Я подумаю и вернусь завтра, хорошо?",
];
const SIM_NEW = [
  { name: "Андрей (с сайта)", channel: "tg" as const, text: "Здравствуйте! Оставлял заявку на сайте, никто не перезвонил" },
  { name: "Виктория", channel: "wa" as const, text: "Добрый день! Подруга посоветовала к вам обратиться" },
  { name: "Клиент из MAX", channel: "max" as const, text: "Здравствуйте, есть вопрос по вашим услугам" },
];

export function Inbox() {
  const s = useApp();
  const ws = s.ws!;
  const chat = ws.chats.find(c => c.id === s.activeChatId) ?? ws.chats[0] ?? null;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chat && s.activeChatId !== chat.id) A.openChat(chat.id);
  }, [chat?.id]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9 }); }, [chat?.id, chat?.msgs.length]);

  const simulate = () => {
    if (ws.chats.length && Math.random() > 0.45) {
      const c = pick(ws.chats);
      A.chatIncoming(c.id, pick(SIM_INCOMING));
    } else {
      const n = pick(SIM_NEW);
      A.chatIncoming(null, n.text, { name: n.name, channel: n.channel });
    }
  };

  const linkedRec = chat?.recordId ? recById(chat.recordId) : undefined;
  const linkedEntity = linkedRec ? entityById(linkedRec.entityId) : undefined;
  const ints = ws.integrations;
  const anyReal = ints?.tg.status === "ok" || ints?.wa.status === "ok" || ints?.tilda.status === "ok";

  return (
    <div className="flex h-full">
      <div className="flex w-[290px] shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-3.5 py-2.5">
          <div className="text-[14px] font-semibold">Входящие</div>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11.5px]" onClick={simulate} title="Демо: имитировать входящее сообщение">
            <Zap className="size-3" /> входящее
          </Button>
        </div>
        {!anyReal && (
          <button onClick={() => A.go("settings")}
            className="flex items-start gap-2 border-b px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]"
            style={{ background: "hsl(42 42% 55% / 0.09)" }}>
            <Plug className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--brass-ink)" }} />
            <span className="text-[11.5px] leading-snug">
              <b>Подключите настоящие каналы</b> — Telegram-бот, WhatsApp, заявки Tilda. Настройки → Интеграции
            </span>
          </button>
        )}
        <div className="flex-1 overflow-y-auto">
          {ws.chats.length === 0 && <div className="p-4 text-[12.5px] text-muted-foreground">Диалогов нет. Нажмите «входящее», чтобы имитировать сообщение клиента.</div>}
          {ws.chats.map(c => {
            const last = c.msgs[c.msgs.length - 1];
            const ch = CH_STYLE[c.channel];
            return (
              <button key={c.id} onClick={() => A.openChat(c.id)}
                className={cn("flex w-full items-start gap-2.5 border-b px-3.5 py-2.5 text-left transition-colors", chat?.id === c.id ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.035]")}>
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-bold" style={{ background: ch.bg + "22", color: ch.bg }}>{ch.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("inline-flex min-w-0 items-center gap-1.5 truncate text-[13px]", c.unread ? "font-semibold" : "font-medium")}>
                      <span className="truncate">{c.name}</span>
                      {c.ext && <span title="Настоящий диалог" className="size-1.5 shrink-0 rounded-full" style={{ background: "#6E8B4F" }} />}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">{last ? relTime(last.ts) : ""}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className="truncate text-[12px] text-muted-foreground">{last ? (last.out ? "Вы: " : "") + last.text : ""}</span>
                    {c.unread > 0 && <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[9.5px] font-bold text-white" style={{ background: "hsl(41 46% 45%)" }}>{c.unread}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t px-3.5 py-2 text-[11px] leading-snug text-muted-foreground">
          {anyReal
            ? "Каналы подключены: диалоги с зелёной точкой — настоящие, ответы уходят клиентам. Демо-чаты остаются имитацией."
            : "Пока имитация. Подключите Telegram/WhatsApp/Tilda в Настройках — и здесь появятся настоящие клиенты."}
        </div>
      </div>

      {!chat ? (
        <div className="flex-1"><EmptyState icon={<MessageSquare />} title="Выберите диалог" /></div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">{chat.name}</div>
              <div className="text-[11.5px] text-muted-foreground">{channelName(chat.channel)}{chat.phone ? ` · ${chat.phone}` : ""}</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {linkedRec && linkedEntity ? (
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => { A.go("entity", linkedEntity.id); A.openRecord(linkedRec.id); }}>
                  {linkedEntity.icon} {recTitle(linkedRec.id)} <ExternalLink className="size-3.5" />
                </Button>
              ) : (
                <Button size="sm" className="h-8 gap-1.5" onClick={() => A.chatCreateLead(chat.id)}>
                  <UserPlus className="size-4" /> Создать лида
                </Button>
              )}
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto flex max-w-2xl flex-col gap-2">
              {chat.msgs.map(m => (
                <div key={m.id} className={cn("flex", m.out ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug", m.out ? "rounded-br-md text-primary-foreground" : "rounded-bl-md bg-card border")}
                    style={m.out ? { background: "var(--brass-ink)" } : undefined}>
                    {m.text}
                    <div className={cn("mt-0.5 text-right text-[10px]", m.out ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {new Date(m.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t p-3">
            <div className="mx-auto flex max-w-2xl items-center gap-2">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && draft.trim()) { sendChatMessage(chat.id, draft.trim()); setDraft(""); } }}
                placeholder={chat.ext ? `Ответить клиенту в ${channelName(chat.channel)} (реально)…` : `Ответить в ${channelName(chat.channel)} (демо)…`}
                className="h-10 flex-1 rounded-full border bg-card px-4 text-[13.5px] outline-none focus:border-ring"
              />
              <Button size="sm" className="h-10 w-10 rounded-full p-0" disabled={!draft.trim()}
                onClick={() => { sendChatMessage(chat.id, draft.trim()); setDraft(""); }}>
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

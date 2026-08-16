// Живые Входящие: диалоги TG/WA/MAX (реальные при подключении), шаблоны с подстановкой, связь со сделками
import { useEffect, useRef, useState } from "react";
import type { Chat } from "@/lib/model";
import { relTime, channelName } from "@/lib/model";
import { useApp, A, recById, recTitle } from "@/lib/store";
import { sendChatMessage } from "@/lib/integrations";
import { fillTemplate } from "@/lib/fill";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, MessageSquare, Plug, Send, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

const CH: Record<Chat["channel"], { label: string; c: string }> = {
  tg: { label: "TG", c: "#5C7A9E" }, wa: { label: "WA", c: "#6E8B4F" },
  max: { label: "MAX", c: "#8B6E86" }, ig: { label: "IG", c: "#A8547C" },
};

export function InboxLive({ goSettings }: { goSettings: () => void }) {
  const s = useApp();
  const chat = s.chats.find(c => c.id === s.activeChatId) ?? s.chats[0] ?? null;
  // Черновик — свой у каждого диалога: при переключении текст не «переезжает» к другому клиенту
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = chat ? (drafts[chat.id] ?? "") : "";
  const setDraft = (v: string) => { const id = chat?.id; if (id) setDrafts(d => ({ ...d, [id]: v })); };
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (chat && s.activeChatId !== chat.id) A.openChat(chat.id); }, [chat?.id]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9 }); }, [chat?.id, chat?.msgs.length]);

  const ints = s.integrations;
  const anyReal = ints.tg.status === "ok" || ints.wa.status === "ok" || ints.max.status === "ok" || ints.tilda.status === "ok";
  const linked = chat?.recordId ? recById(chat.recordId) : undefined;

  const send = () => {
    if (!chat || !draft.trim()) return;
    sendChatMessage(chat.id, draft.trim());
    setDraft("");
  };

  return (
    <div className="flex h-full">
      <div className="flex w-[290px] shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-3.5 py-2.5">
          <span className="text-[13.5px] font-semibold">Входящие</span>
          <button onClick={goSettings} className="press inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11.5px] text-muted-foreground hover:border-foreground/25 hover:text-foreground">
            <Plug className="size-3" /> каналы
          </button>
        </div>
        {!anyReal && (
          <button onClick={goSettings} className="flex items-start gap-2 border-b px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]" style={{ background: "hsl(var(--brass) / 0.09)" }}>
            <Plug className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--brass-ink)" }} />
            <span className="text-[11.5px] leading-snug"><b>Подключите настоящие каналы</b>: Telegram-бот, WhatsApp, MAX, Tilda — Настройки → Интеграции</span>
          </button>
        )}
        <div className="flex-1 divide-y overflow-y-auto">
          {s.chats.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
              <MessageSquare className="mx-auto mb-2 size-5 opacity-50" />
              Диалогов пока нет. Подключите Telegram-бот в настройках и напишите ему с телефона — диалог появится здесь.
            </div>
          )}
          {s.chats.map(c => {
            const last = c.msgs[c.msgs.length - 1];
            const ch = CH[c.channel];
            return (
              <button key={c.id} onClick={() => A.openChat(c.id)}
                className={cn("press flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-150", chat?.id === c.id ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.035]")}>
                <span className="font-mono2 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[9px] font-medium" style={{ background: ch.c + "20", color: ch.c }}>{ch.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[12.5px]", c.unread ? "font-semibold" : "font-medium")}>
                      <span className="truncate">{c.name}</span>
                      {c.ext && <span title="Настоящий диалог" className="size-1.5 shrink-0 rounded-full" style={{ background: "#6E8B4F" }} />}
                    </span>
                    <span className="font-mono2 shrink-0 text-[10px] text-muted-foreground">{last ? relTime(last.ts) : ""}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className="truncate text-[11.5px] text-muted-foreground">{last ? (last.out ? "Вы: " : "") + last.text : ""}</span>
                    {c.unread > 0 && <span className="font-mono2 ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[9px] font-semibold text-primary-foreground" style={{ background: "hsl(var(--primary))" }}>{c.unread}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t px-3.5 py-2 text-[10.5px] leading-snug text-muted-foreground">
          {anyReal ? "Диалоги с зелёной точкой — настоящие: ответы уходят клиентам." : "Демо-диалоги. Реальные появятся после подключения каналов."}
        </div>
      </div>

      {!chat ? (
        <div className="grid flex-1 place-items-center text-[13px] text-muted-foreground">Выберите диалог</div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold">{chat.name}</div>
              <div className="font-mono2 text-[10.5px] text-muted-foreground">
                {channelName(chat.channel)}{chat.phone ? ` · ${chat.phone}` : ""}{chat.ext ? " · настоящий" : " · демо"}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {linked ? (
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={() => A.openRecord(linked.id)}>
                  {recTitle(linked.id)} <ArrowUpRight className="size-3.5" />
                </Button>
              ) : (
                <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={() => A.chatCreateLead(chat.id)}>
                  <UserPlus className="size-3.5" /> Создать сделку
                </Button>
              )}
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
            <div className="mx-auto flex max-w-xl flex-col gap-2">
              {chat.msgs.map(m => (
                <div key={m.id} className={cn("flex", m.out ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[80%] rounded-xl px-3.5 py-2 text-[13px] leading-snug", m.out ? "rounded-br-[4px] text-primary-foreground" : "rounded-bl-[4px] border bg-card")}
                    style={m.out ? { background: "hsl(var(--primary))" } : undefined}>
                    {m.text}
                    <span className={cn("font-mono2 mt-0.5 block text-right text-[9.5px]", m.out ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {new Date(m.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t p-3">
            <div className="mx-auto max-w-xl">
              <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="eyebrow shrink-0">Шаблоны</span>
                {s.replyTemplates.map(t => (
                  <button key={t.id} title={fillTemplate(t.text, chat)}
                    onClick={() => setDraft(fillTemplate(t.text, chat))}
                    className="press h-6 shrink-0 rounded-full border px-2 text-[11px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
                    {t.name}
                  </button>
                ))}
                <button onClick={goSettings} title="Управление шаблонами — в настройках"
                  className="press h-6 w-6 shrink-0 rounded-full border text-[12px] text-muted-foreground hover:border-foreground/25 hover:text-foreground">+</button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && send()}
                  placeholder={chat.ext ? `Ответить клиенту в ${channelName(chat.channel)} — уйдёт по-настоящему…` : `Ответить (демо-диалог)…`}
                  className="h-10 flex-1 rounded-full border bg-card px-4 text-[13px] outline-none focus:border-ring"
                />
                <Button size="sm" className="h-10 w-10 rounded-full p-0" disabled={!draft.trim()} onClick={send}>
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

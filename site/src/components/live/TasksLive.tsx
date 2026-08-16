// Живые Задачи: группировка по срокам, чекбоксы, быстрая задача, дни рождения с «поздравить по шаблону»
import { useState } from "react";
import type { Task } from "@/lib/model";
import { DAY, fmtDate } from "@/lib/model";
import { useApp, A, recById, recTitle, getState } from "@/lib/store";
import { upcomingBirthdays, inDaysLabel, chatForRecord } from "@/lib/bday";
import { fillTemplate } from "@/lib/fill";
import { UserChip } from "./bits";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Cake, CalendarClock, ListChecks, MessageSquare, Phone, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<Task["kind"], React.ElementType> = { call: Phone, meet: CalendarClock, todo: ListChecks, msg: MessageSquare };

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function dueLabel(t: Task): { text: string; danger: boolean } {
  const sod = startOfToday();
  if (t.due < sod) return { text: "просрочено · " + fmtDate(t.due), danger: true };
  if (t.due < sod + DAY) return { text: new Date(t.due).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), danger: false };
  if (t.due < sod + 2 * DAY) return { text: "завтра, " + new Date(t.due).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), danger: false };
  return { text: fmtDate(t.due), danger: false };
}

export function congratulate(recId: string, goInbox: () => void) {
  const chatId = chatForRecord(recById(recId)!);
  if (!chatId) { toast("Диалога с клиентом пока нет", { description: "Напишите ему в мессенджере — или подключите канал, и диалог появится во «Входящих»" }); return; }
  const st = getState();
  const chat = st.chats.find(c => c.id === chatId)!;
  const tpl = st.replyTemplates.find(t => /рожден/i.test(t.name) || /рожден/i.test(t.text));
  const text = tpl ? fillTemplate(tpl.text, chat) : `${recTitle(recId).split(/\s+/)[0]}, поздравляем вас с днём рождения!`;
  A.openChatWithDraft(chatId, text);
  goInbox();
}

function TaskRow({ t, goInbox }: { t: Task; goInbox: () => void }) {
  const due = dueLabel(t);
  const Icon = KIND_ICON[t.kind] ?? ListChecks;
  const isBday = t.id.startsWith("t_bday_");
  return (
    <div className={cn("group flex items-center gap-3 px-3.5 py-2.5", t.done && "opacity-55")}>
      <button
        onClick={() => A.toggleTask(t.id)}
        title={t.done ? "Вернуть в работу" : "Выполнить"}
        className={cn("press grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors", t.done && "border-transparent")}
        style={t.done ? { background: "hsl(var(--brass) / 0.35)" } : undefined}>
        {t.done && <span className="text-[11px] leading-none" style={{ color: "var(--brass-ink)" }}>✓</span>}
      </button>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13.5px] leading-snug", t.done && "line-through")}>{t.title}</div>
        {t.recordId && recById(t.recordId) && (
          <button className="mt-0.5 block max-w-full truncate text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => A.openRecord(t.recordId!)}>
            {recTitle(t.recordId)}
          </button>
        )}
      </div>
      {isBday && !t.done && t.recordId && (
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11.5px]" onClick={() => congratulate(t.recordId!, goInbox)}>
          <Cake className="size-3" style={{ color: "var(--brass-ink)" }} /> Поздравить
        </Button>
      )}
      <span className={cn("font-mono2 tnum shrink-0 text-[11.5px]", due.danger && !t.done ? "font-medium text-destructive" : "text-muted-foreground")}>{due.text}</span>
      <UserChip id={t.ownerId} />
      <button className="press shrink-0 rounded p-1 text-muted-foreground/0 transition-colors hover:text-destructive group-hover:text-muted-foreground"
        title="Удалить задачу" onClick={() => A.taskDelete(t.id)}>
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function AddTaskRow() {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Task["kind"]>("todo");
  const [when, setWhen] = useState<"today" | "tomorrow" | "week">("today");
  const add = () => {
    if (!title.trim()) return;
    const d = new Date();
    if (when === "today") d.setHours(Math.min(d.getHours() + 3, 19), 0, 0, 0);
    else if (when === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); }
    else { d.setDate(d.getDate() + 7); d.setHours(11, 0, 0, 0); }
    A.taskAddAt(null, title.trim(), kind, d.getTime());
    setTitle("");
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
      <Plus className="size-4 shrink-0 text-muted-foreground" />
      <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
        placeholder="Новая задача…" className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2.5 text-[13px] outline-none focus:border-ring" />
      <Select value={kind} onValueChange={v => setKind(v as Task["kind"])}>
        <SelectTrigger className="h-8 w-[118px] text-[12px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="todo">Сделать</SelectItem>
          <SelectItem value="call">Звонок</SelectItem>
          <SelectItem value="meet">Встреча</SelectItem>
          <SelectItem value="msg">Написать</SelectItem>
        </SelectContent>
      </Select>
      <Select value={when} onValueChange={v => setWhen(v as "today")}>
        <SelectTrigger className="h-8 w-[108px] text-[12px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="today">Сегодня</SelectItem>
          <SelectItem value="tomorrow">Завтра</SelectItem>
          <SelectItem value="week">Через неделю</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" className="h-8" onClick={add} disabled={!title.trim()}>Добавить</Button>
    </div>
  );
}

export function TasksLive({ goInbox }: { goInbox: () => void }) {
  const s = useApp();
  const [onlyMine, setOnlyMine] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // стор мутирует массивы на месте — useMemo по ссылкам тут коварен, считаем на каждый рендер (объёмы крошечные)
  const sod0 = startOfToday();
  const open = s.tasks.filter(t => !t.done && (!onlyMine || t.ownerId === s.currentUserId)).sort((a, b) => a.due - b.due);
  const groups = {
    overdue: open.filter(t => t.due < sod0),
    today: open.filter(t => t.due >= sod0 && t.due < sod0 + DAY),
    soon: open.filter(t => t.due >= sod0 + DAY && t.due < sod0 + 8 * DAY),
    later: open.filter(t => t.due >= sod0 + 8 * DAY),
    done: s.tasks.filter(t => t.done && (!onlyMine || t.ownerId === s.currentUserId)).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 12),
  };

  const bdays = upcomingBirthdays(30);
  const Section = ({ title, items }: { title: string; items: Task[] }) =>
    items.length === 0 ? null : (
      <div className="mt-5">
        <div className="eyebrow">{title} · {items.length}</div>
        <div className="mt-2 divide-y rounded-lg border bg-card">{items.map(t => <TaskRow key={t.id} t={t} goInbox={goInbox} />)}</div>
      </div>
    );

  return (
    <div className="cascade mx-auto max-w-3xl px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Задачи</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">задачи команды и напоминания · дни рождения создают задачи сами</p>
        </div>
        <button onClick={() => setOnlyMine(m => !m)}
          className={cn("press inline-flex h-8 items-center rounded-md border px-2.5 text-[12.5px] transition-colors duration-150",
            onlyMine ? "border-transparent font-medium" : "text-muted-foreground hover:border-foreground/25 hover:text-foreground")}
          style={onlyMine ? { background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" } : undefined}>
          Мои
        </button>
      </div>

      {groups.overdue.length + groups.today.length + groups.soon.length + groups.later.length === 0 && (
        <div className="mt-5 rounded-lg border border-dashed p-6 text-center text-[13px] text-muted-foreground">
          Открытых задач нет — чистый стол. Новая задача — в форме ниже.
        </div>
      )}
      <Section title="Просроченные" items={groups.overdue} />
      <Section title="Сегодня" items={groups.today} />
      <Section title="Ближайшая неделя" items={groups.soon} />
      <Section title="Позже" items={groups.later} />
      <AddTaskRow />

      {bdays.length > 0 && (
        <div className="mt-6">
          <div className="flex items-baseline gap-2">
            <div className="eyebrow">Дни рождения</div>
            <span className="text-[11px] text-muted-foreground">— из карточек клиентов и заявок Tilda; напоминание придёт сюда в 10:00</span>
          </div>
          <div className="mt-2 divide-y rounded-lg border bg-card">
            {bdays.map(b => (
              <div key={b.rec.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: "hsl(var(--brass) / 0.16)" }}>
                  <Cake className="size-3.5" style={{ color: "var(--brass-ink)" }} />
                </span>
                <div className="min-w-0 flex-1">
                  <button className="block max-w-full truncate text-[13.5px] leading-snug hover:underline" onClick={() => A.openRecord(b.rec.id)}>{recTitle(b.rec.id)}</button>
                  <div className="font-mono2 mt-0.5 text-[10.5px] text-muted-foreground">
                    {b.dateLabel} · {inDaysLabel(b.inDays)}{b.turns ? ` · исполнится ${b.turns}` : ""}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11.5px]" onClick={() => congratulate(b.rec.id, goInbox)}>
                  <MessageSquare className="size-3" /> Поздравить по шаблону
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {groups.done.length > 0 && (
        <div className="mt-6">
          <button className="eyebrow hover:text-foreground" onClick={() => setShowDone(d => !d)}>
            {showDone ? "▾" : "▸"} Выполненные · {groups.done.length}
          </button>
          {showDone && <div className="mt-2 divide-y rounded-lg border bg-card/60">{groups.done.map(t => <TaskRow key={t.id} t={t} goInbox={goInbox} />)}</div>}
        </div>
      )}

      <p className="mt-4 text-[11.5px] leading-snug text-muted-foreground">
        Принцип: у каждой активной записи есть следующая задача. Задачи, созданные из карточки, видны и здесь, и в хронологии записи.
      </p>
    </div>
  );
}

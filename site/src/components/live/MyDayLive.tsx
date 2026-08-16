// Живой «Мой день»: приветствие, реальные цифры, задачи на сегодня, записи без следующего шага, дни рождения
import type { Task } from "@/lib/model";
import { DAY } from "@/lib/model";
import { useApp, A, recById, recTitle, entityCfg, userName } from "@/lib/store";
import { upcomingBirthdays, inDaysLabel } from "@/lib/bday";
import { congratulate } from "./TasksLive";
import { Button } from "@/components/ui/button";
import { Cake, CalendarClock, ListChecks, MessageSquare, Phone, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<Task["kind"], React.ElementType> = { call: Phone, meet: CalendarClock, todo: ListChecks, msg: MessageSquare };
const StagePillLike = ({ label, color }: { label: string; color: string }) => (
  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-px text-[11px] font-medium" style={{ background: color + "18", borderColor: color + "50" }}>
    <span className="size-1.5 rounded-full" style={{ background: color }} />{label}
  </span>
);
const sod = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function MyDayLive({ goTasks, goInbox }: { goTasks: () => void; goInbox: () => void }) {
  const s = useApp();
  const start = sod();

  // без useMemo: стор мутирует массивы на месте, кэш по ссылкам не заметит изменений
  const openTasks = s.tasks.filter(t => !t.done);
  const withOpenTask = new Set(openTasks.map(t => t.recordId).filter(Boolean));
  const data = {
    openTasks,
    todayTasks: openTasks.filter(t => t.due < start + DAY).sort((a, b) => a.due - b.due),
    doneToday: s.tasks.filter(t => t.done && (t.doneAt ?? 0) >= start).length,
    noNext: s.records.filter(r => {
      if (withOpenTask.has(r.id)) return false;
      const e = s.entities.find(x => x.id === r.entityId);
      const stg = e?.stages?.find(x => x.id === r.stageId);
      return !!stg && stg.kind === "open";
    }).slice(0, 5),
    unread: s.chats.reduce((n, c) => n + c.unread, 0),
  };

  const hour = new Date().getHours();
  const hello = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const me = s.mode === "cloud" ? (userName(s.currentUserId).split(/\s+/)[0] || "коллега") : "Глеб";
  const dateStr = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const bdays = upcomingBirthdays(7);

  return (
    <div className="cascade mx-auto max-w-3xl px-5 py-6">
      <div>
        <h1 className="text-[21px] font-semibold tracking-tight">{hello}, {me}</h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {dateStr} — {data.todayTasks.length ? `задач на сегодня: ${data.todayTasks.length}` : "на сегодня задач нет"}{data.noNext.length ? `, без следующего шага: ${data.noNext.length}` : ""}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["Открытых задач", data.openTasks.length, goTasks],
          ["Выполнено сегодня", data.doneToday, goTasks],
          ["Без следующего шага", data.noNext.length, null],
          ["Непрочитанных диалогов", data.unread, goInbox],
        ] as [string, number, (() => void) | null][]).map(([l, v, go]) => (
          <button key={l} onClick={go ?? undefined} disabled={!go}
            className={cn("flex items-baseline gap-2 rounded-full border bg-card px-3 py-1 text-[12px] text-muted-foreground", go && "press transition-colors hover:border-foreground/25 hover:text-foreground")}>
            {l} <b className="font-mono2 tnum text-[12.5px] text-foreground">{v}</b>
          </button>
        ))}
      </div>

      <div className="mt-6">
        <div className="eyebrow">Сегодня и просроченные</div>
        {data.todayTasks.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed bg-card/60 p-5 text-center text-[12.5px] text-muted-foreground">
            Всё чисто. Новые задачи — в разделе «Задачи» или из карточки записи.
          </div>
        ) : (
          <div className="mt-2 divide-y rounded-lg border bg-card">
            {data.todayTasks.map(t => {
              const Icon = KIND_ICON[t.kind] ?? ListChecks;
              const overdue = t.due < start;
              return (
                <div key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <button onClick={() => A.toggleTask(t.id)} title="Выполнить"
                    className="press grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border" />
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] leading-snug">{t.title}</div>
                    {t.recordId && recById(t.recordId) && (
                      <button className="mt-0.5 block max-w-full truncate text-[11.5px] text-muted-foreground hover:underline" onClick={() => A.openRecord(t.recordId!)}>
                        {recTitle(t.recordId)}
                      </button>
                    )}
                  </div>
                  <span className={cn("font-mono2 tnum text-[11.5px]", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {overdue ? "просрочено" : new Date(t.due).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {bdays.length > 0 && (
        <div className="mt-6">
          <div className="eyebrow">Дни рождения на неделе</div>
          <div className="mt-2 divide-y rounded-lg border bg-card">
            {bdays.map(b => (
              <div key={b.rec.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: "hsl(var(--brass) / 0.16)" }}>
                  <Cake className="size-3.5" style={{ color: "var(--brass-ink)" }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px]">{recTitle(b.rec.id)}</div>
                  <div className="font-mono2 mt-0.5 text-[10.5px] text-muted-foreground">{b.dateLabel} · {inDaysLabel(b.inDays)}</div>
                </div>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11.5px]" onClick={() => congratulate(b.rec.id, goInbox)}>
                  <MessageSquare className="size-3" /> Поздравить
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.noNext.length > 0 && (
        <div className="mt-6">
          <div className="flex items-baseline gap-2">
            <div className="eyebrow">Без следующего шага</div>
            <span className="text-[11px] text-muted-foreground">— принцип: у каждой активной записи должна быть задача</span>
          </div>
          <div className="mt-2 divide-y rounded-lg border border-dashed bg-card/60">
            {data.noNext.map(r => {
              const e = entityCfg(r.entityId);
              const stg = e.stages?.find(x => x.id === r.stageId);
              return (
                <div key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <button className="min-w-0 flex-1 truncate text-left text-[13.5px] hover:underline" onClick={() => A.openRecord(r.id)}>{recTitle(r.id)}</button>
                  {stg && <StagePillLike label={stg.label} color={stg.color} />}
                  <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11.5px]"
                    onClick={() => A.addTask(r.id, "Связаться с клиентом", "call", 3)}>
                    <Plus className="size-3" /> задача
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

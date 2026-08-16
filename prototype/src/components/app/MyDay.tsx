// «Мой день»: задачи (просрочено/сегодня/ближайшие) + записи без следующего шага
import { useState } from "react";
import { A, useApp, entityById, recTitle } from "@/lib/store";
import { DAY, plural } from "@/lib/model";
import { DueLabel, EmptyState, SectionLabel, UserChip } from "./bits";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarClock, ListChecks, MessageSquare, Phone, Plus, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_ICON = { call: Phone, meet: CalendarClock, todo: ListChecks, msg: MessageSquare };

export function MyDay() {
  const s = useApp();
  const ws = s.ws!;
  const [mineOnly, setMineOnly] = useState(true);

  const tasks = ws.tasks.filter(t => !t.done && (!mineOnly || t.ownerId === s.currentUserId));
  const nowTs = Date.now();
  const eod = new Date(); eod.setHours(23, 59, 59, 999);
  const overdue = tasks.filter(t => t.due < nowTs && !isTodayTs(t.due)).sort((a, b) => a.due - b.due);
  const today = tasks.filter(t => isTodayTs(t.due)).sort((a, b) => a.due - b.due);
  const soon = tasks.filter(t => t.due > eod.getTime() && t.due < nowTs + 7 * DAY).sort((a, b) => a.due - b.due);

  const noNext = ws.records.filter(r => {
    const e = entityById(r.entityId);
    if (!e?.pipeline) return false;
    const st = e.pipeline.stages.find(x => x.id === r.stageId);
    if (!st || st.kind !== "open") return false;
    if (mineOnly && r.ownerId !== s.currentUserId) return false;
    return !ws.tasks.some(t => t.recordId === r.id && !t.done);
  });

  const doneToday = ws.tasks.filter(t => t.done && t.doneAt && isTodayTs(t.doneAt)).length;
  const hour = new Date().getHours();
  const hello = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const dateStr = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  const TaskRow = ({ id }: { id: string }) => {
    const t = ws.tasks.find(x => x.id === id)!;
    const Ic = KIND_ICON[t.kind];
    const rec = t.recordId ? ws.records.find(r => r.id === t.recordId) : undefined;
    const e = rec ? entityById(rec.entityId) : undefined;
    return (
      <div className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-foreground/20">
        <Checkbox checked={t.done} onCheckedChange={() => A.toggleTask(t.id)} />
        <Ic className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] leading-snug">{t.title}</div>
          {rec && e && (
            <button className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
              onClick={() => { A.go("entity", e.id); A.openRecord(rec.id); }}>
              {e.icon} {recTitle(rec.id)}
            </button>
          )}
        </div>
        <DueLabel due={t.due} done={t.done} />
        <UserChip id={t.ownerId} size={20} />
      </div>
    );
  };

  const Section = ({ title, items, tone }: { title: string; items: typeof tasks; tone?: "danger" }) =>
    items.length === 0 ? null : (
      <section>
        <div className="mb-2 flex items-center gap-2">
          <SectionLabel className={cn("px-0", tone === "danger" && "text-destructive/90")}>{title}</SectionLabel>
          <span className="text-[11.5px] text-muted-foreground tnum">{items.length}</span>
        </div>
        <div className="flex flex-col gap-1.5">{items.map(t => <TaskRow key={t.id} id={t.id} />)}</div>
      </section>
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{hello}, {ws.users.find(u => u.id === s.currentUserId)?.name}</h1>
            <p className="mt-0.5 text-[13.5px] capitalize text-muted-foreground">{dateStr}</p>
          </div>
          <button
            onClick={() => setMineOnly(m => !m)}
            className={cn("h-8 rounded-md border px-3 text-[12.5px] transition-colors", mineOnly ? "border-transparent font-medium" : "text-muted-foreground")}
            style={mineOnly ? { background: "hsl(42 42% 55% / 0.2)", color: "var(--brass-ink)" } : undefined}
          >
            {mineOnly ? "Только мои" : "Вся команда"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-[12.5px] text-muted-foreground">
          <span className="rounded-full border bg-card px-3 py-1">Открытых задач: <b className="tnum">{tasks.length}</b></span>
          <span className="rounded-full border bg-card px-3 py-1">Выполнено сегодня: <b className="tnum">{doneToday}</b></span>
          <span className="rounded-full border bg-card px-3 py-1">Без следующего шага: <b className="tnum">{noNext.length}</b></span>
        </div>

        <div className="mt-6 flex flex-col gap-6">
          <Section title="Просрочено" items={overdue} tone="danger" />
          <Section title="Сегодня" items={today} />
          <Section title="Ближайшие 7 дней" items={soon} />

          {noNext.length > 0 && (
            <section>
              <div className="mb-1 flex items-center gap-2">
                <SectionLabel className="px-0">Без следующего шага</SectionLabel>
                <span className="text-[11.5px] text-muted-foreground tnum">{noNext.length}</span>
              </div>
              <p className="mb-2 text-[12px] text-muted-foreground">Принцип CRM: у каждой активной записи должна быть следующая задача — иначе клиент «повисает».</p>
              <div className="flex flex-col gap-1.5">
                {noNext.slice(0, 8).map(r => {
                  const e = entityById(r.entityId)!;
                  return (
                    <div key={r.id} className="flex items-center gap-3 rounded-lg border border-dashed bg-card px-3 py-2.5">
                      <span>{e.icon}</span>
                      <button className="min-w-0 flex-1 truncate text-left text-[13.5px] hover:underline underline-offset-2" onClick={() => { A.go("entity", e.id); A.openRecord(r.id); }}>
                        {recTitle(r.id)}
                      </button>
                      <span className="text-[12px] text-muted-foreground">{e.pipeline?.stages.find(x => x.id === r.stageId)?.label}</span>
                      <button
                        onClick={() => { A.addTask(r.id, "Связаться: следующий шаг", "call", 24); }}
                        className="flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                      >
                        <Plus className="size-3" /> задача
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {overdue.length + today.length + soon.length === 0 && noNext.length === 0 && (
            <EmptyState icon={<Sun />} title="Всё разобрано" hint="Нет просроченного и на сегодня пусто. Создайте задачу из любой карточки записи — или посмотрите дашборд." />
          )}
        </div>
      </div>
    </div>
  );
}

const isTodayTs = (ts: number) => new Date(ts).toDateString() === new Date().toDateString();

// Живой «Мой день»: приветствие, реальные цифры, задачи на сегодня, записи без следующего шага, дни рождения
import type { Task } from "@/lib/model";
import { DAY } from "@/lib/model";
import { useState } from "react";
import { useApp, A, recById, recTitle, entityCfg, userName, setAuthStage } from "@/lib/store";
import { setupMarks, markSetup } from "@/lib/setup";
import { upcomingBirthdays, inDaysLabel } from "@/lib/bday";
import { congratulate } from "./TasksLive";
import { Button } from "@/components/ui/button";
import { Cake, CalendarClock, Check, ListChecks, MessageSquare, Phone, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<Task["kind"], React.ElementType> = { call: Phone, meet: CalendarClock, todo: ListChecks, msg: MessageSquare };
const StagePillLike = ({ label, color }: { label: string; color: string }) => (
  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-px text-[11px] font-medium" style={{ background: color + "18", borderColor: color + "50" }}>
    <span className="size-1.5 rounded-full" style={{ background: color }} />{label}
  </span>
);
const sod = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Первый вход: четыре шага до работающей CRM. Исчезает, когда всё сделано или человек скрыл.
function SetupChecklist({ goSettings, onPresets, goEntity }: { goSettings: () => void; onPresets: () => void; goEntity: () => void }) {
  const s = useApp();
  const [hidden, setHidden] = useState(!!setupMarks().hidden);
  const i = s.integrations;
  const steps = [
    { id: "structure", label: "Настроить разделы под ваш бизнес", hint: "готовый шаблон ниши или свой раздел", done: !!setupMarks().structure, run: onPresets },
    { id: "channel", label: "Подключить канал", hint: "Telegram, WhatsApp, MAX или форма с сайта", done: i.tg.status === "ok" || i.tgUser.status === "ok" || i.wa.status === "ok" || i.max.status === "ok" || i.tilda.status === "ok", run: goSettings },
    { id: "data", label: "Загрузить своих клиентов", hint: "CSV из Excel или другой CRM — кнопка «Загрузить» в разделе", done: !!setupMarks().imported, run: goEntity },
    { id: "cloud", label: "Общее пространство", hint: "чтобы данные были на всех устройствах и у команды", done: s.mode === "cloud", run: () => setAuthStage("auth") },
  ];
  const left = steps.filter(x => !x.done).length;
  if (hidden || !left) return null;
  return (
    <div className="mt-4 rounded-lg border bg-card p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">Настройка: осталось {left} из {steps.length}</span>
        <button onClick={() => { markSetup("hidden"); setHidden(true); }} title="Скрыть — можно жить и так"
          className="press ml-auto rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {steps.map(st => (
          <button key={st.id} onClick={st.done ? undefined : st.run} disabled={st.done}
            className={cn("flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
              st.done ? "border-transparent bg-muted/40" : "press hover:border-foreground/25")}>
            <span className="grid size-4 shrink-0 place-items-center rounded-full border"
              style={st.done ? { background: "#6E8B4F", borderColor: "#6E8B4F" } : undefined}>
              {st.done && <Check className="size-2.5 text-white" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[12.5px]", st.done ? "text-muted-foreground line-through" : "font-medium")}>{st.label}</span>
              {!st.done && <span className="block text-[11px] text-muted-foreground">{st.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MyDayLive({ goTasks, goInbox, goSettings, onPresets, goEntity }: { goTasks: () => void; goInbox: () => void; goSettings: () => void; onPresets: () => void; goEntity: () => void }) {
  const s = useApp();
  const start = sod();

  // без useMemo: стор мутирует массивы на месте, кэш по ссылкам не заметит изменений
  const openTasks = s.tasks.filter(t => !t.done);
  const withOpenTask = new Set(openTasks.map(t => t.recordId).filter(Boolean));
  const data = {
    openTasks,
    todayTasks: openTasks.filter(t => t.due < start + DAY).sort((a, b) => a.due - b.due),
    doneToday: s.tasks.filter(t => t.done && (t.doneAt ?? 0) >= start).length,
    // считаем ВСЕ — иначе счётчик врал бы «5», когда их сорок; в списке ниже показываем первые пять
    noNext: s.records.filter(r => {
      if (withOpenTask.has(r.id)) return false;
      const e = s.entities.find(x => x.id === r.entityId);
      const stg = e?.stages?.find(x => x.id === r.stageId);
      return !!stg && stg.kind === "open";
    }),
    unread: s.chats.reduce((n, c) => n + c.unread, 0),
  };

  const hour = new Date().getHours();
  const hello = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const me = s.mode === "cloud" ? (userName(s.currentUserId).split(/\s+/)[0] || "коллега") : "";
  const dateStr = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const bdays = upcomingBirthdays(7);

  return (
    <div className="cascade mx-auto max-w-3xl px-5 py-6">
      <div>
        <h1 className="text-[21px] font-semibold tracking-tight">{hello}{me ? `, ${me}` : ""}</h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {dateStr} — {data.todayTasks.length ? `сегодня и просрочено: ${data.todayTasks.length}` : "на сегодня задач нет"}{data.noNext.length ? `, без следующего шага: ${data.noNext.length}` : ""}
        </p>
      </div>

      {s.mode !== "cloud" && !setupMarks().structure && !setupMarks().imported && s.records.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2">
          <span className="text-[12px] leading-snug text-muted-foreground">
            Сейчас на экране <b className="font-medium text-foreground">примеры</b> — чужие сделки и клиенты, чтобы было видно, как работает.
          </span>
          <button onClick={onPresets}
            className="press ml-auto shrink-0 rounded-md px-2 py-1 text-[12px] font-medium"
            style={{ background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" }}>
            Настроить под свой бизнес
          </button>
          <button onClick={goSettings}
            className="press shrink-0 rounded-md border px-2 py-1 text-[12px] text-muted-foreground hover:border-foreground/25 hover:text-foreground">
            Очистить примеры
          </button>
        </div>
      )}

      <SetupChecklist goSettings={goSettings} onPresets={onPresets} goEntity={goEntity} />

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["Сегодня и просрочено", data.todayTasks.length, goTasks],
          ["Открытых задач всего", data.openTasks.length, goTasks],
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
            {data.noNext.slice(0, 5).map(r => {
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
            {data.noNext.length > 5 && (
              <button onClick={goEntity} className="press w-full px-3.5 py-2 text-left text-[11.5px] text-muted-foreground hover:text-foreground">
                и ещё {data.noNext.length - 5} — открыть раздел
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Календарь-месяц по полю-дате: записи в ячейках, клик по дню — создание с этой датой
import { useState } from "react";
import type { Entity, Rec, View } from "@/lib/model";
import { A, recTitle } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function CalendarView({ entity: e, view, records }: { entity: Entity; view: View; records: Rec[] }) {
  const [mode, setMode] = useState<"month" | "week">("month");
  const [base, setBase] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [weekStart, setWeekStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; });
  const df = e.fields.find(f => f.id === view.dateFieldId) ?? e.fields.find(f => f.type === "datetime" || f.type === "date");
  if (!df) return <div className="p-8 text-sm text-muted-foreground">Для календаря нужно поле типа «Дата». Добавьте его в «Настроить раздел».</div>;

  const start = new Date(base);
  const shift = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - shift);
  const cells = mode === "month"
    ? Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; })
    : Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const byDay = (d: Date) => {
    const from = d.getTime(), to = from + 86400000;
    return records
      .filter(r => { const v = Number(r.values[df.id]); return v >= from && v < to; })
      .sort((a, b) => Number(a.values[df.id]) - Number(b.values[df.id]));
  };

  const stageColor = (r: Rec) => e.pipeline?.stages.find(s => s.id === r.stageId)?.color ?? "#8A8578";
  const monthTitle = mode === "month"
    ? base.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    : `${weekStart.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} — ${new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`;
  const nav = (dir: -1 | 1) => {
    if (mode === "month") setBase(d => { const n = new Date(d); n.setMonth(n.getMonth() + dir); return n; });
    else setWeekStart(d => new Date(d.getTime() + dir * 7 * 86400000));
  };
  const goToday = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const m = new Date(d); m.setDate(1); setBase(m);
    const w = new Date(d); w.setDate(w.getDate() - ((w.getDay() + 6) % 7)); setWeekStart(w);
  };

  return (
    <div className="flex h-full flex-col p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold capitalize">{monthTitle}</h2>
        <div className="ml-3 flex overflow-hidden rounded-md border text-[12px]">
          {(["month", "week"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn("px-2.5 py-1", mode === m ? "bg-foreground/10 font-semibold" : "text-muted-foreground hover:text-foreground")}>
              {m === "month" ? "Месяц" : "Неделя"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => nav(-1)}><ChevronLeft className="size-4" /></Button>
          <Button variant="outline" size="sm" className="h-8" onClick={goToday}>Сегодня</Button>
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => nav(1)}><ChevronRight className="size-4" /></Button>
        </div>
      </div>
      <div className={cn("grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border", mode === "week" && "flex-1 content-stretch")}>
        {WD.map(w => <div key={w} className="bg-background px-2 py-1.5 text-center text-[11.5px] font-medium text-muted-foreground">{w}</div>)}
        {cells.map((d, i) => {
          const inMonth = mode === "week" || d.getMonth() === base.getMonth();
          const isToday = d.getTime() === today.getTime();
          const rs = byDay(d);
          return (
            <div key={i} className={cn("group/day bg-card p-1.5", mode === "month" ? "min-h-[92px]" : "min-h-[320px]", !inMonth && "bg-muted/40")}>
              <div className="flex items-center justify-between">
                <span className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11.5px] tnum", isToday ? "font-bold text-primary-foreground" : inMonth ? "text-foreground/80" : "text-muted-foreground/50")}
                  style={isToday ? { background: "var(--brass-ink)" } : undefined}>
                  {d.getDate()}
                </span>
                <button
                  title="Добавить на этот день"
                  onClick={() => {
                    const ts = new Date(d); ts.setHours(12, 0, 0, 0);
                    const id = A.createRecord(e.id, { [df.id]: ts.getTime() });
                    A.openRecord(id);
                  }}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover/day:opacity-100"
                >
                  <Plus className="size-3 text-muted-foreground" />
                </button>
              </div>
              <div className="mt-1 flex flex-col gap-1">
                {rs.slice(0, mode === "month" ? 3 : 99).map(r => (
                  <button
                    key={r.id}
                    onClick={() => A.openRecord(r.id)}
                    className="truncate rounded border px-1.5 py-0.5 text-left text-[11.5px] leading-snug transition-transform hover:scale-[1.02]"
                    style={{ background: stageColor(r) + "1a", borderColor: stageColor(r) + "55" }}
                  >
                    {df.type === "datetime" && (
                      <span className="tnum font-medium">{new Date(Number(r.values[df.id])).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} </span>
                    )}
                    {recTitle(r.id)}
                  </button>
                ))}
                {mode === "month" && rs.length > 3 && <span className="px-1 text-[10.5px] text-muted-foreground">ещё {rs.length - 3}…</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Живой календарь раздела: даты из полей записей, сроки задач и дни рождения клиентов.
// Раньше здесь был нарисованный август — теперь это то же самое, что в канбане и таблице, только по дням.
import { useMemo, useState } from "react";
import type { EntityCfg, Rec } from "@/lib/model";
import { fmtMoney } from "@/lib/model";
import { useApp, A, getState, recTitle, entityCfg } from "@/lib/store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Ev = { id: string; label: string; color: string; run: () => void; hint?: string };

const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export function CalendarLive({ entity, filter }: { entity: EntityCfg; filter?: (r: Rec) => boolean }) {
  useApp();
  const [offset, setOffset] = useState(0);
  const dateFields = entity.fields.filter(f => f.type === "date" || f.type === "datetime");
  const [fieldId, setFieldId] = useState(dateFields[0]?.id ?? "");
  const [showTasks, setShowTasks] = useState(true);

  const base = new Date();
  const cur = new Date(base.getFullYear(), base.getMonth() + offset, 1);

  const events = useMemo(() => {
    const st = getState();
    const map = new Map<string, Ev[]>();
    const add = (ts: number, e: Ev) => {
      const d = new Date(ts);
      const k = key(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    };
    const money = entity.fields.find(f => f.type === "money");
    // 1) записи раздела по выбранному полю-дате
    const f = dateFields.find(x => x.id === fieldId);
    if (f) {
      for (const r of st.records) {
        if (r.entityId !== entity.id) continue;
        if (filter && !filter(r)) continue;
        const v = Number(r.values[f.id]);
        if (!v || isNaN(v)) continue;
        const stg = entity.stages?.find(x => x.id === r.stageId);
        add(v, {
          id: "r" + r.id, label: recTitle(r.id) || entity.name, color: stg?.color ?? "#8A8578",
          hint: [f.label, stg?.label, money ? fmtMoney(r.values[money.id]) : ""].filter(Boolean).join(" · "),
          run: () => A.openRecord(r.id),
        });
      }
    }
    // 2) задачи: по записям этого раздела (и общие, без записи)
    if (showTasks) {
      for (const t of st.tasks) {
        const rec = t.recordId ? st.records.find(r => r.id === t.recordId) : undefined;
        if (t.recordId && rec?.entityId !== entity.id) continue;
        if (rec && filter && !filter(rec)) continue;
        add(t.due, {
          id: "t" + t.id, label: t.title, color: t.done ? "#6E8B4F" : t.due < Date.now() ? "#A8543F" : "#BC9F5C",
          hint: rec ? recTitle(rec.id) : "задача",
          run: () => { if (rec) A.openRecord(rec.id); else A.goto("tasks"); },
        });
      }
    }
    // 3) дни рождения клиентов — попадают в любой месяц текущего года
    for (const r of st.records) {
      const e = entityCfg(r.entityId);
      const bf = e.fields.find(x => x.type === "date" && /рожде|birth/i.test(x.label));
      const v = bf ? Number(r.values[bf.id]) : 0;
      if (!v || isNaN(v)) continue;
      const d = new Date(v);
      add(new Date(cur.getFullYear(), d.getMonth(), d.getDate(), 12).getTime(), {
        id: "b" + r.id, label: `ДР: ${recTitle(r.id)}`, color: "#8B6E86", hint: "поздравить",
        run: () => A.openRecord(r.id),
      });
    }
    return map;
  }, [entity, fieldId, showTasks, filter, offset, getState().records.length, getState().tasks.length]);

  const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
  const shift = (first.getDay() + 6) % 7; // неделя с понедельника
  const cells = Array.from({ length: 42 }, (_, i) => new Date(cur.getFullYear(), cur.getMonth(), i - shift + 1));
  const today = key(new Date());
  const total = [...events.values()].reduce((n, a) => n + a.length, 0);

  return (
    <div className="cascade flex-1 overflow-y-auto p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-semibold capitalize">{MONTHS[cur.getMonth()]} {cur.getFullYear()}</span>
        <span className="font-mono2 text-[10.5px] text-muted-foreground">{total} событий</span>
        <div className="ml-auto flex items-center gap-1.5">
          {dateFields.length > 1 && (
            <Select value={fieldId} onValueChange={setFieldId}>
              <SelectTrigger className="h-7 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>{dateFields.map(f => <SelectItem key={f.id} value={f.id}>по полю «{f.label}»</SelectItem>)}</SelectContent>
            </Select>
          )}
          <button onClick={() => setShowTasks(v => !v)}
            className={cn("press h-7 rounded-md border px-2 text-[12px] transition-colors", showTasks ? "border-transparent font-medium" : "text-muted-foreground hover:border-foreground/25")}
            style={showTasks ? { background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" } : undefined}>
            Задачи
          </button>
          <button onClick={() => setOffset(o => o - 1)} className="press h-7 rounded-md border px-2 text-[12px] text-muted-foreground hover:border-foreground/25 hover:text-foreground">‹</button>
          <button onClick={() => setOffset(0)} className="press h-7 rounded-md border px-2 text-[12px] text-muted-foreground hover:border-foreground/25 hover:text-foreground">Сегодня</button>
          <button onClick={() => setOffset(o => o + 1)} className="press h-7 rounded-md border px-2 text-[12px] text-muted-foreground hover:border-foreground/25 hover:text-foreground">›</button>
        </div>
      </div>

      {dateFields.length === 0 && (
        <p className="mb-2 rounded-md border border-dashed px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
          В разделе нет поля с датой — на календаре только задачи и дни рождения. Добавьте поле «Дата» в конструкторе, и записи встанут по дням.
        </p>
      )}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(w => (
          <div key={w} className="bg-background px-2 py-1.5 text-center text-[10.5px] font-medium text-muted-foreground">{w}</div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cur.getMonth();
          const k = key(d);
          const evs = events.get(k) ?? [];
          return (
            <div key={i} className={cn("min-h-[84px] bg-card p-1.5", !inMonth && "bg-muted/40")}>
              <span className={cn("font-mono2 grid h-5 w-fit min-w-5 place-items-center rounded-full px-1 text-[10.5px]",
                k === today ? "font-bold text-primary-foreground" : inMonth ? "text-foreground/70" : "text-muted-foreground/50")}
                style={k === today ? { background: "hsl(var(--primary))" } : undefined}>{d.getDate()}</span>
              <div className="mt-1 flex flex-col gap-1">
                {evs.slice(0, 3).map(e => (
                  <button key={e.id} onClick={e.run} title={e.hint ? `${e.label} — ${e.hint}` : e.label}
                    className="press truncate rounded border px-1.5 py-0.5 text-left text-[10px] leading-snug transition-colors hover:brightness-95"
                    style={{ background: e.color + "1c", borderColor: e.color + "55" }}>
                    {e.label}
                  </button>
                ))}
                {evs.length > 3 && <span className="px-1 text-[9.5px] text-muted-foreground">+{evs.length - 3} ещё</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

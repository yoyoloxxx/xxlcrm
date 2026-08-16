// Канбан по стадиям воронки: перетаскивание (HTML5 DnD), суммы по колонкам, быстрое добавление
import { useState } from "react";
import type { Entity, Rec } from "@/lib/model";
import { fmtMoney } from "@/lib/model";
import { A, dispCtx, openTasksFor, recTitle } from "@/lib/store";
import { displayValue } from "@/lib/model";
import { UserChip, hexA } from "./bits";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function KanbanView({ entity: e, records }: { entity: Entity; records: Rec[] }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [quickCol, setQuickCol] = useState<string | null>(null);
  const [quick, setQuick] = useState("");

  if (!e.pipeline) return <div className="p-8 text-sm text-muted-foreground">У раздела нет воронки. Включите её в «Настроить раздел».</div>;

  const moneyField = e.fields.find(f => f.type === "money");
  const subtitleField = e.fields.find(f => f.type === "relation") ?? e.fields.find(f => f.type === "select");

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4 md:p-5">
      {e.pipeline.stages.map(st => {
        const rs = records.filter(r => r.stageId === st.id).sort((a, b) => (b.stageAt ?? 0) - (a.stageAt ?? 0));
        const sum = moneyField ? rs.reduce((s, r) => s + (Number(r.values[moneyField.id]) || 0), 0) : 0;
        const closed = st.kind !== "open";
        const overWip = st.wip !== undefined && st.wip > 0 && rs.length > st.wip;
        return (
          <div
            key={st.id}
            className={cn("flex h-full w-[264px] shrink-0 flex-col rounded-lg", overCol === st.id && "drag-over")}
            style={{ background: closed ? "var(--kanban-col-closed)" : "var(--kanban-col)", outline: overWip ? "1.5px solid hsl(8 62% 46% / 0.5)" : undefined, outlineOffset: -1.5 }}
            onDragOver={ev => { ev.preventDefault(); setOverCol(st.id); }}
            onDragLeave={() => setOverCol(c => (c === st.id ? null : c))}
            onDrop={() => { if (dragId) A.moveStage(dragId, st.id, true); setDragId(null); setOverCol(null); }}
          >
            <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
              <span className="size-2 rounded-[3px]" style={{ background: st.color }} />
              <span className="text-[13px] font-semibold">{st.label}</span>
              <span className={cn("text-[12px] tnum", overWip ? "font-semibold text-destructive" : "text-muted-foreground")} title={st.wip ? `WIP-лимит: ${st.wip}` : undefined}>
                {rs.length}{st.wip ? `/${st.wip}` : ""}
              </span>
              <span className="ml-auto text-[11.5px] text-muted-foreground tnum">{moneyField && sum > 0 ? fmtMoney(sum) : ""}</span>
            </div>
            {overWip && <div className="mx-3 mb-1 rounded bg-destructive/10 px-2 py-0.5 text-[10.5px] font-medium text-destructive">перегруз стадии</div>}
            <div className="flex min-h-8 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {rs.map(r => {
                const overdue = openTasksFor(r.id).some(t => t.due < Date.now());
                const noNext = openTasksFor(r.id).length === 0 && st.kind === "open";
                return (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={() => setDragId(r.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => A.openRecord(r.id)}
                    className={cn("kanban-card fade-in rounded-md border bg-card p-2.5 shadow-[0_1px_2px_rgba(50,42,25,0.06)] transition-shadow hover:shadow-[0_4px_14px_-6px_rgba(50,42,25,0.25)]", dragId === r.id && "opacity-50")}
                  >
                    <div className="text-[13.5px] font-medium leading-snug">{recTitle(r.id)}</div>
                    {subtitleField && r.values[subtitleField.id] !== undefined && (() => {
                      const sub = displayValue(subtitleField, r.values[subtitleField.id], dispCtx());
                      return sub && sub !== recTitle(r.id) ? <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</div> : null;
                    })()}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[12.5px] font-semibold tnum" style={{ color: "var(--brass-ink)" }}>
                        {moneyField ? fmtMoney(r.values[moneyField.id]) : ""}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {overdue && <span className="rounded-full bg-destructive/10 px-1.5 py-px text-[10.5px] font-medium text-destructive">просрочено</span>}
                        {!overdue && noNext && <span title="Нет следующего шага" className="rounded-full px-1.5 py-px text-[10.5px] font-medium" style={{ background: "hsl(42 42% 55% / 0.18)", color: "var(--brass-ink)" }}>нет задачи</span>}
                        <UserChip id={r.ownerId} size={20} />
                      </span>
                    </div>
                  </div>
                );
              })}
              {quickCol === st.id ? (
                <input
                  autoFocus
                  value={quick}
                  onChange={ev => setQuick(ev.target.value)}
                  onKeyDown={ev => {
                    if (ev.key === "Enter" && quick.trim()) { A.createRecord(e.id, { [e.titleFieldId]: quick.trim() }, st.id); setQuick(""); }
                    if (ev.key === "Escape") { setQuickCol(null); setQuick(""); }
                  }}
                  onBlur={() => { setQuickCol(null); setQuick(""); }}
                  placeholder="Название + Enter"
                  className="rounded-md border bg-card px-2.5 py-2 text-[13px] outline-none"
                />
              ) : (
                <button
                  onClick={() => setQuickCol(st.id)}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground/80 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                >
                  <Plus className="size-3.5" /> Добавить
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className="w-1 shrink-0" />
    </div>
  );
}

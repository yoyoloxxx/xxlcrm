// Живой канбан: перетаскивание, быстрое добавление, суммы колонок
import { useState } from "react";
import type { EntityCfg } from "@/lib/model";
import { fmtMoney } from "@/lib/model";
import { A, recordsOf, recTitle, openTasksFor, dispCtx } from "@/lib/store";
import { displayValue } from "@/lib/model";
import { Money, UserChip } from "./bits";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function KanbanLive({ entity: e }: { entity: EntityCfg }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [quickCol, setQuickCol] = useState<string | null>(null);
  const [quick, setQuick] = useState("");

  const records = recordsOf(e.id);
  const moneyField = e.fields.find(f => f.type === "money");
  const subtitleField = e.fields.find(f => f.type === "relation");

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {(e.stages ?? []).map(st => {
        const rs = records.filter(r => r.stageId === st.id).sort((a, b) => (b.stageAt ?? 0) - (a.stageAt ?? 0));
        const sum = moneyField ? rs.reduce((s, r) => s + (Number(r.values[moneyField.id]) || 0), 0) : 0;
        return (
          <div
            key={st.id}
            className={cn("flex h-full w-[250px] shrink-0 flex-col rounded-lg transition-shadow", overCol === st.id && "ring-2 ring-[hsl(var(--brass))]")}
            style={{ background: "var(--kanban-col)" }}
            onDragOver={ev => { ev.preventDefault(); setOverCol(st.id); }}
            onDragLeave={() => setOverCol(c => (c === st.id ? null : c))}
            onDrop={() => { if (dragId) A.moveStage(dragId, st.id); setDragId(null); setOverCol(null); }}
          >
            <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
              <span className="size-2 rounded-[3px]" style={{ background: st.color }} />
              <span className="text-[12.5px] font-semibold">{st.label}</span>
              <span className="font-mono2 text-[11px] text-muted-foreground">{rs.length}</span>
              {moneyField && sum > 0 && <Money v={fmtMoney(sum)} className="ml-auto text-[10.5px] text-muted-foreground" />}
            </div>
            <div className="flex min-h-10 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {rs.map(r => {
                const overdue = openTasksFor(r.id).some(t => t.due < Date.now());
                const noNext = openTasksFor(r.id).length === 0 && st.kind === "open";
                const sub = subtitleField ? displayValue(subtitleField, r.values[subtitleField.id], dispCtx()) : "";
                return (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={() => setDragId(r.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => A.openRecord(r.id)}
                    className={cn(
                      "cursor-grab rounded-md border bg-card p-2.5 text-left shadow-[0_1px_2px_rgba(50,42,25,0.05)] transition-all duration-200",
                      "hover:shadow-[0_5px_16px_-8px_rgba(50,42,25,0.28)] active:cursor-grabbing",
                      dragId === r.id && "opacity-50"
                    )}
                  >
                    <div className="text-[13px] font-medium leading-snug">{recTitle(r.id)}</div>
                    {sub && sub !== recTitle(r.id) && <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{sub}</div>}
                    <div className="mt-2 flex items-center justify-between">
                      <Money v={moneyField ? fmtMoney(r.values[moneyField.id]) : ""} className="text-[12.5px] font-medium" />
                      <span className="flex items-center gap-1.5">
                        {overdue && <span className="rounded-full bg-destructive/10 px-1.5 py-px text-[10px] font-medium text-destructive">просрочено</span>}
                        {!overdue && noNext && <span className="rounded-full px-1.5 py-px text-[10px] font-medium" style={{ background: "hsl(var(--brass) / 0.18)", color: "var(--brass-ink)" }}>нет задачи</span>}
                        <UserChip id={r.ownerId} size={18} />
                      </span>
                    </div>
                  </div>
                );
              })}
              {quickCol === st.id ? (
                <input
                  autoFocus value={quick}
                  onChange={ev => setQuick(ev.target.value)}
                  onKeyDown={ev => {
                    if (ev.key === "Enter" && quick.trim()) { A.createRecord(e.id, { [e.titleFieldId]: quick.trim() }, st.id); setQuick(""); }
                    if (ev.key === "Escape") { setQuickCol(null); setQuick(""); }
                  }}
                  onBlur={() => { setQuickCol(null); setQuick(""); }}
                  placeholder="Название + Enter"
                  className="rounded-md border bg-card px-2.5 py-2 text-[12.5px] outline-none focus:border-ring"
                />
              ) : (
                <button onClick={() => setQuickCol(st.id)}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground/80 transition-colors hover:bg-foreground/[0.04] hover:text-foreground">
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

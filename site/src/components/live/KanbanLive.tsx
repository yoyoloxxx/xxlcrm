// Живой канбан: перетаскивание с точной вставкой (линия-индикатор показывает, куда встанет карточка)
import { useState } from "react";
import type { EntityCfg } from "@/lib/model";
import { fmtMoney, displayValue } from "@/lib/model";
import { A, recordsOf, recTitle, openTasksFor, dispCtx } from "@/lib/store";
import { Money, UserChip } from "./bits";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function KanbanLive({ entity: e }: { entity: EntityCfg }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ stage: string; index: number } | null>(null);
  const [quickCol, setQuickCol] = useState<string | null>(null);
  const [quick, setQuick] = useState("");

  const records = recordsOf(e.id);
  const moneyField = e.fields.find(f => f.type === "money");
  const subtitleField = e.fields.find(f => f.type === "relation");

  const clearDnd = () => { setDragId(null); setSlot(null); };

  // Индикатор места вставки: абсолютный, не участвует ни в раскладке, ни в hit-тесте —
  // иначе карточки «уезжают» из-под курсора и позиция мигает
  const DropLine = ({ at }: { at: "top" | "bottom" }) => (
    <span
      className={cn("pointer-events-none absolute left-0 right-0 z-10 h-[3px] rounded-full", at === "top" ? "-top-[5px]" : "-bottom-[5px]")}
      style={{ background: "hsl(var(--brass))", boxShadow: "0 0 0 1px hsl(var(--brass) / 0.25)" }}
    />
  );

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {(e.stages ?? []).map(st => {
        const rs = records.filter(r => r.stageId === st.id).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
        const sum = moneyField ? rs.reduce((s, r) => s + (Number(r.values[moneyField.id]) || 0), 0) : 0;
        const active = slot?.stage === st.id;
        return (
          <div
            key={st.id}
            className={cn("flex h-full w-[250px] shrink-0 flex-col rounded-lg transition-shadow", active && "ring-1 ring-[hsl(var(--brass)/0.55)]")}
            style={{ background: "var(--kanban-col)" }}
            onDragOver={ev => { ev.preventDefault(); if (!active) setSlot({ stage: st.id, index: rs.length }); }}
            onDrop={ev => {
              ev.preventDefault();
              if (dragId && slot?.stage === st.id) A.moveStageAt(dragId, st.id, rs[slot.index]?.id ?? null);
              clearDnd();
            }}
          >
            <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
              <span className="size-2 rounded-[3px]" style={{ background: st.color }} />
              <span className="text-[12.5px] font-semibold">{st.label}</span>
              <span className="font-mono2 text-[11px] text-muted-foreground">{rs.length}</span>
              {moneyField && sum > 0 && <Money v={fmtMoney(sum)} className="ml-auto text-[10.5px] text-muted-foreground" />}
            </div>
            <div
              className="flex min-h-10 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
              onDragOver={ev => { ev.preventDefault(); setSlot({ stage: st.id, index: rs.length }); }}
            >
              {rs.map((r, i) => {
                const overdue = openTasksFor(r.id).some(t => t.due < Date.now());
                const noNext = openTasksFor(r.id).length === 0 && st.kind === "open";
                const sub = subtitleField ? displayValue(subtitleField, r.values[subtitleField.id], dispCtx()) : "";
                return (
                  <div key={r.id} className="relative">
                    {active && slot!.index === i && <DropLine at="top" />}
                    {active && i === rs.length - 1 && slot!.index >= rs.length && <DropLine at="bottom" />}
                    <div
                      draggable
                      onDragStart={() => setDragId(r.id)}
                      onDragEnd={clearDnd}
                      onDragOver={ev => {
                        ev.preventDefault(); ev.stopPropagation();
                        const rect = ev.currentTarget.getBoundingClientRect();
                        const before = ev.clientY < rect.top + rect.height / 2;
                        setSlot(s2 => {
                          const index = before ? i : i + 1;
                          return s2?.stage === st.id && s2.index === index ? s2 : { stage: st.id, index };
                        });
                      }}
                      onClick={() => A.openRecord(r.id)}
                      className={cn(
                        "cursor-grab rounded-md border bg-card p-2.5 text-left shadow-[0_1px_2px_rgba(50,42,25,0.05)] transition-shadow duration-200",
                        "hover:shadow-[0_5px_16px_-8px_rgba(50,42,25,0.28)] active:cursor-grabbing",
                        dragId === r.id && "opacity-40"
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
                  </div>
                );
              })}
              {active && rs.length === 0 && (
                <div className="pointer-events-none rounded-md border border-dashed py-3 text-center text-[11px]" style={{ borderColor: "hsl(var(--brass) / 0.6)", color: "var(--brass-ink)" }}>
                  сюда
                </div>
              )}
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

// Живая таблица: inline-редактирование, сортировка, быстрое добавление, суммы
import { useState } from "react";
import type { EntityCfg, Field, Rec } from "@/lib/model";
import { displayValue, fmtMoney } from "@/lib/model";
import { A, recordsOf, recTitle, openTasksFor, dispCtx, entityCfg, allUsers } from "@/lib/store";
import { FieldInput } from "./FieldInput";
import { Pill, UserChip } from "./bits";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowDown, ArrowUp, Maximize2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function TableLive({ entity: e }: { entity: EntityCfg }) {
  const [editing, setEditing] = useState<{ rec: string; field: string } | null>(null);
  const [quick, setQuick] = useState("");
  const [sort, setSort] = useState<{ fieldId: string; dir: 1 | -1 } | null>(null);

  const cols = e.fields.filter(f => f.id !== e.titleFieldId && f.inTable !== false);
  const sorted = [...recordsOf(e.id)];
  if (sort) {
    const f = e.fields.find(x => x.id === sort.fieldId);
    sorted.sort((a, b) => {
      const av = sort.fieldId === "__title" ? recTitle(a.id) : a.values[sort.fieldId];
      const bv = sort.fieldId === "__title" ? recTitle(b.id) : b.values[sort.fieldId];
      const num = f && ["number", "money", "date", "datetime"].includes(f.type);
      const cmp = num ? Number(av ?? -Infinity) - Number(bv ?? -Infinity) : String(av ?? "").localeCompare(String(bv ?? ""), "ru");
      return cmp * sort.dir;
    });
  } else sorted.sort((a, b) => b.createdAt - a.createdAt);

  const toggleSort = (fieldId: string) =>
    setSort(s => (s?.fieldId === fieldId ? (s.dir === 1 ? { fieldId, dir: -1 } : null) : { fieldId, dir: 1 }));

  const Th = ({ children, fieldId, first }: { children: React.ReactNode; fieldId?: string; first?: boolean }) => (
    <th className={cn("whitespace-nowrap border-b bg-background px-3.5 py-2 text-left text-[11.5px] font-medium text-muted-foreground", first && "pl-5")}>
      {fieldId ? (
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(fieldId)}>
          {children}
          {sort?.fieldId === fieldId && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : children}
    </th>
  );

  const moneySum = (f: Field) => sorted.reduce((s, r) => s + (Number(r.values[f.id]) || 0), 0);

  return (
    <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">
      <thead className="sticky top-0 z-10">
        <tr>
          <Th fieldId="__title" first>{e.fields.find(f => f.id === e.titleFieldId)?.label}</Th>
          {e.stages && <Th>Стадия</Th>}
          {cols.map(f => <Th key={f.id} fieldId={f.id}>{f.label}</Th>)}
          <Th>Ответственный</Th>
          <th className="w-full border-b bg-background" />
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => (
          <tr key={r.id} className="group/row hover:bg-muted/40">
            <td className="max-w-72 border-b py-1 pl-5 pr-2">
              <div className="flex items-center gap-2">
                {openTasksFor(r.id).some(t => t.due < Date.now()) && <span title="Просроченная задача" className="size-1.5 shrink-0 rounded-full bg-destructive" />}
                <button className="truncate py-1 text-left font-medium underline-offset-2 hover:underline" onClick={() => A.openRecord(r.id)}>
                  {recTitle(r.id)}
                </button>
                <button className="rounded p-1 opacity-0 transition-opacity hover:bg-foreground/5 group-hover/row:opacity-100" title="Открыть карточку" onClick={() => A.openRecord(r.id)}>
                  <Maximize2 className="size-3 text-muted-foreground" />
                </button>
              </div>
            </td>
            {e.stages && (
              <td className="border-b px-3.5 py-1"><StagePicker rec={r} /></td>
            )}
            {cols.map(f => {
              const isEd = editing?.rec === r.id && editing.field === f.id;
              return (
                <td key={f.id} className="max-w-56 border-b px-2 py-1" onClick={() => !isEd && setEditing({ rec: r.id, field: f.id })}>
                  {isEd ? (
                    <div className="min-w-36"><FieldInput field={f} value={r.values[f.id]} autoFocus onChange={v => A.setValue(r.id, f, v)} onDone={() => setEditing(null)} /></div>
                  ) : (
                    <div className={cn("cell-editable truncate px-1.5 py-1", ["money", "number"].includes(f.type) && "font-mono2 tnum")}>
                      <CellDisplay f={f} r={r} />
                    </div>
                  )}
                </td>
              );
            })}
            <td className="border-b px-3.5 py-1"><OwnerPicker rec={r} /></td>
            <td className="border-b" />
          </tr>
        ))}
        <tr>
          <td colSpan={3 + cols.length + (e.stages ? 1 : 0)} className="px-5 py-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Plus className="size-3.5" />
              <input
                value={quick} onChange={ev => setQuick(ev.target.value)}
                onKeyDown={ev => { if (ev.key === "Enter" && quick.trim()) { A.createRecord(e.id, { [e.titleFieldId]: quick.trim() }); setQuick(""); } }}
                placeholder={`Быстро добавить: ${e.name.toLowerCase()} + Enter`}
                className="h-8 w-80 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
              />
            </div>
          </td>
        </tr>
      </tbody>
      {cols.some(f => f.type === "money") && sorted.length > 0 && (
        <tfoot>
          <tr className="text-[11.5px] text-muted-foreground">
            <td className="sticky bottom-0 whitespace-nowrap border-t bg-background py-2 pl-5">Итого: {sorted.length}</td>
            {e.stages && <td className="sticky bottom-0 border-t bg-background" />}
            {cols.map(f => (
              <td key={f.id} className="font-mono2 tnum sticky bottom-0 whitespace-nowrap border-t bg-background px-3.5 py-2 font-medium">
                {f.type === "money" ? fmtMoney(moneySum(f)) : ""}
              </td>
            ))}
            <td className="sticky bottom-0 border-t bg-background" colSpan={2} />
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function CellDisplay({ f, r }: { f: Field; r: Rec }) {
  const v = r.values[f.id];
  if (f.type === "select") { const o = f.options?.find(x => x.id === v); return o ? <Pill o={o} small /> : <span className="text-muted-foreground/60">—</span>; }
  const text = displayValue(f, v, dispCtx());
  if (!text) return <span className="text-muted-foreground/60">—</span>;
  if (f.type === "url") return <a href={/^https?:/.test(String(v)) ? String(v) : "https://" + String(v)} target="_blank" rel="noreferrer" style={{ color: "var(--brass-ink)" }} className="hover:underline" onClick={e => e.stopPropagation()}>{text.replace(/^https?:\/\//, "")}</a>;
  return <>{text}</>;
}

export function StagePicker({ rec, small }: { rec: Rec; small?: boolean }) {
  const e = entityCfg(rec.entityId);
  const stage = e.stages?.find(s => s.id === rec.stageId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-md transition-transform hover:scale-[1.02]"><Pill o={stage} small={small ?? true} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {e.stages?.map(s => (
          <DropdownMenuItem key={s.id} onClick={() => A.moveStage(rec.id, s.id)}><Pill o={s} small /></DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OwnerPicker({ rec }: { rec: Rec }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-md p-0.5 hover:bg-foreground/5"><UserChip id={rec.ownerId} withName /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {allUsers().map(u => (
          <DropdownMenuItem key={u.id} onClick={() => A.setOwner(rec.id, u.id)}><UserChip id={u.id} withName /></DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

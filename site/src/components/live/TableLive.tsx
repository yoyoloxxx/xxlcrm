// Живая таблица: inline-редактирование, сортировка, быстрое добавление, суммы
import { useState } from "react";
import type { EntityCfg, Field, Rec } from "@/lib/model";
import { displayValue, fmtMoney } from "@/lib/model";
import { A, recordsOf, recTitle, openTasksFor, dispCtx, entityCfg, allUsers } from "@/lib/store";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FIELD_TYPES } from "@/lib/model";
import { FieldInput } from "./FieldInput";
import { Pill, UserChip } from "./bits";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowDown, ArrowUp, Download, ListChecks, Maximize2, Plus, Trash2, X } from "lucide-react";
import { toCSV, downloadCSV } from "@/lib/export";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function TableLive({ entity: e, filter }: { entity: EntityCfg; filter?: (r: import("@/lib/model").Rec) => boolean }) {
  const [editing, setEditing] = useState<{ rec: string; field: string } | null>(null);
  const [quick, setQuick] = useState("");
  const [sort, setSort] = useState<{ fieldId: string; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(200);
  const [sel, setSel] = useState<Set<string>>(new Set());     // массовые действия: что выделено
  const [bulkTask, setBulkTask] = useState("");
  const [newField, setNewField] = useState({ label: "", type: "text" });

  const cols = e.fields.filter(f => f.id !== e.titleFieldId && f.inTable !== false);
  const sorted = filter ? recordsOf(e.id).filter(filter) : [...recordsOf(e.id)];
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

  // Больше пары сотен строк браузер рисует секундами и замирает. Показываем порциями:
  // «Итого» и массовые действия при этом считаются по ВСЕМ, а не по видимой части.
  const PAGE = 200;
  const shown = sorted.slice(0, limit);
  const hidden = sorted.length - shown.length;

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
  const allSelected = sorted.length > 0 && sorted.every(r => sel.has(r.id));
  const ids = [...sel].filter(id => sorted.some(r => r.id === id));   // выделенное, но уже отфильтрованное — не трогаем

  return (
    <>
    {ids.length > 0 && (
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1.5 border-b bg-card px-4 py-2 shadow-sm">
        <span className="text-[12.5px] font-medium">Выбрано: {ids.length}</span>
        {!!e.stages?.length && (
          <Select value="" onValueChange={v => { A.bulkStage(ids, v); setSel(new Set()); }}>
            <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue placeholder="Стадия →" /></SelectTrigger>
            <SelectContent>{e.stages.map(st => <SelectItem key={st.id} value={st.id}>{st.label}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Select value="" onValueChange={v => { A.bulkOwner(ids, v); setSel(new Set()); }}>
          <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue placeholder="Ответственный →" /></SelectTrigger>
          <SelectContent>{allUsers().map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input value={bulkTask} onChange={ev => setBulkTask(ev.target.value)} placeholder="Задача всем на завтра…"
            className="h-8 w-[190px] text-[12px]"
            onKeyDown={ev => { if (ev.key === "Enter" && bulkTask.trim()) { A.bulkTask(ids, bulkTask.trim(), "call", 24); setBulkTask(""); setSel(new Set()); } }} />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" disabled={!bulkTask.trim()}
            onClick={() => { A.bulkTask(ids, bulkTask.trim(), "call", 24); setBulkTask(""); setSel(new Set()); }}>
            <ListChecks className="size-3.5" /> Поставить
          </Button>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]"
          onClick={() => downloadCSV(e.namePlural + "_выбранное", toCSV(e, sorted.filter(r => sel.has(r.id)), dispCtx()))}>
          <Download className="size-3.5" /> Выгрузить выбранные
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 border-destructive/40 text-[12px] text-destructive hover:bg-destructive/5"
          onClick={() => { A.bulkDelete(ids); setSel(new Set()); }}>
          <Trash2 className="size-3.5" /> Удалить
        </Button>
        <button onClick={() => setSel(new Set())} className="press ml-auto inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
          <X className="size-3.5" /> снять выделение
        </button>
      </div>
    )}
    <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">
      <thead className="sticky top-0 z-10">
        <tr>
          <th className="border-b bg-background pl-4 pr-1">
            <Checkbox aria-label="Выделить все" checked={allSelected}
              onCheckedChange={v => setSel(v ? new Set(sorted.map(r => r.id)) : new Set())} />
          </th>
          <Th fieldId="__title">{e.fields.find(f => f.id === e.titleFieldId)?.label}</Th>
          {e.stages && <Th>Стадия</Th>}
          {cols.map(f => <Th key={f.id} fieldId={f.id}>{f.label}</Th>)}
          <Th>Ответственный</Th>
          <th className="border-b bg-background px-2">
            <Popover>
              <PopoverTrigger asChild>
                <button title="Добавить поле в раздел" aria-label="Добавить поле в раздел" className="press grid size-6 place-items-center rounded border border-dashed text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                  <Plus className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <div className="text-[12.5px] font-semibold">Новое поле</div>
                <Input autoFocus value={newField.label} onChange={ev => setNewField(f => ({ ...f, label: ev.target.value }))}
                  placeholder="Название поля" className="mt-2 h-8 text-[12.5px]" />
                <Select value={newField.type} onValueChange={v => setNewField(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1.5 h-8 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELD_TYPES.filter(t => t.type !== "relation").map(t => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <Button className="mt-2 h-8 w-full text-[12.5px]" disabled={!newField.label.trim()}
                  onClick={() => { A.fieldAdd(e.id, { label: newField.label.trim(), type: newField.type as Field["type"], inTable: true }); setNewField({ label: "", type: "text" }); }}>
                  Добавить
                </Button>
              </PopoverContent>
            </Popover>
          </th>
          <th className="border-b bg-background" />
        </tr>
      </thead>
      <tbody>
        {shown.map(r => (
          <tr key={r.id} className={cn("group/row hover:bg-muted/40", sel.has(r.id) && "bg-[hsl(var(--brass)/0.09)]")}>
            <td className="border-b pl-4 pr-1">
              <Checkbox aria-label="Выделить запись" checked={sel.has(r.id)}
                onCheckedChange={v => setSel(prev => { const n = new Set(prev); if (v) n.add(r.id); else n.delete(r.id); return n; })} />
            </td>
            <td className="max-w-72 border-b py-1 pr-2">
              <div className="flex items-center gap-2">
                {openTasksFor(r.id).some(t => t.due < Date.now()) && <span title="Просроченная задача" className="size-1.5 shrink-0 rounded-full bg-destructive" />}
                <button className="truncate py-1 text-left font-medium underline-offset-2 hover:underline" onClick={() => A.openRecord(r.id)}>
                  {recTitle(r.id)}
                </button>
                <button className="rounded p-1 opacity-0 transition-opacity hover:bg-foreground/5 focus-visible:opacity-100 group-hover/row:opacity-100" title="Открыть карточку" aria-label="Открыть карточку" onClick={() => A.openRecord(r.id)}>
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
                onKeyDown={ev => { if (ev.key === "Enter" && quick.trim()) { (() => {
                    const id = A.createRecord(e.id, { [e.titleFieldId]: quick.trim() });
                    if (filter && !filter(recordsOf(e.id).find(r => r.id === id)!)) {
                      toast("Запись создана, но скрыта фильтром", { description: quick.trim() });
                    }
                    return id;
                  })(); setQuick(""); } }}
                placeholder={`Быстро добавить: ${e.name.toLowerCase()} + Enter`}
                className="h-8 w-80 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
            </div>
          </td>
        </tr>
        {hidden > 0 && (
          <tr>
            <td colSpan={cols.length + (e.stages ? 3 : 2)} className="border-b px-5 py-2.5">
              <button onClick={() => setLimit(l => l + PAGE * 5)}
                className="press rounded-md border px-2.5 py-1 text-[12px] text-muted-foreground hover:border-foreground/25 hover:text-foreground">
                Показать ещё {Math.min(hidden, PAGE * 5)} из {hidden}
              </button>
              <span className="ml-2 text-[11.5px] text-muted-foreground">
                показано {shown.length} из {sorted.length} — так таблица не подвисает; поиск и фильтр ищут по всем
              </span>
            </td>
          </tr>
        )}
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
    </>
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
        <button aria-label={`Стадия: ${stage?.label ?? "не выбрана"}. Сменить`} className="rounded-md transition-transform hover:scale-[1.02]"><Pill o={stage} small={small ?? true} /></button>
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
        <button aria-label="Сменить ответственного" className="rounded-md p-0.5 hover:bg-foreground/5"><UserChip id={rec.ownerId} withName /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {allUsers().map(u => (
          <DropdownMenuItem key={u.id} onClick={() => A.setOwner(rec.id, u.id)}><UserChip id={u.id} withName /></DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

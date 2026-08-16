// Таблица: inline-редактирование, сортировка, колонки, группировка, массовые действия, суммы
import { useState } from "react";
import type { Entity, Field, Rec, View } from "@/lib/model";
import { displayValue, fmtMoney, FIELD_TYPES } from "@/lib/model";
import { A, dispCtx, recTitle, openTasksFor, rollupValue, getState, userName } from "@/lib/store";
import { FieldInput } from "./FieldInput";
import { OptionBadge, StageBadge, UserChip } from "./bits";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Maximize2, Plus, SlidersHorizontal, Trash2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function TableView({ entity: e, view, records }: { entity: Entity; view: View; records: Rec[] }) {
  const [editing, setEditing] = useState<{ rec: string; field: string } | null>(null);
  const [quick, setQuick] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const hidden = new Set(view.hidden ?? []);
  const cols = e.fields.filter(f => f.id !== e.titleFieldId && f.inTable !== false && !hidden.has(f.id));

  const sorted = [...records];
  if (view.sort) {
    const f = e.fields.find(x => x.id === view.sort!.fieldId);
    sorted.sort((a, b) => {
      const val = (r: Rec) => view.sort!.fieldId === "__title" ? recTitle(r.id) : f?.type === "rollup" ? rollupValue(f, r) : r.values[view.sort!.fieldId];
      const av = val(a), bv = val(b);
      const an = f && ["number", "money", "date", "datetime", "rating", "rollup"].includes(f.type);
      const cmp = an ? (Number(av ?? -Infinity) - Number(bv ?? -Infinity)) : String(av ?? "").localeCompare(String(bv ?? ""), "ru");
      return cmp * view.sort!.dir;
    });
  } else sorted.sort((a, b) => b.createdAt - a.createdAt);

  // группировка
  const gf = view.groupBy === "__stage" || view.groupBy === "__owner" ? undefined : e.fields.find(f => f.id === view.groupBy);
  let groups: { key: string; head: React.ReactNode; recs: Rec[] }[] | null = null;
  if (view.groupBy) {
    const map = new Map<string, { head: React.ReactNode; recs: Rec[] }>();
    for (const r of sorted) {
      let key = "—", head: React.ReactNode = <span className="text-muted-foreground">Не указано</span>;
      if (view.groupBy === "__stage" && e.pipeline) {
        const st = e.pipeline.stages.find(x => x.id === r.stageId);
        if (st) { key = st.id; head = <StageBadge s={st} small />; }
      } else if (view.groupBy === "__owner") {
        key = r.ownerId; head = <UserChip id={r.ownerId} withName />;
      } else if (gf) {
        const v = r.values[gf.id];
        if (gf.type === "select") { const o = gf.options?.find(x => x.id === v); if (o) { key = o.id; head = <OptionBadge o={o} small />; } }
        else if (gf.type === "user" && v) { key = String(v); head = <UserChip id={String(v)} withName />; }
        else if (v !== undefined && v !== null && v !== "") { key = String(v); head = <span>{displayValue(gf, v, dispCtx())}</span>; }
      }
      if (!map.has(key)) map.set(key, { head, recs: [] });
      map.get(key)!.recs.push(r);
    }
    // порядок групп: по стадиям — как в воронке
    let entries = [...map.entries()];
    if (view.groupBy === "__stage" && e.pipeline) {
      const order = e.pipeline.stages.map(s => s.id);
      entries = entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    } else entries = entries.sort((a, b) => b[1].recs.length - a[1].recs.length);
    groups = entries.map(([key, v]) => ({ key, ...v }));
  }

  const toggleSort = (fieldId: string) => {
    const cur = view.sort;
    A.updateView(e.id, view.id, { sort: cur?.fieldId === fieldId ? (cur.dir === 1 ? { fieldId, dir: -1 } : null) : { fieldId, dir: 1 } });
  };
  const toggleSel = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = sorted.length > 0 && sorted.every(r => sel.has(r.id));

  const Th = ({ children, fieldId, className }: { children: React.ReactNode; fieldId?: string; className?: string }) => (
    <th className={cn("whitespace-nowrap border-b bg-background px-3 py-2 text-left text-[12px] font-medium text-muted-foreground", className)}>
      {fieldId ? (
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(fieldId)}>
          {children}
          {view.sort?.fieldId === fieldId && (view.sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : children}
    </th>
  );

  const totalCols = 3 + cols.length + (e.pipeline ? 1 : 0) + 1;
  const moneySums = cols.filter(f => f.type === "money").map(f => ({ f, sum: sorted.reduce((s, r) => s + (Number(r.values[f.id]) || 0), 0) }));

  const renderRow = (r: Rec) => {
    const overdue = openTasksFor(r.id).some(t => t.due < Date.now());
    return (
      <tr key={r.id} className={cn("group/row hover:bg-muted/50", sel.has(r.id) && "bg-[hsl(42_42%_55%/0.08)]")}>
        <td className="w-8 border-b py-1 pl-3 md:pl-4">
          <Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggleSel(r.id)} className={cn("transition-opacity", sel.size === 0 && "opacity-0 group-hover/row:opacity-100")} />
        </td>
        <td className="max-w-72 border-b py-1 pr-2">
          <div className="flex items-center gap-2">
            {overdue && <span title="Есть просроченная задача" className="size-1.5 shrink-0 rounded-full bg-destructive" />}
            <button className="truncate py-1 text-left font-medium underline-offset-2 hover:underline" onClick={() => A.openRecord(r.id)}>
              {recTitle(r.id)}
            </button>
            <button className="rounded p-1 opacity-0 transition-opacity hover:bg-foreground/5 group-hover/row:opacity-100" title="Открыть карточку" onClick={() => A.openRecord(r.id)}>
              <Maximize2 className="size-3 text-muted-foreground" />
            </button>
          </div>
        </td>
        {e.pipeline && (
          <td className="border-b px-3 py-1"><StagePicker rec={r} entity={e} /></td>
        )}
        {cols.map(f => {
          const isEd = editing?.rec === r.id && editing.field === f.id;
          const editable = f.type !== "rollup" && f.type !== "autonumber";
          return (
            <td key={f.id} className="max-w-56 border-b px-1.5 py-1" onClick={() => editable && !isEd && setEditing({ rec: r.id, field: f.id })}>
              {isEd ? (
                <div className="min-w-36"><FieldInput field={f} value={r.values[f.id]} autoFocus onChange={v => A.setValue(r.id, f, v)} onDone={() => setEditing(null)} /></div>
              ) : (
                <div className={cn("truncate px-1.5 py-1", editable && "cell-editable", ["money", "number", "rollup"].includes(f.type) && "tnum")}>
                  <CellDisplay f={f} r={r} />
                </div>
              )}
            </td>
          );
        })}
        <td className="border-b px-3 py-1"><OwnerPicker rec={r} /></td>
        <td className="border-b" />
      </tr>
    );
  };

  return (
    <>
      <table className="w-full min-w-max border-separate border-spacing-0 text-[13.5px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="w-8 border-b bg-background py-2 pl-3 md:pl-4">
              <Checkbox checked={allSelected} onCheckedChange={() => setSel(allSelected ? new Set() : new Set(sorted.map(r => r.id)))} />
            </th>
            <Th fieldId="__title">{e.fields.find(f => f.id === e.titleFieldId)?.label ?? "Название"}</Th>
            {e.pipeline && <Th>Стадия</Th>}
            {cols.map(f => <Th key={f.id} fieldId={f.id}>{f.label}</Th>)}
            <Th>Ответственный</Th>
            <th className="w-full border-b bg-background px-1 py-1 text-left">
              <div className="flex items-center gap-0.5">
                <AddFieldQuick entity={e} />
                <ColumnsConfig entity={e} view={view} />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups
            ? groups.map(g => (
                <GroupRows key={g.key} g={g} totalCols={totalCols} collapsed={collapsed.has(g.key)}
                  onToggle={() => setCollapsed(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}
                  moneyField={cols.find(f => f.type === "money")}
                  renderRow={renderRow} />
              ))
            : sorted.map(renderRow)}
          <tr>
            <td colSpan={totalCols} className="px-4 py-1 md:px-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Plus className="size-3.5" />
                <input
                  value={quick}
                  onChange={ev => setQuick(ev.target.value)}
                  onKeyDown={ev => {
                    if (ev.key === "Enter" && quick.trim()) {
                      A.createRecord(e.id, { [e.titleFieldId]: quick.trim() });
                      setQuick("");
                    }
                  }}
                  placeholder="Быстро добавить: название + Enter"
                  className="h-8 w-72 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/70"
                />
              </div>
            </td>
          </tr>
        </tbody>
        {moneySums.length > 0 && (
          <tfoot>
            <tr className="text-[12.5px] text-muted-foreground">
              <td className="sticky bottom-0 border-t bg-background" />
              <td className="sticky bottom-0 whitespace-nowrap border-t bg-background py-2 pr-3">Итого: {sorted.length}</td>
              {e.pipeline && <td className="sticky bottom-0 border-t bg-background" />}
              {cols.map(f => (
                <td key={f.id} className="sticky bottom-0 whitespace-nowrap border-t bg-background px-3 py-2 tnum font-medium">
                  {f.type === "money" ? fmtMoney(moneySums.find(m => m.f.id === f.id)?.sum) : ""}
                </td>
              ))}
              <td className="sticky bottom-0 border-t bg-background" colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>

      {sel.size > 0 && (
        <div className="fade-in fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3 py-2 shadow-xl">
          <span className="px-1.5 text-[13px] font-medium tnum">{sel.size} выбрано</span>
          {e.pipeline && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-8 rounded-full text-[12.5px]">Стадия</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top">
                {e.pipeline.stages.map(st => (
                  <DropdownMenuItem key={st.id} onClick={() => { A.bulkStage([...sel], st.id); setSel(new Set()); }}>
                    <StageBadge s={st} small />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full text-[12.5px]"><Users className="size-3.5" /> Ответственный</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top">
              {getState().ws!.users.map(u => (
                <DropdownMenuItem key={u.id} onClick={() => { A.bulkOwner([...sel], u.id); setSel(new Set()); }}>
                  <UserChip id={u.id} withName />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full text-[12.5px] text-destructive hover:bg-destructive/5"
            onClick={() => { A.bulkDelete([...sel]); setSel(new Set()); }}>
            <Trash2 className="size-3.5" /> Удалить
          </Button>
          <button className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted" onClick={() => setSel(new Set())}><X className="size-4" /></button>
        </div>
      )}
    </>
  );
}

function GroupRows({ g, totalCols, collapsed, onToggle, moneyField, renderRow }: {
  g: { key: string; head: React.ReactNode; recs: Rec[] }; totalCols: number; collapsed: boolean; onToggle: () => void;
  moneyField?: Field; renderRow: (r: Rec) => React.ReactNode;
}) {
  const sum = moneyField ? g.recs.reduce((s, r) => s + (Number(r.values[moneyField.id]) || 0), 0) : 0;
  return (
    <>
      <tr className="bg-muted/40">
        <td colSpan={totalCols} className="border-b px-3 py-1.5 md:px-4">
          <button className="flex items-center gap-2 text-[12.5px]" onClick={onToggle}>
            {collapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
            {g.head}
            <span className="text-muted-foreground tnum">{g.recs.length}</span>
            {moneyField && sum > 0 && <span className="text-muted-foreground tnum">· {fmtMoney(sum)}</span>}
          </button>
        </td>
      </tr>
      {!collapsed && g.recs.map(renderRow)}
    </>
  );
}

function CellDisplay({ f, r }: { f: Field; r: Rec }) {
  if (f.type === "rollup") {
    const v = rollupValue(f, r);
    const target = f.rollup?.targetFieldId ? getState().ws!.entities.find(e2 => e2.id === f.rollup!.entityId)?.fields.find(x => x.id === f.rollup!.targetFieldId) : undefined;
    return <span className="font-medium">{f.rollup?.agg === "sum" && target?.type === "money" ? (fmtMoney(v) || "0 ₽") : v}</span>;
  }
  const v = r.values[f.id];
  if (f.type === "select") { const o = f.options?.find(x => x.id === v); return o ? <OptionBadge o={o} small /> : <span className="text-muted-foreground/60">—</span>; }
  if (f.type === "user") return v ? <UserChip id={v as string} withName /> : <span className="text-muted-foreground/60">—</span>;
  if (f.type === "checkbox") return <Checkbox checked={!!v} className="pointer-events-none" />;
  const text = displayValue(f, v, dispCtx());
  if (!text) return <span className="text-muted-foreground/60">—</span>;
  if (f.type === "url") return <a href={String(v)} target="_blank" rel="noreferrer" style={{ color: "var(--brass-ink)" }} className="hover:underline" onClick={e => e.stopPropagation()}>{text.replace(/^https?:\/\//, "")}</a>;
  return <>{text}</>;
}

export function StagePicker({ rec, entity, small }: { rec: Rec; entity: Entity; small?: boolean }) {
  const stage = entity.pipeline?.stages.find(s => s.id === rec.stageId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-md transition-transform hover:scale-[1.02]"><StageBadge s={stage} small={small} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {entity.pipeline?.stages.map(s => (
          <DropdownMenuItem key={s.id} onClick={() => A.moveStage(rec.id, s.id)}>
            <StageBadge s={s} small />
          </DropdownMenuItem>
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
        {getState().ws!.users.map(u => (
          <DropdownMenuItem key={u.id} onClick={() => A.setOwner(rec.id, u.id)}>
            <UserChip id={u.id} withName />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddFieldQuick({ entity }: { entity: Entity }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const add = () => {
    if (!label.trim()) return;
    const extra: Record<string, unknown> = {};
    if (["select", "multiselect"].includes(type)) extra.options = ["Вариант 1", "Вариант 2"].map((l, i) => ({ id: "o_q" + Date.now() + i, label: l, color: i ? "#7D8A5C" : "#BC9F5C" }));
    A.addField(entity.id, { label: label.trim(), type: type as Field["type"], inTable: true, ...extra });
    setLabel(""); setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground" title="Добавить поле">
          <Plus className="size-3.5" /> Поле
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="text-xs font-medium text-muted-foreground">Новое поле раздела</div>
        <Input autoFocus value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Название поля" className="mt-2 h-8" />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="mt-2 h-8"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-64">
            {FIELD_TYPES.filter(t => !["relation", "autonumber", "rollup"].includes(t.type)).map(t => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" className="mt-2.5 w-full" onClick={add}>Добавить</Button>
        <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">Связи и рол-апы — в «Настроить раздел».</div>
      </PopoverContent>
    </Popover>
  );
}

function ColumnsConfig({ entity: e, view }: { entity: Entity; view: View }) {
  const hidden = new Set(view.hidden ?? []);
  const toggle = (id: string) => {
    const h = new Set(hidden);
    h.has(id) ? h.delete(id) : h.add(id);
    A.updateView(e.id, view.id, { hidden: [...h] });
  };
  const groupables: { id: string; label: string }[] = [
    ...(e.pipeline ? [{ id: "__stage", label: "Стадия" }] : []),
    { id: "__owner", label: "Ответственный" },
    ...e.fields.filter(f => f.type === "select" || f.type === "user").map(f => ({ id: f.id, label: f.label })),
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Колонки и группировка">
          <SlidersHorizontal className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">Группировать по</div>
        <Select value={view.groupBy ?? "__none"} onValueChange={v => A.updateView(e.id, view.id, { groupBy: v === "__none" ? undefined : v })}>
          <SelectTrigger className="mb-2 h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none"><span className="text-muted-foreground">Без группировки</span></SelectItem>
            {groupables.map(g => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="px-1 pb-1 pt-1 text-xs font-medium text-muted-foreground">Колонки таблицы</div>
        {e.fields.filter(f => f.id !== e.titleFieldId && f.inTable !== false).map(f => (
          <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted">
            <Checkbox checked={!hidden.has(f.id)} onCheckedChange={() => toggle(f.id)} /> {f.label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// Фильтр по любому полю + сохранение набора условий своим сегментом.
import { useState } from "react";
import type { EntityCfg } from "@/lib/model";
import type { Cond } from "@/lib/filters";
import { opsFor, condLabel, OPS } from "@/lib/filters";
import { allUsers, allEntities, recordsOf, recTitle } from "@/lib/store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Filter, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function FilterBar({ entity, conds, onChange, onSave }: {
  entity: EntityCfg; conds: Cond[]; onChange: (c: Cond[]) => void; onSave: (name: string, c: Cond[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [segName, setSegName] = useState("");
  const fields = entity.fields;

  const add = () => {
    const f = fields[0];
    onChange([...conds, { fieldId: f.id, op: opsFor(f)[0].op, value: "" }]);
  };
  const patch = (i: number, p: Partial<Cond>) => onChange(conds.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const drop = (i: number) => onChange(conds.filter((_, j) => j !== i));

  const valueInput = (c: Cond, i: number) => {
    const f = c.fieldId === "__stage" ? undefined : fields.find(x => x.id === c.fieldId);
    const op = (f ? opsFor(f) : OPS.choice).find(o => o.op === c.op);
    if (!op?.needsValue) return <span className="w-[136px] shrink-0" />;
    if (c.fieldId === "__stage") {
      return (
        <Select value={c.value ?? ""} onValueChange={v => patch(i, { value: v })}>
          <SelectTrigger className="h-8 w-[136px] shrink-0 text-[12px]"><SelectValue placeholder="стадия" /></SelectTrigger>
          <SelectContent>{(entity.stages ?? []).map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (f?.type === "select") {
      return (
        <Select value={c.value ?? ""} onValueChange={v => patch(i, { value: v })}>
          <SelectTrigger className="h-8 w-[136px] shrink-0 text-[12px]"><SelectValue placeholder="значение" /></SelectTrigger>
          <SelectContent>{(f.options ?? []).map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (f?.type === "user") {
      return (
        <Select value={c.value ?? ""} onValueChange={v => patch(i, { value: v })}>
          <SelectTrigger className="h-8 w-[136px] shrink-0 text-[12px]"><SelectValue placeholder="сотрудник" /></SelectTrigger>
          <SelectContent>{allUsers().map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (f?.type === "relation") {
      const rel = allEntities().find(x => x.id === f.relationTo);
      return (
        <Select value={c.value ?? ""} onValueChange={v => patch(i, { value: v })}>
          <SelectTrigger className="h-8 w-[136px] shrink-0 text-[12px]"><SelectValue placeholder="запись" /></SelectTrigger>
          <SelectContent>{(rel ? recordsOf(rel.id) : []).slice(0, 100).map(r => <SelectItem key={r.id} value={r.id}>{recTitle(r.id)}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    const type = f?.type === "date" || f?.type === "datetime" ? "date" : f?.type === "money" || f?.type === "number" ? "number" : "text";
    return (
      <Input type={type} value={c.value ?? ""} onChange={e => patch(i, { value: e.target.value })}
        className="h-8 w-[136px] shrink-0 text-[12px]" placeholder="значение" />
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn("press inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors",
          conds.length ? "border-transparent font-medium" : "text-muted-foreground hover:border-foreground/25 hover:text-foreground")}
          style={conds.length ? { background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" } : undefined}>
          <Filter className="size-3" /> Фильтр{conds.length ? ` · ${conds.length}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[460px] p-3">
        <div className="text-[12.5px] font-semibold">Показывать записи, где</div>
        <div className="mt-2 flex flex-col gap-1.5">
          {conds.length === 0 && <p className="text-[11.5px] text-muted-foreground">Условий нет — видно всё. Добавьте первое.</p>}
          {conds.map((c, i) => {
            const f = c.fieldId === "__stage" ? undefined : fields.find(x => x.id === c.fieldId);
            const ops = f ? opsFor(f) : OPS.choice;
            return (
              <div key={i} className="flex items-center gap-1.5">
                <Select value={c.fieldId} onValueChange={v => {
                  const nf = v === "__stage" ? undefined : fields.find(x => x.id === v);
                  const nops = nf ? opsFor(nf) : OPS.choice;
                  patch(i, { fieldId: v, op: nops[0].op, value: "" });
                }}>
                  <SelectTrigger className="h-8 w-[130px] shrink-0 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!!entity.stages?.length && <SelectItem value="__stage">Стадия</SelectItem>}
                    {fields.map(f2 => <SelectItem key={f2.id} value={f2.id}>{f2.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={c.op} onValueChange={v => patch(i, { op: v as Cond["op"], value: "" })}>
                  <SelectTrigger className="h-8 w-[118px] shrink-0 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{ops.map(o => <SelectItem key={o.op} value={o.op}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                {valueInput(c, i)}
                <button onClick={() => drop(i)} className="press rounded p-1 text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
              </div>
            );
          })}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={add}><Plus className="size-3.5" /> Условие</Button>
          {conds.length > 0 && <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => onChange([])}>Сбросить</Button>}
        </div>
        {conds.length > 0 && (
          <div className="mt-3 border-t pt-2.5">
            <div className="eyebrow mb-1.5">Сохранить как свой сегмент</div>
            <div className="flex gap-1.5">
              <Input value={segName} onChange={e => setSegName(e.target.value)} placeholder={conds.map(c => condLabel(entity, c)).join(", ").slice(0, 40)}
                className="h-8 flex-1 text-[12px]" onKeyDown={e => { if (e.key === "Enter" && segName.trim()) { onSave(segName.trim(), conds); setSegName(""); setOpen(false); } }} />
              <Button size="sm" className="h-8 text-[12px]" disabled={!segName.trim()} onClick={() => { onSave(segName.trim(), conds); setSegName(""); setOpen(false); }}>Сохранить</Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

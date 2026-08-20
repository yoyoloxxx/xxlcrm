// Редактор значения поля — карточка, inline-таблица, быстрые формы
import { useState } from "react";
import type { Field } from "@/lib/model";
import { recordsOf, recTitle, allUsers, A, entityCfg } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill, UserChip } from "./bits";
import { DateInput } from "./DateInput";

export function FieldInput({ field: f, value, onChange, autoFocus, onDone }: {
  field: Field; value: unknown; onChange: (v: unknown) => void; autoFocus?: boolean; onDone?: () => void;
}) {
  const key = (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === "Escape") onDone?.(); };
  switch (f.type) {
    case "textarea":
      return <Textarea autoFocus={autoFocus} rows={3} value={String(value ?? "")} onChange={e => onChange(e.target.value)} onBlur={() => onDone?.()} placeholder="Текст…" className="text-[13px]" />;
    case "number": case "money":
      return <Input autoFocus={autoFocus} type="number" inputMode="decimal" value={value === undefined || value === null ? "" : String(value)}
        onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))} onBlur={() => onDone?.()} onKeyDown={key}
        placeholder={f.type === "money" ? "0 ₽" : "0"} className="font-mono2 tnum h-9 text-[13px]" />;
    case "date":
      return <DateInput value={value} onChange={onChange} autoFocus={autoFocus} onDone={onDone} />;
    case "datetime":
      return <DateInput value={value} onChange={onChange} withTime autoFocus={autoFocus} onDone={onDone} />;
    case "select":
      return (
        <Select value={(value as string) ?? "__none"} onValueChange={v => { onChange(v === "__none" ? undefined : v); onDone?.(); }}>
          <SelectTrigger autoFocus={autoFocus} className="h-9 text-[13px]"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none"><span className="text-muted-foreground">Не выбрано</span></SelectItem>
            {f.options?.map(o => <SelectItem key={o.id} value={o.id}><Pill o={o} small /></SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "user":
      return (
        <Select value={(value as string) ?? "__none"} onValueChange={v => { onChange(v === "__none" ? undefined : v); onDone?.(); }}>
          <SelectTrigger autoFocus={autoFocus} className="h-9 text-[13px]"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none"><span className="text-muted-foreground">Не назначен</span></SelectItem>
            {allUsers().map(u => <SelectItem key={u.id} value={u.id}><UserChip id={u.id} withName /></SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "relation":
      return <RelationInput f={f} value={value} onChange={onChange} autoFocus={autoFocus} onDone={onDone} />;
    default:
      return <Input autoFocus={autoFocus} type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
        value={String(value ?? "")} onChange={e => onChange(e.target.value)} onBlur={() => onDone?.()} onKeyDown={key}
        placeholder={f.type === "phone" ? "+7 …" : "Текст…"} className="h-9 text-[13px]" />;
  }
}

// Связанная запись: нового клиента заводим ПРЯМО ЗДЕСЬ, не выбрасывая человека из недозаполненной карточки
function RelationInput({ f, value, onChange, autoFocus, onDone }: {
  f: Field; value: unknown; onChange: (v: unknown) => void; autoFocus?: boolean; onDone?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const targets = recordsOf(f.relationTo ?? "");
  const relEnt = f.relationTo ? entityCfg(f.relationTo) : undefined;
  if (creating && f.relationTo && relEnt) {
    const save = () => {
      if (!name.trim()) { setCreating(false); return; }
      const id = A.createRecord(f.relationTo!, { [relEnt.titleFieldId]: name.trim() });
      onChange(id); setName(""); setCreating(false); onDone?.();
    };
    return (
      <div className="flex items-center gap-1.5">
        <Input autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setCreating(false); setName(""); } }}
          placeholder={`Имя — новый ${relEnt.name.toLowerCase()}`} className="h-9 flex-1 text-[13px]" />
        <button onClick={save} className="press h-9 shrink-0 rounded-md px-2.5 text-[12.5px] font-medium text-primary-foreground" style={{ background: "hsl(var(--primary))" }}>ОК</button>
        <button onClick={() => { setCreating(false); setName(""); }} className="press h-9 shrink-0 rounded-md border px-2 text-[12.5px] text-muted-foreground">Отмена</button>
      </div>
    );
  }
  return (
        <Select value={(value as string) ?? "__none"} onValueChange={v => {
          if (v === "__new" && f.relationTo) { setCreating(true); return; }
          onChange(v === "__none" ? undefined : v); onDone?.();
        }}>
          <SelectTrigger autoFocus={autoFocus} className="h-9 text-[13px]"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="__none"><span className="text-muted-foreground">Не выбрано</span></SelectItem>
            {targets.map(r => <SelectItem key={r.id} value={r.id}>{recTitle(r.id)}</SelectItem>)}
            {f.relationTo && <SelectItem value="__new"><span className="font-medium" style={{ color: "var(--brass-ink)" }}>＋ Создать {relEnt?.name ?? "запись"}</span></SelectItem>}
          </SelectContent>
        </Select>
      );
}

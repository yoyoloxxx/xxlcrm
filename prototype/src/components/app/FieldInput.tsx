// Универсальный редактор значения поля — используется в карточке, таблице (inline) и быстрых формах
import { useState } from "react";
import type { Field } from "@/lib/model";
import { getState } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { OptionBadge, UserChip } from "./bits";
import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils";

const toDateInput = (ts?: unknown) => { if (!ts) return ""; const d = new Date(Number(ts)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const toDT = (ts?: unknown) => { if (!ts) return ""; const d = new Date(Number(ts)); return toDateInput(ts) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

export function FieldInput({ field: f, value, onChange, autoFocus, onDone }: {
  field: Field; value: unknown; onChange: (v: unknown) => void; autoFocus?: boolean; onDone?: () => void;
}) {
  const ws = getState().ws!;
  const done = (e?: React.KeyboardEvent) => { if (!e || e.key === "Enter") onDone?.(); if (e?.key === "Escape") onDone?.(); };

  switch (f.type) {
    case "textarea":
      return <Textarea autoFocus={autoFocus} rows={3} value={String(value ?? "")} onChange={e => onChange(e.target.value)} onBlur={() => onDone?.()} placeholder="Текст…" />;
    case "number": case "money":
      return <Input autoFocus={autoFocus} type="number" inputMode="decimal" value={value === undefined || value === null ? "" : String(value)}
        onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))} onBlur={() => onDone?.()} onKeyDown={done}
        placeholder={f.type === "money" ? "0 ₽" : "0"} className="tnum" />;
    case "date":
      return <Input autoFocus={autoFocus} type="date" value={toDateInput(value)} onChange={e => onChange(e.target.value ? new Date(e.target.value + "T12:00").getTime() : undefined)} onBlur={() => onDone?.()} />;
    case "datetime":
      return <Input autoFocus={autoFocus} type="datetime-local" value={toDT(value)} onChange={e => onChange(e.target.value ? new Date(e.target.value).getTime() : undefined)} onBlur={() => onDone?.()} />;
    case "checkbox":
      return <div className="flex h-9 items-center"><Switch checked={!!value} onCheckedChange={v => { onChange(v); onDone?.(); }} /></div>;
    case "rating":
      return (
        <div className="flex h-9 items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" className="p-0.5" onClick={() => { onChange(n === value ? undefined : n); onDone?.(); }}>
              <Star className={cn("size-[17px]", Number(value) >= n ? "fill-[#BC9F5C] stroke-[#BC9F5C]" : "stroke-muted-foreground/50")} />
            </button>
          ))}
        </div>
      );
    case "select": {
      return (
        <Select value={(value as string) ?? "__none"} onValueChange={v => { onChange(v === "__none" ? undefined : v); onDone?.(); }}>
          <SelectTrigger autoFocus={autoFocus}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none"><span className="text-muted-foreground">Не выбрано</span></SelectItem>
            {f.options?.map(o => <SelectItem key={o.id} value={o.id}><OptionBadge o={o} small /></SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case "multiselect": {
      const sel = (value as string[] | undefined) ?? [];
      return (
        <Popover onOpenChange={o => { if (!o) onDone?.(); }}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-9 w-full justify-start gap-1 overflow-hidden font-normal">
              {sel.length === 0 ? <span className="text-muted-foreground">Выбрать…</span> : sel.map(id => <OptionBadge key={id} o={f.options?.find(o => o.id === id)} small />)}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            {f.options?.map(o => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <Checkbox checked={sel.includes(o.id)} onCheckedChange={c => onChange(c ? [...sel, o.id] : sel.filter(x => x !== o.id))} />
                <OptionBadge o={o} small />
              </label>
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case "tags": {
      const tags = (value as string[] | undefined) ?? [];
      return <TagsInput tags={tags} onChange={onChange as (v: string[]) => void} autoFocus={autoFocus} onDone={onDone} />;
    }
    case "user":
      return (
        <Select value={(value as string) ?? "__none"} onValueChange={v => { onChange(v === "__none" ? undefined : v); onDone?.(); }}>
          <SelectTrigger autoFocus={autoFocus}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none"><span className="text-muted-foreground">Не назначен</span></SelectItem>
            {ws.users.map(u => <SelectItem key={u.id} value={u.id}><UserChip id={u.id} withName /></SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "relation": {
      const targets = ws.records.filter(r => r.entityId === f.relationTo);
      const te = ws.entities.find(e => e.id === f.relationTo);
      const title = (rid: string) => { const r = targets.find(x => x.id === rid); return r ? String(r.values[te!.titleFieldId] ?? `${te!.name} №${r.num}`) || `${te!.name} №${r.num}` : ""; };
      return (
        <Select value={(value as string) ?? "__none"} onValueChange={v => { onChange(v === "__none" ? undefined : v); onDone?.(); }}>
          <SelectTrigger autoFocus={autoFocus}><SelectValue placeholder={te ? te.name : "—"} /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="__none"><span className="text-muted-foreground">Не выбрано</span></SelectItem>
            {targets.map(r => <SelectItem key={r.id} value={r.id}>{te?.icon} {title(r.id)}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case "autonumber":
      return <div className="flex h-9 items-center px-1 text-sm text-muted-foreground tnum">присваивается автоматически</div>;
    case "rollup":
      return <div className="flex h-9 items-center px-1 text-sm text-muted-foreground">считается по связям автоматически</div>;
    default:
      return <Input autoFocus={autoFocus} type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
        value={String(value ?? "")} onChange={e => onChange(e.target.value)} onBlur={() => onDone?.()} onKeyDown={done}
        placeholder={f.type === "phone" ? "+7 …" : f.type === "url" ? "https://…" : "Текст…"} />;
  }
}

function TagsInput({ tags, onChange, autoFocus, onDone }: { tags: string[]; onChange: (v: string[]) => void; autoFocus?: boolean; onDone?: () => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1">
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
          {t}
          <button type="button" onClick={() => onChange(tags.filter(x => x !== t))}><X className="size-3 opacity-60" /></button>
        </span>
      ))}
      <input
        autoFocus={autoFocus} value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && draft.trim()) { onChange([...tags, draft.trim()]); setDraft(""); }
          else if (e.key === "Enter") onDone?.();
          if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
          if (e.key === "Escape") onDone?.();
        }}
        onBlur={() => { if (draft.trim()) { onChange([...tags, draft.trim()]); setDraft(""); } onDone?.(); }}
        placeholder={tags.length ? "" : "Тег + Enter"}
        className="min-w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

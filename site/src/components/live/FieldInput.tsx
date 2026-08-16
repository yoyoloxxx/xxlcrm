// Редактор значения поля — карточка, inline-таблица, быстрые формы
import type { Field } from "@/lib/model";
import { recordsOf, recTitle, USERS } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill, UserChip } from "./bits";

const toDateInput = (ts?: unknown) => { if (!ts) return ""; const d = new Date(Number(ts)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

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
      return <Input autoFocus={autoFocus} type="date" value={toDateInput(value)}
        onChange={e => onChange(e.target.value ? new Date(e.target.value + "T12:00").getTime() : undefined)} onBlur={() => onDone?.()} className="h-9 text-[13px]" />;
    case "datetime":
      return <Input autoFocus={autoFocus} type="datetime-local"
        value={value ? toDateInput(value) + "T" + new Date(Number(value)).toTimeString().slice(0, 5) : ""}
        onChange={e => onChange(e.target.value ? new Date(e.target.value).getTime() : undefined)} onBlur={() => onDone?.()} className="h-9 text-[13px]" />;
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
            {USERS.map(u => <SelectItem key={u.id} value={u.id}><UserChip id={u.id} withName /></SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "relation": {
      const targets = recordsOf(f.relationTo ?? "");
      return (
        <Select value={(value as string) ?? "__none"} onValueChange={v => { onChange(v === "__none" ? undefined : v); onDone?.(); }}>
          <SelectTrigger autoFocus={autoFocus} className="h-9 text-[13px]"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="__none"><span className="text-muted-foreground">Не выбрано</span></SelectItem>
            {targets.map(r => <SelectItem key={r.id} value={r.id}>{recTitle(r.id)}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    default:
      return <Input autoFocus={autoFocus} type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
        value={String(value ?? "")} onChange={e => onChange(e.target.value)} onBlur={() => onDone?.()} onKeyDown={key}
        placeholder={f.type === "phone" ? "+7 …" : "Текст…"} className="h-9 text-[13px]" />;
  }
}

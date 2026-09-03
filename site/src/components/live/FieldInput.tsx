// Редактор значения поля — карточка, inline-таблица, быстрые формы
import { useState } from "react";
import type { Field, Rec } from "@/lib/model";
import { asBool, selectedOptionIds } from "@/lib/model";
import { recordsOf, recTitle, recById, allUsers, A, entityCfg, normalizePhoneView } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpRight, ChevronsUpDown, MessageCircle, Phone, Send } from "lucide-react";
import { Pill, UserChip } from "./bits";
import { DateInput } from "./DateInput";
import { cn } from "@/lib/utils";

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
    case "multiselect":
      return <MultiSelectInput f={f} value={value} onChange={onChange} autoFocus={autoFocus} onDone={onDone} />;
    case "checkbox": {
      // «Да/нет»: один клик — и в базе честный boolean (импортированное «да»/«1» читается как «да»)
      const on = asBool(value);
      return (
        <label className="inline-flex h-9 w-fit max-w-full cursor-pointer select-none items-center gap-2 rounded-md border px-2.5 text-[13px] transition-colors hover:border-foreground/30">
          <Checkbox checked={on} autoFocus={autoFocus} aria-label={f.label}
            onCheckedChange={v => { onChange(!!v); onDone?.(); }}
            onKeyDown={e => { if (e.key === "Escape") onDone?.(); }} />
          <span className={on ? "" : "text-muted-foreground"}>{on ? "Да" : "Нет"}</span>
        </label>
      );
    }
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
    case "phone":
      // рядом с номером — позвонить / WhatsApp / Telegram, как только он стал похож на телефон
      return (
        <div className="flex min-w-0 items-center gap-1">
          <Input autoFocus={autoFocus} type="tel" inputMode="tel" value={String(value ?? "")} onChange={e => onChange(e.target.value)}
            onBlur={() => onDone?.()} onKeyDown={key} placeholder="+7 …" className="h-9 min-w-0 flex-1 text-[13px]" />
          <PhoneLinks value={value} />
        </div>
      );
    default:
      return <Input autoFocus={autoFocus} type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
        value={String(value ?? "")} onChange={e => onChange(e.target.value)} onBlur={() => onDone?.()} onKeyDown={key}
        placeholder="Текст…" className="h-9 text-[13px]" />;
  }
}

// Телефон как телефон: три маленькие ссылки — набрать, написать в WhatsApp, написать в Telegram.
// Клик по ним не должен открывать редактор ячейки или карточку — гасим всплытие.
export function PhoneLinks({ value, className }: { value: unknown; className?: string }) {
  const p = normalizePhoneView(value);
  if (!p) return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const cls = "press grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5", className)} onClick={stop} data-phone-links>
      <a href={p.tel} title="Позвонить" aria-label="Позвонить" className={cls} onClick={stop}><Phone className="size-3.5" /></a>
      <a href={p.wa} target="_blank" rel="noreferrer" title="Написать в WhatsApp" aria-label="Написать в WhatsApp" className={cls} onClick={stop}><MessageCircle className="size-3.5" /></a>
      <a href={p.tg} target="_blank" rel="noreferrer" title="Написать в Telegram" aria-label="Написать в Telegram" className={cls} onClick={stop}><Send className="size-3.5" /></a>
    </span>
  );
}

// «Несколько из списка»: чипы-варианты, клик переключает; в базе — массив id вариантов
function MultiSelectInput({ f, value, onChange, autoFocus, onDone }: {
  f: Field; value: unknown; onChange: (v: unknown) => void; autoFocus?: boolean; onDone?: () => void;
}) {
  const opts = f.options ?? [];
  const sel = selectedOptionIds(f, value);
  const toggle = (id: string) => onChange(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  if (!opts.length) {
    return <div className="flex h-9 items-center text-[12px] text-muted-foreground">Вариантов пока нет — добавьте их в «Настроить раздел → Поля»</div>;
  }
  return (
    <div role="group" aria-label={f.label} className="flex min-h-9 flex-wrap items-center gap-1 py-1"
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDone?.(); }}
      onKeyDown={e => { if (e.key === "Escape" || e.key === "Enter") onDone?.(); }}>
      {opts.map((o, i) => {
        const on = sel.includes(o.id);
        return (
          <button key={o.id} type="button" role="checkbox" aria-checked={on} autoFocus={autoFocus && i === 0} onClick={() => toggle(o.id)}
            className={cn("press inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-[11.5px] font-medium transition-colors",
              !on && "border-dashed text-muted-foreground hover:border-foreground/30 hover:text-foreground")}
            style={on ? { background: o.color + "18", borderColor: o.color + "50", color: "hsl(var(--foreground) / 0.9)" } : undefined}>
            <span className="size-1.5 rounded-full" style={{ background: on ? o.color : "hsl(var(--muted-foreground) / 0.4)" }} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Связанная запись: комбобокс с поиском по имени и телефону (справочник на тысячу клиентов
// в обычном выпадашке не пролистать). Нового клиента заводим ПРЯМО ЗДЕСЬ, не выбрасывая
// человека из недозаполненной карточки. Рядом — «открыть карточку» и телефон выбранного.
export function RelationInput({ f, value, onChange, autoFocus, onDone, exclude, noCreate }: {
  f: Field; value: unknown; onChange: (v: unknown) => void; autoFocus?: boolean; onDone?: () => void;
  exclude?: string[]; noCreate?: boolean;
}) {
  const [open, setOpen] = useState(!!autoFocus);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const relEnt = f.relationTo ? entityCfg(f.relationTo) : undefined;
  const targets = recordsOf(f.relationTo ?? "").filter(r => !exclude?.includes(r.id));
  const phoneF = relEnt?.fields.find(x => x.type === "phone");
  const phoneOf = (r: Rec | undefined) => (r && phoneF ? String(r.values[phoneF.id] ?? "").trim() : "");
  const needle = q.trim().toLowerCase();
  const qd = needle.replace(/\D/g, "");
  const matches = needle
    ? targets.filter(r => recTitle(r.id).toLowerCase().includes(needle) || (qd.length >= 3 && phoneOf(r).replace(/\D/g, "").includes(qd)))
    : targets;
  const LIMIT = 30;
  const shown = matches.slice(0, LIMIT);
  const cur = typeof value === "string" && value ? recById(value) : undefined;
  const pick = (id?: string) => { onChange(id); setOpen(false); setQ(""); onDone?.(); };
  const createNow = (title: string) => {
    if (!f.relationTo || !relEnt || !title.trim()) return;
    const id = A.createRecord(f.relationTo, { [relEnt.titleFieldId]: title.trim() });
    pick(id);
  };

  if (creating && f.relationTo && relEnt) {
    const save = () => {
      if (!name.trim()) { setCreating(false); return; }
      createNow(name); setName(""); setCreating(false);
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
  const row = "press flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-muted";
  const curPhone = phoneOf(cur);
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) { setQ(""); if (autoFocus) onDone?.(); } }}>
          <PopoverTrigger asChild>
            <button type="button" role="combobox" aria-expanded={open} aria-label={f.label} autoFocus={autoFocus}
              className="flex h-9 min-w-0 flex-1 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 text-[13px] shadow-sm transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <span className={cn("truncate", !cur && "text-muted-foreground")}>{cur ? recTitle(cur.id) : "—"}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-1.5" data-relation-search>
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по имени или телефону…" className="h-8 text-[12.5px]"
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); if (shown[0]) pick(shown[0].id); else if (needle && !noCreate) createNow(q); }
              }} />
            <div className="mt-1 max-h-60 overflow-y-auto">
              <button type="button" onClick={() => pick(undefined)} className={cn(row, "text-muted-foreground")}>Не выбрано</button>
              {shown.map(r => (
                <button key={r.id} type="button" onClick={() => pick(r.id)} className={cn(row, r.id === value && "bg-muted font-medium")}>
                  <span className="min-w-0 flex-1 truncate">{recTitle(r.id)}</span>
                  {phoneOf(r) && <span className="font-mono2 shrink-0 text-[10.5px] text-muted-foreground">{phoneOf(r)}</span>}
                </button>
              ))}
              {matches.length > shown.length && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground">…ещё {matches.length - shown.length} — уточните поиск</div>
              )}
              {needle && !shown.length && <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground">Ничего не нашлось</div>}
            </div>
            {!noCreate && f.relationTo && (
              <button type="button" onClick={() => { if (needle) createNow(q); else { setOpen(false); setCreating(true); } }}
                className="press mt-1 flex w-full items-center rounded border-t px-2 py-1.5 text-left text-[12.5px] font-medium" style={{ color: "var(--brass-ink)" }}>
                ＋ Создать {needle ? `«${q.trim()}»` : relEnt?.name ?? "запись"}
              </button>
            )}
          </PopoverContent>
        </Popover>
        {cur && (
          <button type="button" onClick={() => A.openRecord(cur.id)} title="Открыть карточку" aria-label={`Открыть: ${recTitle(cur.id)}`}
            className="press grid size-9 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ArrowUpRight className="size-3.5" />
          </button>
        )}
      </div>
      {cur && curPhone && (
        <div className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground" data-relation-phone>
          <span className="font-mono2 truncate">{curPhone}</span>
          <PhoneLinks value={curPhone} />
        </div>
      )}
    </div>
  );
}

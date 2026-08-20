// Поле даты по-русски: дд.мм.гггг, «завтра», «+3», «пт» — и маленький календарь под рукой.
// Причина: браузерный <input type="date"> рисует mm/dd/yyyy по языку браузера, со страницы это не чинится.
import { useEffect, useRef, useState } from "react";
import { parseRuDate, parseRuTime, fmtRuDate, fmtRuTime, humanDate, startOfDay, MONTHS_SHORT } from "@/lib/rudate";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export function DateInput({ value, onChange, withTime, autoFocus, onDone, className }: {
  value: unknown; onChange: (v: number | undefined) => void; withTime?: boolean;
  autoFocus?: boolean; onDone?: () => void; className?: string;
}) {
  const ts = Number(value) || 0;
  const [text, setText] = useState(() => fmtRuDate(value));
  const [time, setTime] = useState(() => (withTime && ts ? fmtRuTime(value) : ""));
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const skipBlur = useRef(false);
  const masked = useRef(false);   // текст сейчас нарисован маской, а не набран руками

  useEffect(() => { setText(fmtRuDate(value)); if (withTime) setTime(ts ? fmtRuTime(value) : ""); }, [value, withTime, ts]);

  const push = (dayTs: number | null, timeStr = time) => {
    if (dayTs === null) { onChange(undefined); return; }
    if (!withTime) { onChange(dayTs); return; }
    const mins = parseRuTime(timeStr);
    const d = new Date(dayTs);
    onChange(new Date(d.getFullYear(), d.getMonth(), d.getDate(), mins === null ? 12 : Math.floor(mins / 60), mins === null ? 0 : mins % 60).getTime());
  };

  // Возвращает, удалось ли разобрать: при неудаче редактор НЕ закрываем — иначе Enter
  // в таблице молча выбрасывал набранное, и человек узнавал об этом через месяц.
  const commit = (): boolean => {
    const raw = text.trim();
    if (!raw) { setBad(false); push(null); return true; }
    const parsed = parseRuDate(raw);
    if (parsed === null) { setBad(true); return false; }
    setBad(false);
    setText(fmtRuDate(parsed));
    push(parsed);
    return true;
  };

  // Ввод цифрами сам расставляет точки: 3112 → 31.12, 31122026 → 31.12.2026.
  // Маска работает, только когда цифр СТАЛО БОЛЬШЕ, иначе она съедала бы точку,
  // набранную руками, и стирание превращалось бы в борьбу с полем.
  const onType = (v: string) => {
    setBad(false);
    const before = text.replace(/\D/g, "");
    const d = v.replace(/\D/g, "");
    // Маска включается, только когда человек набирает ОДНИ ЦИФРЫ — свои или продолжая уже
    // нарисованное маской. Если он печатает точки сам («6.5.1990»), не трогаем: раньше маска
    // съедала его точку и получалось «65.19.90».
    const onlyDigits = /^\d*$/.test(v);
    const continuing = masked.current && v.startsWith(text) && /^\d+$/.test(v.slice(text.length));
    if (d.length > before.length && d.length <= 8 && (onlyDigits || continuing)) {
      masked.current = true;
      if (d.length >= 5) return setText(`${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`);
      if (d.length >= 3) return setText(`${d.slice(0, 2)}.${d.slice(2)}`);
      return setText(d);
    }
    masked.current = false;
    setText(v);
  };

  const hint = (() => {
    if (bad) return { text: "Не понял дату. Например: 31.12.2026, завтра, +3, пт", tone: "bad" as const };
    const parsed = text.trim() ? parseRuDate(text.trim()) : null;
    if (parsed !== null) return { text: humanDate(parsed), tone: "ok" as const };
    return null;
  })();

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5">
        <Input autoFocus={autoFocus} value={text} inputMode="numeric" placeholder="дд.мм.гггг"
          aria-label="Дата" aria-invalid={bad || undefined}
          onChange={e => onType(e.target.value)}
          onBlur={() => {
            if (skipBlur.current) { skipBlur.current = false; return; }
            const okDate = commit();
            if (!okDate) toast.warning("Дату не понял — значение не сохранено", { description: `«${text.trim()}». Например: 31.12.2026, завтра, +3, пт` });
            if (!withTime) onDone?.();
          }}
          onKeyDown={e => {
            if (e.key === "Enter") { if (commit()) onDone?.(); }
            if (e.key === "Escape") { setText(fmtRuDate(value)); setBad(false); onDone?.(); }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              const cur = parseRuDate(text.trim()) ?? startOfDay(new Date());
              e.preventDefault();
              const next = cur + (e.key === "ArrowUp" ? 86400000 : -86400000);
              setText(fmtRuDate(next)); push(next);
            }
          }}
          className={cn("font-mono2 h-9 flex-1 text-[13px]", bad && "border-destructive")} />
        {withTime && (
          <Input value={time} placeholder="чч:мм" inputMode="numeric" aria-label="Время"
            onChange={e => setTime(e.target.value)}
            onBlur={() => { const d = parseRuDate(text.trim()); if (d !== null) push(d, time); onDone?.(); }}
            onKeyDown={e => { if (e.key === "Enter") { const d = parseRuDate(text.trim()); if (d !== null) push(d, time); onDone?.(); } }}
            className="font-mono2 h-9 w-[74px] shrink-0 text-[13px]" />
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Открыть календарь" title="Календарь"
              onMouseDown={() => { skipBlur.current = true; }}
              className="press grid h-9 w-9 shrink-0 place-items-center rounded-md border text-muted-foreground hover:text-foreground">
              <CalendarDays className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-2">
            <MiniCal value={parseRuDate(text.trim()) ?? ts ?? 0} onPick={d => { setText(fmtRuDate(d)); setBad(false); push(d); setOpen(false); if (!withTime) onDone?.(); }} />
          </PopoverContent>
        </Popover>
      </div>
      {hint && (
        <span className={cn("text-[10.5px] leading-tight", hint.tone === "bad" ? "text-destructive" : "text-muted-foreground")}>{hint.text}</span>
      )}
      {!text.trim() && !bad && (
        <div className="flex flex-wrap gap-1">
          {[["сегодня", 0], ["завтра", 1], ["+3 дня", 3], ["через неделю", 7]].map(([label, off]) => (
            <button key={String(label)} type="button" onMouseDown={e => e.preventDefault()}
              onClick={() => { const d = startOfDay(new Date(Date.now() + Number(off) * 86400000)); setText(fmtRuDate(d)); push(d); }}
              className="press rounded border px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground">{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniCal({ value, onPick }: { value: number; onPick: (ts: number) => void }) {
  const base = value ? new Date(value) : new Date();
  const [ym, setYm] = useState(() => ({ y: base.getFullYear(), m: base.getMonth() }));
  const first = new Date(ym.y, ym.m, 1);
  const shift = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => new Date(ym.y, ym.m, i - shift + 1));
  const k = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = k(new Date());
  const cur = value ? k(new Date(value)) : "";
  const step = (n: number) => setYm(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  return (
    <div className="w-[236px]">
      <div className="mb-1 flex items-center gap-1">
        <button type="button" aria-label="Предыдущий месяц" onClick={() => step(-1)} className="press h-7 w-7 rounded-md border text-[12px] text-muted-foreground">‹</button>
        <span className="flex-1 text-center text-[12.5px] font-medium capitalize">{MONTHS[ym.m]} {ym.y}</span>
        <button type="button" aria-label="Следующий месяц" onClick={() => step(1)} className="press h-7 w-7 rounded-md border text-[12px] text-muted-foreground">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(w => <div key={w} className="text-center text-[9.5px] text-muted-foreground">{w}</div>)}
        {cells.map((d, i) => {
          const inM = d.getMonth() === ym.m;
          return (
            <button key={i} type="button" onClick={() => onPick(startOfDay(d))}
              aria-label={`${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`}
              className={cn("font-mono2 h-7 rounded text-[11.5px] transition-colors hover:bg-foreground/10",
                !inM && "text-muted-foreground/40", k(d) === today && "font-bold", k(d) === cur && "text-primary-foreground")}
              style={k(d) === cur ? { background: "hsl(var(--primary))" } : k(d) === today ? { color: "var(--brass-ink)" } : undefined}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

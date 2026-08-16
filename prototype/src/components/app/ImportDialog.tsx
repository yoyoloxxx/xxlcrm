// Импорт CSV/TSV: вставка или файл → маппинг колонок → дедуп по телефону/email
import { useMemo, useState } from "react";
import { A, entityById } from "@/lib/store";
import type { Field } from "@/lib/model";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileUp } from "lucide-react";

function parseTable(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes("\t") ? "\t" : (firstLine.split(";").length > firstLine.split(",").length ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

function coerce(f: Field, raw: string): unknown {
  const v = raw.trim();
  if (!v) return undefined;
  switch (f.type) {
    case "number": case "money": case "rating": {
      const n = Number(v.replace(/[\s₽руб.]/gi, "").replace(",", "."));
      return isNaN(n) ? undefined : n;
    }
    case "checkbox": return /^(1|да|true|yes|\+)$/i.test(v);
    case "date": case "datetime": {
      const m = v.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
      const d = m ? new Date(Number(m[3].length === 2 ? "20" + m[3] : m[3]), Number(m[2]) - 1, Number(m[1]), 12) : new Date(v);
      return isNaN(d.getTime()) ? undefined : d.getTime();
    }
    case "select": {
      const o = f.options?.find(o => o.label.toLowerCase() === v.toLowerCase());
      return o?.id;
    }
    case "tags": case "multiselect": {
      const parts = v.split(/[;,]/).map(x => x.trim()).filter(Boolean);
      if (f.type === "tags") return parts;
      return parts.map(p => f.options?.find(o => o.label.toLowerCase() === p.toLowerCase())?.id).filter(Boolean);
    }
    case "relation": case "user": case "rollup": case "autonumber": return undefined;
    default: return v;
  }
}

export function ImportDialog({ entityId, open, onOpenChange }: { entityId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const e = entityById(entityId)!;
  const [text, setText] = useState("");
  const [mapping, setMapping] = useState<Record<number, string>>({});

  const rows = useMemo(() => parseTable(text), [text]);
  const header = rows[0] ?? [];
  const body = rows.slice(1);

  const importable = e.fields.filter(f => !["rollup", "autonumber", "relation", "user"].includes(f.type));

  const guess = (h: string): string => {
    const hl = h.trim().toLowerCase();
    const hit = importable.find(f => f.label.toLowerCase() === hl)
      ?? importable.find(f => hl && (f.label.toLowerCase().includes(hl) || hl.includes(f.label.toLowerCase())))
      ?? (/(тел|phone)/.test(hl) ? importable.find(f => f.type === "phone") : undefined)
      ?? (/(почта|mail)/.test(hl) ? importable.find(f => f.type === "email") : undefined)
      ?? (/(имя|назв|name|фио|клиент)/.test(hl) ? importable.find(f => f.id === e.titleFieldId) : undefined)
      ?? (/(сумм|цена|бюджет|стоим)/.test(hl) ? importable.find(f => f.type === "money") : undefined);
    return hit?.id ?? "__skip";
  };
  const colMap = (i: number) => mapping[i] ?? guess(header[i] ?? "");

  const setFile = (file: File) => {
    const rd = new FileReader();
    rd.onload = () => setText(String(rd.result ?? ""));
    rd.readAsText(file, "utf-8");
  };

  const run = () => {
    // резолвим колонки один раз (в т.ч. создаём новые поля единожды)
    const resolved = header.map((h, i) => {
      const m = colMap(i);
      if (m !== "__new") return m;
      const nf = A.addField(entityId, { label: h.trim() || `Колонка ${i + 1}`, type: "text", inTable: true });
      return nf.id;
    });
    const values = body.map(r => {
      const v: Record<string, unknown> = {};
      r.forEach((cell, i) => {
        const fid = resolved[i];
        if (!fid || fid === "__skip") return;
        const f = e.fields.find(x => x.id === fid);
        if (f) v[f.id] = coerce(f, cell);
      });
      return v;
    }).filter(v => Object.values(v).some(x => x !== undefined && x !== ""));
    const { added, dupes } = A.importRecords(entityId, values);
    toast.success(`Импортировано: ${added}${dupes ? ` · пропущено дублей: ${dupes}` : ""}`);
    onOpenChange(false); setText(""); setMapping({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle className="text-[15px]">Импорт в «{e.namePlural}»</DialogTitle></DialogHeader>
        <p className="-mt-1 text-[12.5px] leading-snug text-muted-foreground">
          Вставьте таблицу (скопируйте ячейки прямо из Excel / Google Sheets) или выберите CSV-файл. Первая строка — заголовки.
        </p>
        <div className="flex items-center gap-2">
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px] text-muted-foreground hover:bg-muted">
            <FileUp className="size-4" /> CSV-файл
            <input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={ev => ev.target.files?.[0] && setFile(ev.target.files[0])} />
          </label>
          <span className="text-[12px] text-muted-foreground">или вставьте ниже</span>
        </div>
        <Textarea rows={5} value={text} onChange={ev => setText(ev.target.value)} placeholder={"Имя\tТелефон\tСумма\nИван Петров\t+7 912 000-00-00\t50000"} className="font-mono text-[12px]" />

        {header.length > 0 && (
          <>
            <div className="text-[12.5px] font-medium">Сопоставление колонок ({body.length} строк данных)</div>
            <div className="flex flex-col gap-1.5">
              {header.map((h, i) => (
                <div key={i} className="grid grid-cols-[1fr_20px_1fr] items-center gap-2">
                  <div className="truncate rounded-md bg-muted px-2.5 py-1.5 text-[12.5px]">
                    {h.trim() || `Колонка ${i + 1}`}
                    <span className="ml-2 text-muted-foreground">{body[0]?.[i]?.slice(0, 18)}</span>
                  </div>
                  <span className="text-center text-muted-foreground">→</span>
                  <Select value={colMap(i)} onValueChange={v => setMapping(m => ({ ...m, [i]: v }))}>
                    <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip"><span className="text-muted-foreground">— пропустить</span></SelectItem>
                      <SelectItem value="__new">+ создать поле «{h.trim() || `Колонка ${i + 1}`}»</SelectItem>
                      {importable.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button onClick={run} disabled={!body.length}>Импортировать {body.length} строк</Button>
            <p className="-mt-1 text-[11.5px] text-muted-foreground">Дубли по телефону и email будут пропущены автоматически. Отмена — Ctrl+Z.</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

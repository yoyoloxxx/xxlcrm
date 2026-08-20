// Импорт из Excel/другой CRM: файл → сам разбираю кодировку и разделитель → сопоставление колонок → дедуп.
// Смысл: человек должен увидеть в CRM СВОИХ клиентов за пару минут, иначе переезжать он не станет.
import { useMemo, useRef, useState } from "react";
import type { EntityCfg } from "@/lib/model";
import { plural } from "@/lib/model";
import { A, allUsers, useApp, storageFits } from "@/lib/store";
import { decodeFile, guessDelimiter, parseCSV, HEADER_HINTS } from "@/lib/csv";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUp, Table2 } from "lucide-react";
import { toast } from "sonner";

const SKIP = "__skip";
const STAGE = "__stage";

// какое поле подставить колонке по её заголовку
function guessField(header: string, e: EntityCfg): string {
  const h = header.trim();
  // Точное совпадение заголовка с названием поля — важнее любых догадок: иначе свой же
  // экспорт «Сделок» возвращался с колонкой «Клиент», подставленной в название сделки.
  const exactFirst = e.fields.find(f => f.label.toLowerCase() === h.toLowerCase());
  if (exactFirst) return exactFirst.id;
  if (e.stages?.length && /^стади/i.test(h)) return STAGE;
  for (const hint of HEADER_HINTS) {
    if (!hint.re.test(h)) continue;
    if (hint.type.includes("__stage") && e.stages?.length) return STAGE;
    const byId = hint.ids?.map(id => e.fields.find(f => f.id === id)).find(Boolean);
    if (byId) return byId.id;
    const byType = e.fields.find(f => hint.type.includes(f.type) && f.id !== e.titleFieldId);
    if (byType) return byType.id;
  }
  const exact = e.fields.find(f => f.label.toLowerCase() === h.toLowerCase());
  return exact ? exact.id : SKIP;
}

export function ImportDialog({ entity, open, onOpenChange }: { entity: EntityCfg; open: boolean; onOpenChange: (o: boolean) => void }) {
  useApp();
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<string[]>([]);
  const [merge, setMerge] = useState(true);
  const [stageId, setStageId] = useState<string>(entity.stages?.[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setMapping([]); setFileName(""); };
  const load = async (file: File) => {
    try {
      const text = decodeFile(await file.arrayBuffer());
      const parsed = parseCSV(text, guessDelimiter(text));
      if (!parsed.length) { toast.error("Файл пустой или не похож на таблицу"); return; }
      setRows(parsed);
      setFileName(file.name);
      setMapping(parsed[0].map(h => guessField(h, entity)));
      setHasHeader(true);
    } catch {
      toast.error("Не смог прочитать файл", { description: "Сохраните из Excel как CSV и попробуйте снова" });
    }
  };

  const header = rows[0] ?? [];
  const body = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);
  const phoneCol = mapping.findIndex(m => entity.fields.find(f => f.id === m)?.type === "phone");
  const mapped = mapping.filter(m => m !== SKIP).length;

  const run = async () => {
    // Проверяем ДО создания записей: браузер даёт около 5 МБ на весь сайт, и раньше импорт
    // на 10 000 строк «успешно» проходил, а после перезагрузки от него не оставалось ничего.
    // 420 символов на запись сверх самой строки: id, поля, метки времени и запись в хронологию
    const guess = body.length * (JSON.stringify(body[0] ?? []).length + 420);
    if (!storageFits(guess)) {
      toast.error("Столько в браузер не поместится", {
        duration: 20000,
        description: `${body.length} ${plural(body.length, "строка", "строки", "строк")} — это примерно ${Math.round(guess / 1e6 * 10) / 10} МБ, а браузер хранит около 5 МБ на всё. Загрузите файл частями или перейдите в облачное пространство: там объём не ограничен.`,
      });
      setBusy(false);
      return;
    }
    // Несколько тысяч строк считаются секунды и держат поток. Сначала даём кадру нарисоваться,
    // чтобы человек видел «Загружаю…», а не думал, что окно повисло.
    setBusy(true);
    await new Promise(r => window.setTimeout(r, 40));
    const res = A.importRecords(entity.id, mapping.map(m => (m === SKIP ? null : m)), body, {
      mergeByPhone: merge && phoneCol >= 0,
      stageId: stageId || undefined,
      ownerId: ownerId || undefined,
    });
    toast.success(`Загружено: ${res.created} ${plural(res.created, "запись", "записи", "записей")}`, {
      description: [res.merged ? `объединено с существующими: ${res.merged}` : "", "Ctrl+Z отменит импорт целиком"].filter(Boolean).join(" · "),
    });
    setBusy(false);
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="flex max-h-[86vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <FileUp className="size-4" style={{ color: "var(--brass-ink)" }} /> Загрузить в «{entity.namePlural}»
          </DialogTitle>
        </DialogHeader>

        {!rows.length ? (
          <div className="px-5 py-6">
            <div onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void load(f); }}
              className="grid place-items-center rounded-lg border border-dashed px-6 py-10 text-center">
              <Table2 className="mb-2 size-6 text-muted-foreground" />
              <div className="text-[13.5px] font-medium">Перетащите файл CSV сюда</div>
              <p className="mt-1 max-w-sm text-[11.5px] leading-snug text-muted-foreground">
                Экспорт из Excel, Google Таблиц, amoCRM, Битрикс24 — подойдёт любой CSV.
                Кириллицу из Excel (windows-1251) и точку с запятой распознаю сам.
              </p>
              <Button className="mt-3 h-9" onClick={() => inputRef.current?.click()}>Выбрать файл</Button>
              <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-5 py-2.5 text-[12px]">
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground">{body.length} {plural(body.length, "строка", "строки", "строк")} · {mapped} из {header.length} колонок</span>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-muted-foreground">
                первая строка — заголовки
                <Switch checked={hasHeader} onCheckedChange={setHasHeader} />
              </label>
              <button onClick={reset} className="press text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">другой файл</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <div className="eyebrow mb-1.5">Что куда кладём</div>
              <div className="flex flex-col gap-1">
                {header.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium">{hasHeader ? h || `Колонка ${i + 1}` : `Колонка ${i + 1}`}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{body.slice(0, 2).map(r => r[i]).filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    <Select value={mapping[i] ?? SKIP} onValueChange={v => setMapping(m => m.map((x, j) => (j === i ? v : x)))}>
                      <SelectTrigger className="h-8 w-[190px] shrink-0 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>— не импортировать</SelectItem>
                        {entity.fields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                        {!!entity.stages?.length && <SelectItem value={STAGE}>Стадия</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-2 rounded-md border p-3">
                {phoneCol >= 0 && (
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-[12px]">
                    <span>
                      <span className="block font-medium">Объединять по телефону</span>
                      <span className="block text-[11px] text-muted-foreground">Если такой номер уже есть — дополню карточку, а не создам вторую</span>
                    </span>
                    <Switch checked={merge} onCheckedChange={setMerge} />
                  </label>
                )}
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  {!!entity.stages?.length && (
                    <>
                      <span className="text-muted-foreground">стадия по умолчанию</span>
                      <Select value={stageId} onValueChange={setStageId}>
                        <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{entity.stages.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </>
                  )}
                  <span className="text-muted-foreground">ответственный</span>
                  <Select value={ownerId || "__me"} onValueChange={v => setOwnerId(v === "__me" ? "" : v)}>
                    <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__me">Я</SelectItem>
                      {allUsers().map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Автоматизации на загруженные записи не срабатывают — иначе старая база породила бы сотни задач.
                  Неизвестные значения списков и новых клиентов создам на лету.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t px-5 py-3">
              <span className="text-[11.5px] text-muted-foreground">Проверьте пары слева — импорт можно отменить через Ctrl+Z</span>
              <Button className="ml-auto h-9" disabled={!body.length || !mapped || busy} onClick={() => void run()}>
                {busy ? "Загружаю…" : `Загрузить ${body.length} ${plural(body.length, "строку", "строки", "строк")}`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

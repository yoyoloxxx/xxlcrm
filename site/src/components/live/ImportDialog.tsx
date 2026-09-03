// Импорт из Excel/другой CRM: файл → сам разбираю кодировку и разделитель → сопоставление колонок → дедуп.
// Смысл: человек должен увидеть в CRM СВОИХ клиентов за пару минут, иначе переезжать он не станет.
// Переезд из amoCRM/Битрикс24 «за 15 минут»: стадии из файла сопоставляются с воронкой (и заводятся,
// если таких нет), даты создания/закрытия ложатся в карточку как были, ответственный — по имени,
// сделки находят клиентов по телефону, а «ID» из старой системы защищает от дублей при повторной загрузке.
import { useMemo, useRef, useState } from "react";
import type { EntityCfg, Field } from "@/lib/model";
import { plural } from "@/lib/model";
import { A, allUsers, allEntities, useApp, storageFits, undo } from "@/lib/store";
import {
  decodeFile, guessDelimiter, parseCSVReport, looksLikeData, HEADER_HINTS, IMPORT_TARGETS, IMPORT_SKIP,
  matchStage, guessStageKind, namePartRank,
} from "@/lib/csv";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUp, Table2 } from "lucide-react";
import { toast } from "sonner";

const SKIP = IMPORT_SKIP;
const STAGE = IMPORT_TARGETS.stage;
const NEW_STAGE = "__new";          // в таблице стадий: «создать стадию с таким названием»
const STAGE_CAP = 40;               // больше разных значений — это, скорее всего, не стадия, а свободный текст
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

// Справочник, на который ссылается поле-связь (раздел без воронки)
const relTarget = (f: Field, entities: EntityCfg[]) => entities.find(x => x.id === f.relationTo);
const isBookRel = (f: Field, entities: EntityCfg[]) => { const t = relTarget(f, entities); return !!t && !t.stages?.length; };
// куда положить «телефон клиента» из файла сделок: связь со справочником, в котором есть телефон
const relPhoneField = (e: EntityCfg, entities: EntityCfg[]) =>
  e.fields.find(f => f.type === "relation" && isBookRel(f, entities) && !!relTarget(f, entities)?.fields.some(ff => ff.type === "phone"));

// какое поле подставить колонке по её заголовку
function guessField(header: string, e: EntityCfg, entities: EntityCfg[]): string {
  const h = header.trim();
  // Точное совпадение заголовка с названием поля — важнее любых догадок: иначе свой же
  // экспорт «Сделок» возвращался с колонкой «Клиент», подставленной в название сделки.
  const exactFirst = e.fields.find(f => f.label.toLowerCase() === h.toLowerCase());
  if (exactFirst) return exactFirst.id;
  if (e.stages?.length && /^стади/i.test(h)) return STAGE;
  const isBday = (f: Field) => f.id === "bday" || /рожд|birth/i.test(f.label);
  for (const hint of HEADER_HINTS) {
    if (!hint.re.test(h)) continue;
    const byId = hint.ids?.map(id => e.fields.find(f => f.id === id || (id === "title" && f.id === e.titleFieldId))).find(Boolean);
    if (byId) return byId.id;
    for (const t of hint.type) {
      if (t === IMPORT_SKIP) return SKIP;
      if (t === STAGE || t === IMPORT_TARGETS.closed) { if (e.stages?.length) return t; continue; }
      if (t === IMPORT_TARGETS.relPhone) { if (relPhoneField(e, entities)) return t; continue; }
      if (t.startsWith("__")) return t;      // дата создания, ответственный, примечание, ID — им всегда есть куда лечь
      if (t === "relation") {
        // «Клиент»/«Контакт» → связь со справочником; «Компания» → только со справочником компаний
        const rel = e.fields.find(f => f.type === "relation" && (hint.rel
          ? hint.rel.test(relTarget(f, entities)?.name ?? "") || hint.rel.test(relTarget(f, entities)?.namePlural ?? "")
          : isBookRel(f, entities)));
        if (rel) return rel.id;
        continue;
      }
      // Обычное поле нужного типа. День рождения — только по своему хинту («рожд», «birth»):
      // раньше «Дата создания» из Битрикса ложилась клиенту в день рождения.
      const byType = e.fields.find(f => f.type === t && f.id !== e.titleFieldId && (hint.ids?.includes("bday") || !isBday(f)));
      if (byType) return byType.id;
    }
  }
  return SKIP;
}

export function ImportDialog({ entity, open, onOpenChange }: { entity: EntityCfg; open: boolean; onOpenChange: (o: boolean) => void }) {
  useApp();
  const entities = allEntities();
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<string[]>([]);
  const [merge, setMerge] = useState(true);
  const [stageId, setStageId] = useState<string>(entity.stages?.[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState<string>("");
  const [stagePick, setStagePick] = useState<Record<string, string>>({});   // ручные правки таблицы стадий
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const fieldOf = (id: string) => entity.fields.find(f => f.id === id);
  // В одно ТЕКСТОВОЕ поле можно класть несколько колонок (Имя + Отчество + Фамилия → склейка через пробел),
  // примечаний тоже может быть несколько (каждое — комментарий). Остальное — одна колонка на поле.
  const multiOk = (id: string) => id === IMPORT_TARGETS.note || ["text", "textarea"].includes(fieldOf(id)?.type ?? "");

  const reset = () => { setRows([]); setMapping([]); setFileName(""); setNotes([]); setStagePick({}); };
  const load = async (file: File) => {
    if (/\.xlsx?$/i.test(file.name)) {
      toast.error("Excel-файл (XLSX) пока не читается", {
        duration: 12000,
        description: "Откройте его в Excel: «Файл → Сохранить как → CSV UTF-8» — и загрузите CSV. Кодировку и разделитель подберу сам.",
      });
      return;
    }
    try {
      const text = decodeFile(await file.arrayBuffer());
      const { rows: parsed, warnings } = parseCSVReport(text, guessDelimiter(text));
      if (!parsed.length) { toast.error("Файл пустой или не похож на таблицу"); return; }
      setRows(parsed);
      setFileName(file.name);
      setStagePick({});
      // Файл без шапки: если первая строка похожа на данные, не съедаем первого клиента заголовком
      const header = !looksLikeData(parsed[0]);
      setHasHeader(header);
      const guessed = parsed[0].map(h => (header ? guessField(h, entity, entities) : SKIP));
      // одно поле — одна колонка: иначе второй телефон молча затирал первый (текстовые поля — исключение, они склеиваются)
      const seen = new Set<string>();
      const dedup = guessed.map(g => {
        if (g === SKIP || multiOk(g)) return g;
        if (!seen.has(g)) { seen.add(g); return g; }
        return SKIP;
      });
      const notes = [...warnings];
      if (!header) notes.push("Похоже, в файле нет строки заголовков — первая строка взята как данные");
      if (dedup.some((g, i) => g !== guessed[i])) notes.push("Несколько колонок метили в одно поле — лишние отключил, выберите вручную");
      setNotes(notes);
      setMapping(dedup);
    } catch {
      toast.error("Не смог прочитать файл", { description: "Сохраните из Excel как CSV и попробуйте снова" });
    }
  };

  const header = rows[0] ?? [];
  const body = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);
  const phoneCol = mapping.findIndex(m => fieldOf(m)?.type === "phone");
  const mapped = mapping.filter(m => m !== SKIP).length;
  const hasExt = mapping.includes(IMPORT_TARGETS.extId);
  const relPhoneF = relPhoneField(entity, entities);
  const stages = useMemo(() => entity.stages ?? [], [entity.stages]);

  // ---------- стадии в файле → стадии раздела ----------
  const stageCol = mapping.indexOf(STAGE);
  const stageValues = useMemo(() => {
    if (stageCol < 0 || !stages.length) return [] as string[];
    const seen = new Map<string, string>();   // ключ без регистра → первое написание из файла
    for (const r of body) { const v = (r[stageCol] ?? "").trim(); if (v && !seen.has(norm(v))) seen.set(norm(v), v); }
    return [...seen.values()];
  }, [body, stageCol, stages]);
  // Автоподбор: точное имя → синонимы («Успешно реализовано» = успех, «Закрыто и не реализовано» = отказ,
  // «Первичный контакт» = первая рабочая) → часть названия. Не нашли — предлагаем завести такую же стадию:
  // воронка из старой CRM переезжает целиком, а не схлопывается в «Новая».
  const autoStage = useMemo(() => {
    const out: Record<string, string> = {};
    const tooMany = stageValues.length > STAGE_CAP;
    for (const v of stageValues) out[norm(v)] = matchStage(v, stages)?.id ?? (tooMany ? (stages[0]?.id ?? "") : NEW_STAGE);
    return out;
  }, [stageValues, stages]);
  const stageFor = (v: string) => stagePick[norm(v)] ?? autoStage[norm(v)] ?? "";
  const newKind = (v: string): "open" | "won" | "lost" => { const k = guessStageKind(v); return k === "won" || k === "lost" ? k : "open"; };
  const kindWord = (k: "open" | "won" | "lost") => (k === "won" ? "успех" : k === "lost" ? "отказ" : "в работе");
  const toCreate = stageValues.filter(v => stageFor(v) === NEW_STAGE).length;

  const targetLabel = (id: string): string => {
    switch (id) {
      case STAGE: return "Стадия";
      case IMPORT_TARGETS.created: return "Дата создания (когда завели)";
      case IMPORT_TARGETS.closed: return "Дата закрытия (когда попала в стадию)";
      case IMPORT_TARGETS.owner: return "Ответственный (сотрудник)";
      case IMPORT_TARGETS.note: return "Комментарий в хронологию";
      case IMPORT_TARGETS.extId: return "ID в старой системе";
      case IMPORT_TARGETS.relPhone: return `Телефон клиента → связь «${(relPhoneF && relTarget(relPhoneF, entities)?.namePlural) || "Клиенты"}»`;
      default: return fieldOf(id)?.label ?? id;
    }
  };
  const pseudoTargets: string[] = [
    ...(stages.length ? [STAGE, IMPORT_TARGETS.closed] : []),
    IMPORT_TARGETS.created, IMPORT_TARGETS.owner, IMPORT_TARGETS.note, IMPORT_TARGETS.extId,
    ...(relPhoneF ? [IMPORT_TARGETS.relPhone] : []),
  ];

  const run = async () => {
    // Проверяем ДО создания записей: браузер даёт около 5 МБ на весь сайт, и раньше импорт
    // на 10 000 строк «успешно» проходил, а после перезагрузки от него не оставалось ничего.
    // 420 символов на запись сверх самой строки: id, поля, метки времени и запись в хронологию.
    // Меряем не по первой строке (она бывает короткой, а дальше идут полотна комментариев),
    // а по выборке из двух десятков строк по всему файлу — и берём среднее с запасом.
    const step = Math.max(1, Math.floor(body.length / 20));
    let sum = 0, seen = 0;
    for (let i = 0; i < body.length; i += step) { sum += JSON.stringify(body[i]).length; seen++; }
    const avg = seen ? sum / seen : 0;
    const guess = Math.round(body.length * (avg + 420));
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
    // Части ФИО склеиваются в порядке колонок, а Битрикс отдаёт «Имя;Фамилия;Отчество». Переставляем
    // колонки заголовка так, чтобы вышло «Пётр Сергеевич Иванов», а не «Пётр Иванов Сергеевич».
    let mapping2 = mapping, body2 = body;
    const titleCols = mapping.map((m, i) => (m === entity.titleFieldId ? i : -1)).filter(i => i >= 0);
    if (hasHeader && titleCols.length > 1) {
      const sorted = [...titleCols].sort((a, b) => namePartRank(header[a] ?? "") - namePartRank(header[b] ?? "") || a - b);
      if (sorted.some((c, k) => c !== titleCols[k])) {
        const order = mapping.map((_, i) => i);
        titleCols.forEach((c, k) => { order[c] = sorted[k]; });
        mapping2 = order.map(i => mapping[i]);
        body2 = body.map(r => order.map(i => r[i] ?? ""));
      }
    }
    const stageMap: Record<string, string> = {};
    // стадии, которых нет по названию, но которые подобрались по смыслу («Отказ по цене» → «Проиграна»):
    // об этом говорим в отчёте — человек должен знать, что это догадка, а не его выбор
    const inferred: string[] = [];
    for (const v of stageValues) {
      const pick = stageFor(v);
      stageMap[norm(v)] = pick === NEW_STAGE ? `${NEW_STAGE}:${newKind(v)}` : pick;
      const exact = stages.find(s => norm(s.label) === norm(v));
      if (stagePick[norm(v)] === undefined && pick !== NEW_STAGE && pick && exact?.id !== pick) {
        inferred.push(`«${v}» → ${stages.find(s => s.id === pick)?.label ?? ""}`);
      }
    }
    const res = A.importRecords(entity.id, mapping2.map(m => (m === SKIP ? null : m)), body2, {
      mergeByPhone: merge && phoneCol >= 0,
      stageId: stageId || undefined,
      ownerId: ownerId || undefined,
      stageMap: stageValues.length ? stageMap : undefined,
    });
    // Отчёт без умолчаний: что склеилось, что не разобралось, что завелось само.
    const parts = [
      res.merged ? `объединено с существующими${hasExt ? " (по ID или телефону)" : " по телефону"}: ${res.merged}` : "",
      res.related ? `заодно заведено связанных карточек: ${res.related}` : "",
      res.linkedByPhone ? `связано с клиентами по телефону: ${res.linkedByPhone}` : "",
      res.stagesCreated ? `заведено стадий из файла: ${res.stagesCreated}` : "",
      inferred.length ? `стадии не найдены по названию, подобрал по смыслу: ${inferred.slice(0, 5).join(", ")}` : "",
      res.notes ? `примечаний ушло в хронологию: ${res.notes}` : "",
      res.badDates ? `не понял дат: ${res.badDates} (проверьте формат — жду дд.мм.гггг, можно со временем)` : "",
      res.unknownStageRows ? `стадия не найдена у ${res.unknownStageRows} ${plural(res.unknownStageRows, "строки", "строк", "строк")} — легли в первую: ${res.unknownStages.join(", ")}` : "",
      res.ownersUnknown ? `ответственного нет в команде у ${res.ownersUnknown} ${plural(res.ownersUnknown, "строки", "строк", "строк")} — имя записал в хронологию` : "",
      res.optionsCapped ? "в колонке-списке слишком много разных значений — остальные не добавлял" : "",
      "отменить импорт целиком — Ctrl+Z или кнопка «Отменить» в этом сообщении",
    ].filter(Boolean);
    const noisy = res.badDates || res.unknownStageRows || res.optionsCapped;
    (noisy ? toast.warning : toast.success)(
      `Загружено: ${res.created} ${plural(res.created, "запись", "записи", "записей")}`,
      { duration: noisy ? 20000 : 8000, description: parts.join(" · "), action: { label: "Отменить", onClick: () => { undo(); } } },
    );
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
            <div data-migrate-hint className="mt-3 rounded-md border px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">Переезжаете из amoCRM или Битрикс24?</span> Выгрузите CSV
              (в Битриксе — «Экспорт в CSV», в amo — «Экспорт») и загрузите сначала Клиентов, потом Сделки —
              связи, стадии, даты и ответственные подберутся сами. Честно: XLSX пока не читается — пересохраните
              в Excel как CSV.
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
              {notes.length > 0 && (
                <div className="mb-2 rounded-md border px-3 py-2" style={{ background: "hsl(var(--brass) / 0.1)", borderColor: "hsl(var(--brass) / 0.5)" }}>
                  {notes.map((n, i) => <div key={i} className="text-[11.5px] leading-snug" style={{ color: "var(--brass-ink)" }}>{n}</div>)}
                </div>
              )}
              <div className="eyebrow mb-1.5">Что куда кладём</div>
              <div className="flex flex-col gap-1">
                {header.map((h, i) => (
                  <div key={i} data-import-col={i} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium">{hasHeader ? h || `Колонка ${i + 1}` : `Колонка ${i + 1}`}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{body.slice(0, 2).map(r => r[i]).filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    <Select value={mapping[i] ?? SKIP} onValueChange={v => setMapping(m => m.map((x, j) => (j === i ? v : x === v && v !== SKIP && !multiOk(v) ? SKIP : x)))}>
                      <SelectTrigger className="h-8 w-[210px] shrink-0 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>— не импортировать</SelectItem>
                        {entity.fields.filter(f => f.id !== "ext_id").map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                        {pseudoTargets.map(t => <SelectItem key={t} value={t}>{targetLabel(t)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {stageValues.length > 0 && (
                <div data-stagemap className="mt-4">
                  <div className="eyebrow mb-1.5">Стадии в файле → у вас</div>
                  <div className="flex flex-col gap-1">
                    {stageValues.map(v => (
                      <div key={v} data-stage-value={v} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-[12.5px]">{v}</div>
                        <Select value={stageFor(v)} onValueChange={id => setStagePick(p => ({ ...p, [norm(v)]: id }))}>
                          <SelectTrigger className="h-8 w-[240px] shrink-0 text-[12px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                            <SelectItem value={NEW_STAGE}>+ создать стадию «{v}» ({kindWord(newKind(v))})</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    {stageValues.length > STAGE_CAP
                      ? `В колонке ${stageValues.length} разных значений — на стадии не похоже. Что не совпало с вашими стадиями, ляжет в первую; проверьте, та ли это колонка.`
                      : toCreate
                        ? `${toCreate} ${plural(toCreate, "стадия заведётся", "стадии заведутся", "стадий заведётся")} с названием как в файле: успех и отказ распознаю по смыслу, остальные встанут в работу перед финальными.`
                        : "Все значения нашлись среди ваших стадий. Что-то не так — выберите другую или заведите новую."}
                  </p>
                </div>
              )}

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
                {hasExt && (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Колонка с ID из старой системы: при повторной загрузке того же файла строки с тем же ID дополнят
                    существующие записи, а не создадут дубли.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  {!!stages.length && (
                    <>
                      <span className="text-muted-foreground">стадия по умолчанию</span>
                      <Select value={stageId} onValueChange={setStageId}>
                        <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
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
                  {mapping.includes(IMPORT_TARGETS.owner) && (
                    <span className="text-[11px] text-muted-foreground">— для строк, где ответственный из файла не нашёлся в команде</span>
                  )}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Правило «создана запись» на загруженные строки не сработает. Но правила «застряла на стадии»
                  и «тишина N дней» увидят их при ближайшей проверке — если не хотите задач по старой базе,
                  выключите эти правила на время в «Автоматизациях». Неизвестные значения списков и новых клиентов создам на лету
                  и отчитаюсь, что именно завёл.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t px-5 py-3">
              <span className="text-[11.5px] text-muted-foreground">Проверьте пары слева — импорт можно отменить сразу после загрузки</span>
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

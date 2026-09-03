// Конструктор разделов: основное (имя/иконка/воронка/удаление), поля (14 типов), стадии.
// «Пульт мира»: пользователь собирает структуру CRM сам, всё меняется вживую и синхронизируется команде.
import { useState } from "react";
import type { Field, FieldType } from "@/lib/model";
import { FIELD_TYPES, PALETTE, SOURCES, sourceName, plural, uid } from "@/lib/model";
import { useApp, A, allEntities, recordsOf, resolveRoute, routeOf, pluralGuess } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowDown, ArrowRight, ArrowUp, GripVertical, Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import { EntIcon, ICON_NAMES } from "./icons";
import { cn } from "@/lib/utils";
import type { InboundSource } from "@/lib/model";

// подключён ли источник (короткие суффиксы — для бейджей на стадиях)
function srcOn(s: ReturnType<typeof useApp>, src: InboundSource): boolean {
  const i = s.integrations;
  if (src === "tg") return i.tg.status === "ok" || i.tgUser.status === "ok";
  if (src === "wa") return i.wa.status === "ok";
  if (src === "max") return i.max.status === "ok";
  if (src === "tilda") return i.tilda.status === "ok";
  if (src === "vk") return i.vk.status === "ok";
  if (src === "avito") return i.avito.status === "ok";
  return i.ig.status === "ok";
}
const srcShort = (s: InboundSource) => (s === "tg" ? "TG" : s === "wa" ? "WA" : s === "max" ? "MAX" : s === "ig" ? "IG" : s === "vk" ? "VK" : s === "avito" ? "Авито" : "Сайт");

// Что сломается, если тронуть раздел: маршруты приёма и правила автоматизаций смотрят сюда по id.
// Заодно СРАЗУ отвечаем «куда приходят заявки»: в какую стадию падают новые — и где это меняется.
function Dependencies({ entityId }: { entityId: string }) {
  const s = useApp();
  const routes = SOURCES.filter(src => resolveRoute(src).entity?.id === entityId && routeOf(src).auto);
  const rules = s.automations.filter(r => r.trigger.entityId === entityId);
  if (!routes.length && !rules.length) return null;
  const stageNames = [...new Set(routes.map(src => resolveRoute(src).stage?.label).filter(Boolean))] as string[];
  return (
    <div className="mx-5 mb-1 mt-3 rounded-md border border-dashed px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
      <b className="font-medium text-foreground">Сюда завязано:</b>{" "}
      {routes.length > 0 && (
        <>приём заявок из {routes.map(r => sourceName(r)).join(", ")}
        {stageNames.length > 0 && <> — падают в {stageNames.length === 1 ? <>стадию <b className="font-medium text-foreground">«{stageNames[0]}»</b></> : `стадии «${stageNames.join("», «")}»`} (настройка — во вкладке «Стадии»)</>}</>
      )}
      {routes.length > 0 && rules.length > 0 && " · "}
      {rules.length > 0 && <>{rules.length} {plural(rules.length, "правило", "правила", "правил")} автоматизаций</>}
      . Переименование безопасно; удаление стадии или раздела — подстрою и скажу что изменилось.
    </div>
  );
}

// «Куда приходят заявки» — прямо во вкладке «Стадии»: из какого канала в какую стадию,
// со сменой стадии на месте. Раздел/ответственный/«заявка сразу» — в «Приёме заявок».
const FIRST_STAGE = "__first";
function IntakePanel({ entityId, goRouting, goChannels }: { entityId: string; goRouting?: () => void; goChannels?: () => void }) {
  const s = useApp();
  const e = allEntities().find(x => x.id === entityId);
  if (!e?.stages?.length) return null;
  const here = SOURCES.filter(src => resolveRoute(src).entity?.id === entityId && routeOf(src).auto);
  const off = here.filter(src => !srcOn(s, src));
  if (!here.length) {
    const other = SOURCES.map(src => resolveRoute(src)).find(r => r.route.auto && r.entity);
    return (
      <div className="mt-4 rounded-lg border border-dashed px-3 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
        Заявки из каналов в этот раздел не падают{other?.entity ? <> — они идут в «{other.entity.namePlural}»</> : null}.
        {goRouting && <> Поменять — в <button onClick={goRouting} className="press underline underline-offset-2 hover:text-foreground">Приёме заявок</button>.</>}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-lg border p-3" data-intake>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        <RouteIcon className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Куда приходят заявки
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
        Новое сообщение в канале или заявка с сайта сами становятся записью — вот в какой стадии она появится:
      </p>
      <div className="mt-2 flex flex-col gap-1">
        {here.map(src => {
          const r = routeOf(src);
          const on = srcOn(s, src);
          return (
            <div key={src} className="flex items-center gap-2" data-intake-src={src}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: on ? "hsl(var(--brass))" : "hsl(var(--muted-foreground) / 0.35)" }} />
              <span className="min-w-0 flex-1 truncate text-[12px]">{sourceName(src)}
                <span className="ml-1.5 text-[10px] text-muted-foreground">{on ? "подключён" : "не подключён"}</span>
              </span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
              <Select value={r.stageId ?? FIRST_STAGE} onValueChange={v => A.routeUpdate(src, { stageId: v === FIRST_STAGE ? undefined : v })}>
                <SelectTrigger aria-label={`${sourceName(src)}: в какую стадию`} className="h-7 w-[150px] shrink-0 text-[11.5px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={FIRST_STAGE}>Первая — {e.stages![0].label}</SelectItem>
                  {e.stages!.map(x => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {off.length > 0 && goChannels && (
          <>{off.map(sourceName).join(", ")} {plural(off.length, "ещё не подключён", "ещё не подключены", "ещё не подключены")} — <button onClick={goChannels} className="press underline underline-offset-2 hover:text-foreground">подключить в Настройках</button>. </>
        )}
        {goRouting && <>Раздел, ответственный и «заявка сразу или только диалог» — в <button onClick={goRouting} className="press underline underline-offset-2 hover:text-foreground">Приёме заявок</button>.</>}
      </p>
    </div>
  );
}

export function ConstructorDialog({ entityId, open, onOpenChange, onDeleted, goRouting, goChannels }: {
  entityId: string; open: boolean; onOpenChange: (o: boolean) => void; onDeleted: () => void;
  goRouting?: () => void; goChannels?: () => void;
}) {
  useApp();
  const e = allEntities().find(x => x.id === entityId);
  const [confirmDel, setConfirmDel] = useState(false);
  const [dragStage, setDragStage] = useState<string | null>(null);
  const [dragField, setDragField] = useState<string | null>(null);
  const [overField, setOverField] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<number | null>(null);
  if (!e) return null;
  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setConfirmDel(false); }}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <EntIcon name={e.icon} className="size-4" style={{ color: "var(--brass-ink)" }} /> Раздел «{e.namePlural}»
          </DialogTitle>
        </DialogHeader>
        <Dependencies entityId={e.id} />
        <Tabs defaultValue="fields" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-3 grid w-fit grid-cols-3">
            <TabsTrigger value="fields">Поля</TabsTrigger>
            <TabsTrigger value="stages">Стадии</TabsTrigger>
            <TabsTrigger value="main">Основное</TabsTrigger>
          </TabsList>

          <TabsContent value="fields" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
            <div className="flex flex-col gap-1.5">
              {e.fields.map((f, i) => (
                <FieldRow key={f.id} entityId={e.id} f={f} index={i} isTitle={f.id === e.titleFieldId} first={i === 0} last={i === e.fields.length - 1}
                  drag={dragField} setDrag={setDragField} over={overField} setOver={setOverField} />
              ))}
            </div>
            <AddFieldRow entityId={e.id} />
          </TabsContent>

          <TabsContent value="stages" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
            {!e.stages?.length ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-[13px] text-muted-foreground">
                Воронка выключена — раздел работает как таблица.
                <Button variant="outline" size="sm" className="mx-auto mt-3 block h-8" onClick={() => A.entToggleStages(e.id, true)}>Включить воронку</Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  {e.stages.map((stg, i) => (
                    <div key={stg.id}
                      draggable
                      onDragStart={ev => { ev.dataTransfer.setData("text/plain", stg.id); setDragStage(stg.id); }}
                      onDragEnd={() => { setDragStage(null); setOverStage(null); }}
                      onDragOver={ev => { if (!dragStage) return; ev.preventDefault(); setOverStage(i); }}
                      onDrop={ev => { ev.preventDefault(); if (dragStage) A.stageMoveTo(e.id, dragStage, i); setDragStage(null); setOverStage(null); }}
                      className={cn("flex items-center gap-2 rounded-md border bg-background px-2 py-1.5",
                        dragStage === stg.id && "opacity-40",
                        overStage === i && dragStage && dragStage !== stg.id && "ring-1 ring-[hsl(var(--brass)/0.7)]")}>
                      <span className="cursor-grab text-muted-foreground/50 active:cursor-grabbing" title="Перетащить, чтобы поменять порядок" aria-hidden><GripVertical className="size-3.5" /></span>
                      {(() => {
                        // сюда падают новые заявки — бейдж отвечает «куда придёт» прямо у стадии
                        const intake = SOURCES.filter(src => { const rr = resolveRoute(src); return routeOf(src).auto && rr.entity?.id === e.id && rr.stage?.id === stg.id; });
                        return intake.length ? (
                          <span title={`Сюда падают новые заявки: ${intake.map(sourceName).join(", ")}`}
                            className="order-last mr-1 shrink-0 cursor-default rounded-full px-1.5 py-px text-[9px] font-medium"
                            style={{ background: "hsl(var(--brass) / 0.18)", color: "var(--brass-ink)" }}>
                            ← {intake.length > 2 ? `заявки · ${intake.length} кан.` : "заявки: " + intake.map(srcShort).join(" ")}
                          </span>
                        ) : null;
                      })()}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button aria-label={`Цвет стадии «${stg.label}»`} className="swatch h-5 w-5 shrink-0 rounded-[5px] border" style={{ background: stg.color }} title="Цвет стадии" />
                        </PopoverTrigger>
                        <PopoverContent className="w-fit p-2">
                          <div className="grid grid-cols-5 gap-1.5">
                            {PALETTE.map(c => <button key={c} aria-label={`Цвет ${c}`} className="swatch h-6 w-6 rounded-[5px]" style={{ background: c }} onClick={() => A.stageUpdate(e.id, stg.id, { color: c })} />)}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Input value={stg.label} onChange={ev => A.stageUpdate(e.id, stg.id, { label: ev.target.value })}
                        className="h-8 flex-1 border-transparent bg-transparent px-1.5 text-[13px] focus-visible:border-input" />
                      <Select value={stg.kind} onValueChange={v => A.stageUpdate(e.id, stg.id, { kind: v as "open" })}>
                        <SelectTrigger className="h-8 w-[122px] text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Рабочая</SelectItem>
                          <SelectItem value="won">Успех ✓</SelectItem>
                          <SelectItem value="lost">Провал ✕</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex shrink-0">
                        <button disabled={i === 0} aria-label={`Стадию «${stg.label}» выше`} title="Выше" className="press rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => A.stageMove(e.id, stg.id, -1)}><ArrowUp className="size-3.5" /></button>
                        <button disabled={i === e.stages!.length - 1} aria-label={`Стадию «${stg.label}» ниже`} title="Ниже" className="press rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => A.stageMove(e.id, stg.id, 1)}><ArrowDown className="size-3.5" /></button>
                        <DeleteStage entityId={e.id} stageId={stg.id} />
                      </div>
                    </div>
                  ))}
                </div>
                <AddStageRow entityId={e.id} />
                <IntakePanel entityId={e.id} goRouting={goRouting} goChannels={goChannels} />
                <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
                  Смена стадии пишется в хронологию записи. «Успех» и «Провал» — финальные стадии: по ним считается конверсия.
                </p>
              </>
            )}
          </TabsContent>

          <TabsContent value="main" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="eyebrow">Название (ед. число)</label>
                <Input className="mt-1 h-9 text-[13px]" value={e.name} onChange={ev => A.entPatch(e.id, { name: ev.target.value })} />
              </div>
              <div>
                <label className="eyebrow">Во множественном</label>
                <Input className="mt-1 h-9 text-[13px]" value={e.namePlural} onChange={ev => A.entPatch(e.id, { namePlural: ev.target.value })} />
              </div>
            </div>
            <label className="eyebrow mt-4 block">Иконка</label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {ICON_NAMES.map(n => (
                <button key={n} onClick={() => A.entPatch(e.id, { icon: n })}
                  className={cn("press grid h-9 w-9 place-items-center rounded-md border transition-colors hover:bg-muted", e.icon === n && "border-transparent")}
                  style={e.icon === n ? { background: "hsl(var(--brass) / 0.22)", color: "var(--brass-ink)" } : undefined}>
                  <EntIcon name={n} className="size-4" />
                </button>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-[13px] font-medium">Воронка (стадии)</div>
                <div className="text-[11.5px] text-muted-foreground">Канбан со стадиями; без неё раздел — просто таблица</div>
              </div>
              <Switch checked={!!e.stages?.length} aria-label="Воронка (стадии)" onCheckedChange={on => A.entToggleStages(e.id, on)} />
            </div>
            <div className="mt-4 rounded-lg border border-destructive/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium">Удалить раздел</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {confirmDel ? `Точно удалить «${e.namePlural}» и ${recordsOf(e.id).length} ${plural(recordsOf(e.id).length, "запись", "записи", "записей")}? Ctrl+Z вернёт.` : "Вместе со всеми записями раздела"}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-8 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/5"
                  onClick={() => {
                    if (!confirmDel) { setConfirmDel(true); return; }
                    if (A.entDelete(e.id)) { onOpenChange(false); onDeleted(); }
                    setConfirmDel(false);
                  }}>
                  {confirmDel ? "Да, удалить" : "Удалить"}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Удаление стадии — говорим, сколько записей переедет в первую стадию
function DeleteStage({ entityId, stageId }: { entityId: string; stageId: string }) {
  const [armed, setArmed] = useState(false);
  const n = A.stageCount(entityId, stageId);
  if (!armed) {
    return (
      <button title={n ? `Удалить стадию — ${n} ${plural(n, "запись переедет", "записи переедут", "записей переедет")} в первую` : "Удалить стадию"}
        className="press rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => setArmed(true)}>
        <Trash2 className="size-3.5" />
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="text-[10.5px] text-destructive">{n ? `${n} → в первую` : "точно?"}</span>
      <button onClick={() => { A.stageDelete(entityId, stageId); setArmed(false); }}
        className="press rounded border border-destructive/40 px-1.5 py-0.5 text-[10.5px] text-destructive hover:bg-destructive/5">да</button>
      <button onClick={() => setArmed(false)} className="press rounded border px-1.5 py-0.5 text-[10.5px] text-muted-foreground">нет</button>
    </span>
  );
}

// Удаление поля — двухшаговое: сначала честно говорим, сколько записей потеряют значение
function DeleteField({ entityId, f }: { entityId: string; f: Field }) {
  const [armed, setArmed] = useState(false);
  const used = A.fieldUsage(entityId, f.id);
  if (!armed) {
    return (
      <button title={used ? `Удалить поле — значения у ${used} ${plural(used, "записи", "записей", "записей")} будут потеряны` : "Удалить поле"}
        className="press rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => setArmed(true)}>
        <Trash2 className="size-3.5" />
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="text-[10.5px] text-destructive">{used ? `потеряем ${used}` : "точно?"}</span>
      <button onClick={() => { A.fieldDelete(entityId, f.id); setArmed(false); }}
        className="press rounded border border-destructive/40 px-1.5 py-0.5 text-[10.5px] text-destructive hover:bg-destructive/5">да</button>
      <button onClick={() => setArmed(false)} className="press rounded border px-1.5 py-0.5 text-[10.5px] text-muted-foreground">нет</button>
    </span>
  );
}

function FieldRow({ entityId, f, index, isTitle, first, last, drag, setDrag, over, setOver }: {
  entityId: string; f: Field; index: number; isTitle: boolean; first: boolean; last: boolean;
  drag: string | null; setDrag: (v: string | null) => void; over: number | null; setOver: (v: number | null) => void;
}) {
  const typeLabel = FIELD_TYPES.find(t => t.type === f.type)?.label ?? f.type;
  const relName = f.type === "relation" ? allEntities().find(e => e.id === f.relationTo)?.namePlural : null;
  // На узком экране строка переносится: название — первой строкой, управление — второй.
  // Раньше стрелки и удаление уезжали за правый край и до них было не дотянуться.
  return (
    <div
      draggable
      onDragStart={ev => { ev.dataTransfer.setData("text/plain", f.id); setDrag(f.id); }}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onDragOver={ev => { if (!drag) return; ev.preventDefault(); setOver(index); }}
      onDrop={ev => { ev.preventDefault(); if (drag) A.fieldMoveTo(entityId, drag, index); setDrag(null); setOver(null); }}
      className={cn("flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5 sm:flex-nowrap",
        drag === f.id && "opacity-40", over === index && drag && drag !== f.id && "ring-1 ring-[hsl(var(--brass)/0.7)]")}>
      <span className="cursor-grab text-muted-foreground/50 active:cursor-grabbing" title="Перетащить, чтобы поменять порядок" aria-hidden><GripVertical className="size-3.5" /></span>
      <Input value={f.label} onChange={ev => A.fieldUpdate(entityId, f.id, { label: ev.target.value })}
        className="h-8 min-w-[140px] flex-1 border-transparent bg-transparent px-1.5 text-[13px] font-medium focus-visible:border-input sm:min-w-0" />
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
      {f.type === "relation" ? (
        <span className="w-[126px] shrink-0 truncate text-[11px] text-muted-foreground">{typeLabel}{relName ? ` → ${relName}` : ""}</span>
      ) : (
        <Select value={f.type} onValueChange={v => A.fieldUpdate(entityId, f.id, { type: v as Field["type"] })}>
          <SelectTrigger className="h-8 w-[126px] shrink-0 border-transparent text-[11.5px] hover:border-input" title="Тип поля — можно поменять">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.filter(t => t.type !== "relation").map(t => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {(f.type === "select" || f.type === "multiselect") && <OptionsEditor entityId={entityId} f={f} />}
      <button
        title={f.required ? "Обязательное — напомню, если не заполнено" : "Сделать обязательным"}
        aria-pressed={!!f.required}
        onClick={() => A.fieldUpdate(entityId, f.id, { required: !f.required })}
        className={cn("press shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]", f.required ? "border-transparent font-medium" : "border-foreground/20 text-muted-foreground")}
        style={f.required ? { background: "hsl(var(--brass) / 0.14)", color: "var(--brass-ink)" } : undefined}>
        обязательное
      </button>
      <button
        title={f.inTable === false ? "Показать колонку в таблице" : "Скрыть колонку из таблицы"}
        aria-pressed={f.inTable !== false}
        onClick={() => A.fieldUpdate(entityId, f.id, { inTable: f.inTable === false ? true : false })}
        className={cn("press shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]", f.inTable === false ? "border-foreground/20 text-muted-foreground" : "border-transparent font-medium")}
        style={f.inTable !== false ? { background: "hsl(var(--brass) / 0.14)", color: "var(--brass-ink)" } : undefined}>
        таблица
      </button>
      {isTitle ? (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" }}>заголовок</span>
      ) : (
        <div className="flex shrink-0">
          <button disabled={first} aria-label={`Поле «${f.label}» выше`} title="Выше" className="press rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => A.fieldMove(entityId, f.id, -1)}><ArrowUp className="size-3.5" /></button>
          <button disabled={last} aria-label={`Поле «${f.label}» ниже`} title="Ниже" className="press rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => A.fieldMove(entityId, f.id, 1)}><ArrowDown className="size-3.5" /></button>
          <DeleteField entityId={entityId} f={f} />
        </div>
      )}
      </div>
    </div>
  );
}

function OptionsEditor({ entityId, f }: { entityId: string; f: Field }) {
  const [draft, setDraft] = useState("");
  const opts = f.options ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="press shrink-0 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">{opts.length} вар.</button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="px-1 pb-1 text-[11.5px] font-medium text-muted-foreground">{f.type === "multiselect" ? "Варианты (можно выбрать несколько)" : "Варианты списка"}</div>
        {opts.map(o => (
          <div key={o.id} className="flex items-center gap-2 rounded px-1 py-1">
            <button aria-label={`Цвет варианта «${o.label}»`} className="swatch h-4 w-4 shrink-0 rounded-[4px]" style={{ background: o.color }} title="Сменить цвет"
              onClick={() => A.fieldUpdate(entityId, f.id, { options: opts.map(x => x.id === o.id ? { ...x, color: PALETTE[(PALETTE.indexOf(x.color) + 1) % PALETTE.length] } : x) })} />
            <Input value={o.label} className="h-7 flex-1 text-[12.5px]"
              onChange={ev => A.fieldUpdate(entityId, f.id, { options: opts.map(x => x.id === o.id ? { ...x, label: ev.target.value } : x) })} />
            <button className="text-muted-foreground hover:text-destructive" onClick={() => A.fieldUpdate(entityId, f.id, { options: opts.filter(x => x.id !== o.id) })}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <div className="mt-1 px-1">
          <Input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Новый вариант + Enter" className="h-7 text-[12.5px]"
            onKeyDown={e => {
              if (e.key === "Enter" && draft.trim()) {
                A.fieldUpdate(entityId, f.id, { options: [...opts, { id: uid("o"), label: draft.trim(), color: PALETTE[opts.length % PALETTE.length] }] });
                setDraft("");
              }
            }} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddFieldRow({ entityId }: { entityId: string }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [relTo, setRelTo] = useState<string | undefined>();
  const entities = allEntities();
  const others = entities.filter(e => e.id !== entityId);

  const add = () => {
    if (!label.trim()) return;
    const extra: Partial<Field> = {};
    if (type === "select" || type === "multiselect") extra.options = ["Вариант 1", "Вариант 2"].map((l, i) => ({ id: uid("o"), label: l, color: PALETTE[i % PALETTE.length] }));
    if (type === "relation") { extra.relationTo = relTo ?? others[0]?.id; if (!extra.relationTo) return; }
    A.fieldAdd(entityId, { label: label.trim(), type, inTable: true, ...extra });
    setLabel("");
  };

  return (
    <div className="mt-3 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <Input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
          placeholder="Название нового поля" className="h-8 min-w-36 flex-1 text-[13px]" />
        <Select value={type} onValueChange={v => setType(v as FieldType)}>
          <SelectTrigger className="h-8 w-[150px] text-[12.5px]"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {["База", "Контакты", "Время", "Выбор", "Связи"].map(g => (
              <div key={g}>
                <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
                {FIELD_TYPES.filter(t => t.group === g).map(t => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
              </div>
            ))}
          </SelectContent>
        </Select>
        {type === "relation" && (
          <Select value={relTo ?? others[0]?.id} onValueChange={setRelTo}>
            <SelectTrigger className="h-8 w-[132px] text-[12.5px]"><SelectValue placeholder="Раздел" /></SelectTrigger>
            <SelectContent>
              {others.map(e => <SelectItem key={e.id} value={e.id}>{e.namePlural}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" className="h-8" onClick={add} disabled={!label.trim()}>Добавить</Button>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
        {FIELD_TYPES.length} типов полей. «Связь с разделом» соединяет записи между разделами: сделка → компания, заказ → клиент.
      </p>
    </div>
  );
}

function AddStageRow({ entityId }: { entityId: string }) {
  const [label, setLabel] = useState("");
  return (
    <div className="mt-2 flex items-center gap-2">
      <Plus className="size-4 shrink-0 text-muted-foreground" />
      <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Новая стадия + Enter" className="h-8 text-[13px]"
        onKeyDown={e => { if (e.key === "Enter" && label.trim()) { A.stageAdd(entityId, label.trim()); setLabel(""); } }} />
    </div>
  );
}

// Диалог создания раздела
export function NewEntityDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [many, setMany] = useState("");       // множественное число: подсказываем сами, человек правит
  const [manyTouched, setManyTouched] = useState(false);
  const [pipeline, setPipeline] = useState(true);
  const create = () => {
    const id = A.entAdd(name, pipeline, many);
    setName(""); setMany(""); setManyTouched(false); setPipeline(true);
    onOpenChange(false);
    onCreated(id);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="text-[15px]">Новый раздел</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="eyebrow">Один — как называется запись</label>
            <Input autoFocus placeholder="Заказ, Объект, Ученик…" value={name}
              onChange={e => { setName(e.target.value); if (!manyTouched) setMany(pluralGuess(e.target.value)); }}
              onKeyDown={e => e.key === "Enter" && name.trim() && create()} className="mt-1 h-10 text-[13px]" />
          </div>
          <div>
            <label className="eyebrow">Много — название раздела</label>
            <Input placeholder="Заказы, Объекты, Ученики…" value={many}
              onChange={e => { setMany(e.target.value); setManyTouched(true); }}
              onKeyDown={e => e.key === "Enter" && name.trim() && create()} className="mt-1 h-10 text-[13px]" />
          </div>
        </div>
        <label className="flex cursor-pointer items-center justify-between rounded-md border p-3">
          <span>
            <span className="block text-[13px] font-medium">Воронка со стадиями</span>
            <span className="block text-[11.5px] text-muted-foreground">Канбан «Новая → В работе → Успех»; можно настроить</span>
          </span>
          <Switch checked={pipeline} onCheckedChange={setPipeline} />
        </label>
        <Button className="h-10" disabled={!name.trim()} onClick={create}>Создать раздел</Button>
      </DialogContent>
    </Dialog>
  );
}

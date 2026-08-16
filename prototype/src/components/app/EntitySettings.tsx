// Конструктор раздела: основное, поля (18 типов), стадии воронки
import { useState } from "react";
import { A, useApp, entityById, getState } from "@/lib/store";
import type { Field, FieldType } from "@/lib/model";
import { FIELD_TYPES, PALETTE, uid } from "@/lib/model";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const EMOJI = ["📁", "👤", "🏢", "💼", "📦", "📅", "🏠", "🎓", "🧾", "🔑", "🛠️", "📨", "🎟️", "🚗", "🧺", "❤️", "⭐", "🗂️"];

export function EntitySettings({ entityId, open, onOpenChange }: { entityId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  useApp();
  const e = entityById(entityId);
  if (!e) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-[15px]">{e.icon} Настройка раздела «{e.namePlural}»</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="fields" className="flex min-h-0 flex-col">
          <TabsList className="mx-5 mt-3 grid w-fit grid-cols-3">
            <TabsTrigger value="main">Основное</TabsTrigger>
            <TabsTrigger value="fields">Поля</TabsTrigger>
            <TabsTrigger value="stages">Стадии</TabsTrigger>
          </TabsList>

          <TabsContent value="main" className="overflow-y-auto px-5 pb-5 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Название (ед. число)</label>
                <Input className="mt-1 h-9" value={e.name} onChange={ev => A.updateEntity(e.id, { name: ev.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Во множественном</label>
                <Input className="mt-1 h-9" value={e.namePlural} onChange={ev => A.updateEntity(e.id, { namePlural: ev.target.value })} />
              </div>
            </div>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">Иконка</label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {EMOJI.map(em => (
                <button key={em} onClick={() => A.updateEntity(e.id, { icon: em })}
                  className={cn("grid h-9 w-9 place-items-center rounded-md border text-lg transition-colors hover:bg-muted", e.icon === em && "border-transparent")}
                  style={e.icon === em ? { background: "hsl(42 42% 55% / 0.25)" } : undefined}>
                  {em}
                </button>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Воронка (стадии)</div>
                <div className="text-xs text-muted-foreground">Канбан, конверсия и автоматизации по стадиям</div>
              </div>
              <Switch checked={!!e.pipeline} onCheckedChange={on => A.togglePipeline(e.id, on)} />
            </div>
            <div className="mt-5 rounded-lg border border-destructive/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Удалить раздел</div>
                  <div className="text-xs text-muted-foreground">Вместе со всеми записями. Действие необратимо.</div>
                </div>
                <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/5"
                  onClick={() => { A.deleteEntity(e.id); onOpenChange(false); }}>
                  Удалить
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="fields" className="min-h-0 overflow-y-auto px-5 pb-5 pt-3">
            <div className="flex flex-col gap-1.5">
              {e.fields.map((f, i) => <FieldRow key={f.id} entityId={e.id} f={f} isTitle={f.id === e.titleFieldId} first={i === 0} last={i === e.fields.length - 1} />)}
            </div>
            <AddFieldRow entityId={e.id} />
          </TabsContent>

          <TabsContent value="stages" className="min-h-0 overflow-y-auto px-5 pb-5 pt-3">
            {!e.pipeline ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Воронка выключена. Включите её на вкладке «Основное».
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  {e.pipeline.stages.map((st, i) => (
                    <div key={st.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="h-5 w-5 shrink-0 rounded-[5px] border" style={{ background: st.color }} title="Цвет" />
                        </PopoverTrigger>
                        <PopoverContent className="w-fit p-2">
                          <div className="grid grid-cols-5 gap-1.5">
                            {PALETTE.map(c => <button key={c} className="h-6 w-6 rounded-[5px]" style={{ background: c }} onClick={() => A.updateStage(e.id, st.id, { color: c })} />)}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Input value={st.label} onChange={ev => A.updateStage(e.id, st.id, { label: ev.target.value })} className="h-8 flex-1 border-transparent bg-transparent px-1.5 focus-visible:border-input" />
                      <Input
                        type="number" min={0} placeholder="WIP" title="WIP-лимит: максимум записей на стадии (0 или пусто — без лимита)"
                        value={st.wip ?? ""} onChange={ev => A.updateStage(e.id, st.id, { wip: ev.target.value === "" ? undefined : Math.max(0, Number(ev.target.value)) || undefined })}
                        className="h-8 w-[58px] px-1.5 text-center text-[12px] tnum"
                      />
                      <Select value={st.kind} onValueChange={v => A.updateStage(e.id, st.id, { kind: v as "open" })}>
                        <SelectTrigger className="h-8 w-[132px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Рабочая</SelectItem>
                          <SelectItem value="won">Успех ✓</SelectItem>
                          <SelectItem value="lost">Провал ✕</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex">
                        <button disabled={i === 0} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => A.moveStagePos(e.id, st.id, -1)}><ArrowUp className="size-3.5" /></button>
                        <button disabled={i === e.pipeline!.stages.length - 1} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => A.moveStagePos(e.id, st.id, 1)}><ArrowDown className="size-3.5" /></button>
                        <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => A.deleteStage(e.id, st.id)}><Trash2 className="size-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <AddStageRow entityId={e.id} />
                <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
                  Смена стадии пишется в хронологию и запускает автоматизации. «Успех» и «Провал» — финальные стадии для конверсии.
                </p>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({ entityId, f, isTitle, first, last }: { entityId: string; f: Field; isTitle: boolean; first: boolean; last: boolean }) {
  const typeLabel = FIELD_TYPES.find(t => t.type === f.type)?.label ?? f.type;
  const relName = f.type === "relation" ? getState().ws!.entities.find(e => e.id === f.relationTo)?.namePlural : null;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
      <Input value={f.label} onChange={ev => A.updateField(entityId, f.id, { label: ev.target.value })}
        className="h-8 flex-1 border-transparent bg-transparent px-1.5 font-medium focus-visible:border-input" />
      <span className="w-[118px] shrink-0 truncate text-[11.5px] text-muted-foreground">{typeLabel}{relName ? ` → ${relName}` : ""}</span>
      {(f.type === "select" || f.type === "multiselect") && <OptionsEditor entityId={entityId} f={f} />}
      {isTitle ? (
        <span className="rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: "hsl(42 42% 55% / 0.2)", color: "var(--brass-ink)" }}>заголовок</span>
      ) : (
        <div className="flex shrink-0">
          <button disabled={first} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => A.moveField(entityId, f.id, -1)}><ArrowUp className="size-3.5" /></button>
          <button disabled={last} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => A.moveField(entityId, f.id, 1)}><ArrowDown className="size-3.5" /></button>
          <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => A.deleteField(entityId, f.id)}><Trash2 className="size-3.5" /></button>
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ entityId, f }: { entityId: string; f: Field }) {
  const [draft, setDraft] = useState("");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="shrink-0 rounded-md border px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-muted">{f.options?.length ?? 0} вар.</button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2" align="end">
        <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">Варианты списка</div>
        {f.options?.map((o, i) => (
          <div key={o.id} className="flex items-center gap-2 rounded px-1 py-1">
            <button className="h-4 w-4 rounded-[4px]" style={{ background: o.color }}
              onClick={() => A.updateField(entityId, f.id, { options: f.options!.map(x => x.id === o.id ? { ...x, color: PALETTE[(PALETTE.indexOf(x.color) + 1) % PALETTE.length] } : x) })}
              title="Сменить цвет" />
            <Input value={o.label} className="h-7 flex-1 text-[12.5px]"
              onChange={ev => A.updateField(entityId, f.id, { options: f.options!.map(x => x.id === o.id ? { ...x, label: ev.target.value } : x) })} />
            <button className="text-muted-foreground hover:text-destructive" onClick={() => A.updateField(entityId, f.id, { options: f.options!.filter(x => x.id !== o.id) })}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <div className="mt-1 flex gap-1.5 px-1">
          <Input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Новый вариант"
            className="h-7 text-[12.5px]"
            onKeyDown={e => { if (e.key === "Enter" && draft.trim()) { A.updateField(entityId, f.id, { options: [...(f.options ?? []), { id: uid("o"), label: draft.trim(), color: PALETTE[(f.options?.length ?? 0) % PALETTE.length] }] }); setDraft(""); } }} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddFieldRow({ entityId }: { entityId: string }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [relTo, setRelTo] = useState<string | undefined>();
  const [rollSrc, setRollSrc] = useState<string | undefined>();
  const [rollAgg, setRollAgg] = useState<"count" | "sum">("count");
  const entities = getState().ws!.entities;
  // разделы, у которых есть связь на текущий раздел — источники рол-апа
  const rollSources = entities
    .map(en => ({ en, via: en.fields.filter(f => f.type === "relation" && f.relationTo === entityId) }))
    .filter(x => x.via.length > 0);

  const add = () => {
    if (!label.trim()) return;
    const extra: Partial<Field> = {};
    if (type === "select" || type === "multiselect") extra.options = ["Вариант 1", "Вариант 2"].map((l, i) => ({ id: uid("o"), label: l, color: PALETTE[i % PALETTE.length] }));
    if (type === "relation") { extra.relationTo = relTo ?? entities.find(e => e.id !== entityId)?.id; if (!extra.relationTo) return; }
    if (type === "rollup") {
      const src = rollSources.find(x => x.en.id === (rollSrc ?? rollSources[0]?.en.id));
      if (!src) return;
      const target = rollAgg === "sum" ? src.en.fields.find(f => f.type === "money" || f.type === "number") : undefined;
      if (rollAgg === "sum" && !target) return;
      extra.rollup = { entityId: src.en.id, viaFieldId: src.via[0].id, agg: rollAgg, targetFieldId: target?.id };
    }
    A.addField(entityId, { label: label.trim(), type, inTable: true, ...extra });
    setLabel("");
  };

  return (
    <div className="mt-3 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Plus className="size-4 text-muted-foreground" />
        <Input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Название нового поля" className="h-8 flex-1" />
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
          <Select value={relTo ?? entities.find(e => e.id !== entityId)?.id} onValueChange={setRelTo}>
            <SelectTrigger className="h-8 w-[130px] text-[12.5px]"><SelectValue placeholder="Раздел" /></SelectTrigger>
            <SelectContent>
              {entities.filter(e => e.id !== entityId).map(e => <SelectItem key={e.id} value={e.id}>{e.icon} {e.namePlural}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {type === "rollup" && (
          <>
            <Select value={rollSrc ?? rollSources[0]?.en.id} onValueChange={setRollSrc} disabled={!rollSources.length}>
              <SelectTrigger className="h-8 w-[120px] text-[12.5px]"><SelectValue placeholder="Источник" /></SelectTrigger>
              <SelectContent>
                {rollSources.map(x => <SelectItem key={x.en.id} value={x.en.id}>{x.en.icon} {x.en.namePlural}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={rollAgg} onValueChange={v => setRollAgg(v as "count")}>
              <SelectTrigger className="h-8 w-[110px] text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="count">Количество</SelectItem>
                <SelectItem value="sum">Сумма</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        <Button size="sm" className="h-8" onClick={add}>Добавить</Button>
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {type === "rollup"
          ? (rollSources.length ? "Рол-ап считает агрегат по записям, ссылающимся на эту: например, «сумма сделок компании»." : "Для рол-апа нужен раздел со «связью» на этот раздел.")
          : "17 типов полей. «Связь с разделом» соединяет записи: сделка → компания, запись → клиент."}
      </p>
    </div>
  );
}

function AddStageRow({ entityId }: { entityId: string }) {
  const [label, setLabel] = useState("");
  return (
    <div className="mt-2 flex items-center gap-2">
      <Plus className="size-4 text-muted-foreground" />
      <Input value={label} onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && label.trim()) { A.addStage(entityId, label.trim()); setLabel(""); } }}
        placeholder="Новая стадия + Enter" className="h-8" />
    </div>
  );
}

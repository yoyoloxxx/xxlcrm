// Живые автоматизации: правила «когда → тогда» для любых разделов конструктора
import { useState } from "react";
import type { Field, Rule, RuleAction, RuleTrigger, TaskKind } from "@/lib/model";
import { useApp, A, allEntities, getState, resolveRoute, userName } from "@/lib/store";
import { ruleProblem } from "@/lib/automations";
import { SOURCES, sourceName, plural } from "@/lib/model";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowRight, Pencil, Plus, Route as RouteIcon, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<TaskKind, string> = { call: "звонок", meet: "встреча", todo: "сделать", msg: "написать" };
const ANY_STAGE = "any"; // значение Select «любая стадия» (Radix не принимает пустую строку)
const isDateField = (f: Field) => f.type === "date" || f.type === "datetime";

function entName(id: string): string {
  return allEntities().find(e => e.id === id)?.namePlural ?? "удалённый раздел";
}
function stageName(entityId: string, stageId: string): string {
  if (stageId === "kind:won") return "любую успешную";
  if (stageId === "kind:lost") return "любую провальную";
  return allEntities().find(e => e.id === entityId)?.stages?.find(s => s.id === stageId)?.label ?? "стадию";
}
function fieldName(entityId: string, fieldId: string): string {
  return allEntities().find(e => e.id === entityId)?.fields.find(f => f.id === fieldId)?.label ?? "удалённое поле";
}
function tplName(id: string): string {
  return getState().replyTemplates.find(t => t.id === id)?.name ?? "удалённый шаблон";
}
function triggerText(t: RuleTrigger): string {
  switch (t.type) {
    case "record_created": return `Создана запись в «${entName(t.entityId)}»`;
    case "stage_enter": return `Запись в «${entName(t.entityId)}» попала на ${stageName(t.entityId, t.stageId)} стадию`;
    case "stage_stuck": return `Запись в «${entName(t.entityId)}» стоит ${t.stageId ? `на стадии «${stageName(t.entityId, t.stageId)}»` : "на любой стадии"} дольше ${t.days} дн.`;
    case "quiet": return `По записи в «${entName(t.entityId)}» тишина дольше ${t.days} дн.`;
    case "unanswered": return `Клиент по записи в «${entName(t.entityId)}» ждёт ответа дольше ${t.hours} ч.`;
    case "date_before": return `За ${t.days} дн. до даты «${fieldName(t.entityId, t.fieldId)}» в «${entName(t.entityId)}»`;
  }
}
function whenText(h: number): string {
  if (h === 0) return "сразу";
  if (h < 1) return `через ${Math.round(h * 60)} мин.`;
  if (h < 24) return `через ${h} ч.`;
  return `через ${Math.round(h / 24)} дн.`;
}
function actionText(r: Rule): string {
  const a = r.action;
  if (a.type === "message") return `написать клиенту по шаблону «${tplName(a.templateId)}» (${whenText(a.afterHours ?? 0)})`;
  return `задача «${a.title}» (${KIND_LABEL[a.kind]}, ${whenText(a.afterHours)})`;
}
const ruleBroken = (r: Rule) => ruleProblem(r);
const num = (v: string, def: number, min: number) => { const n = Number(v); return Math.max(min, isFinite(n) && v.trim() !== "" ? n : def); };

function RuleDialog({ rule, open, onClose }: { rule: Rule | null; open: boolean; onClose: () => void }) {
  const s = useApp();
  const ents = allEntities();
  const [name, setName] = useState(rule?.name ?? "");
  const [trigType, setTrigType] = useState<RuleTrigger["type"]>(rule?.trigger.type ?? "record_created");
  const [entityId, setEntityId] = useState(rule?.trigger.entityId ?? ents[0]?.id ?? "");
  const [stageId, setStageId] = useState(rule?.trigger.type === "stage_enter" ? rule.trigger.stageId : "kind:won");
  const [stuckStage, setStuckStage] = useState(rule?.trigger.type === "stage_stuck" ? (rule.trigger.stageId ?? ANY_STAGE) : ANY_STAGE);
  const [fieldId, setFieldId] = useState(rule?.trigger.type === "date_before" ? rule.trigger.fieldId : "");
  const [days, setDays] = useState(String(rule && "days" in rule.trigger ? rule.trigger.days : 3));
  const [hours, setHours] = useState(String(rule?.trigger.type === "unanswered" ? rule.trigger.hours : 2));
  const [actType, setActType] = useState<RuleAction["type"]>(rule?.action.type ?? "task");
  const [title, setTitle] = useState(rule?.action.type === "task" ? rule.action.title : "");
  const [kind, setKind] = useState<TaskKind>(rule?.action.type === "task" ? rule.action.kind : "todo");
  const [templateId, setTemplateId] = useState(rule?.action.type === "message" ? rule.action.templateId : "");
  const [after, setAfter] = useState(String(rule?.action.afterHours ?? (rule?.action.type === "message" ? 0 : 1)));
  const ent = ents.find(e => e.id === entityId);
  // Сменили раздел — стадия/поле прошлого раздела не должны уехать в правило молча
  const enterSel = stageId.startsWith("kind:") || ent?.stages?.some(x => x.id === stageId) ? stageId : "kind:won";
  const stuckSel = ent?.stages?.some(x => x.id === stuckStage) ? stuckStage : ANY_STAGE;
  const dateFields = ent?.fields.filter(isDateField) ?? [];
  const fieldSel = dateFields.some(f => f.id === fieldId) ? fieldId : (dateFields[0]?.id ?? "");
  const tplSel = s.replyTemplates.some(t => t.id === templateId) ? templateId : (s.replyTemplates[0]?.id ?? "");
  const tpl = s.replyTemplates.find(t => t.id === tplSel);
  const canSave = (actType === "task" ? !!title.trim() : !!tplSel) && (trigType !== "date_before" || !!fieldSel);

  const save = () => {
    if (!canSave) return;
    const trigger: RuleTrigger =
      trigType === "record_created" ? { type: "record_created", entityId }
      : trigType === "stage_enter" ? { type: "stage_enter", entityId, stageId: enterSel }
      : trigType === "stage_stuck" ? { type: "stage_stuck", entityId, days: num(days, 3, 1), ...(stuckSel !== ANY_STAGE ? { stageId: stuckSel } : {}) }
      : trigType === "quiet" ? { type: "quiet", entityId, days: num(days, 30, 1) }
      : trigType === "unanswered" ? { type: "unanswered", entityId, hours: num(hours, 2, 0) }
      : { type: "date_before", entityId, fieldId: fieldSel, days: num(days, 3, 0) };
    const afterHours = num(after, 0, 0);
    const action: RuleAction = actType === "task"
      ? { type: "task", title: title.trim(), kind, afterHours }
      : { type: "message", templateId: tplSel, afterHours };
    const ruleName = name.trim() || triggerText(trigger);
    if (rule) A.ruleUpdate(rule.id, { name: ruleName, trigger, action });
    else A.ruleAdd({ name: ruleName, enabled: true, trigger, action });
    onClose();
  };

  const pick = (v: RuleAction["type"]) => {
    setActType(v);
    // письмо по умолчанию уходит сразу, задача — через час: срок, который не трогали, подстраиваем под режим
    if (!rule) setAfter(a => (v === "message" && a === "1" ? "0" : v === "task" && a === "0" ? "1" : a));
  };
  const seg = (v: RuleAction["type"], label: string) => (
    <button type="button" role="radio" aria-checked={actType === v} onClick={() => pick(v)}
      className={cn("press h-8 rounded-[5px] text-[12.5px] transition-colors", actType === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
      {label}
    </button>
  );
  const whenPrefix = actType === "task" ? "срок" : "отправить";

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-[15px]">{rule ? "Правило" : "Новое правило"}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input className="h-9 text-[13px]" placeholder="Название (можно оставить пустым)" value={name} onChange={e => setName(e.target.value)} />
          <div>
            <div className="eyebrow mb-1.5">Когда</div>
            <div className="flex flex-col gap-2">
              <Select value={trigType} onValueChange={v => setTrigType(v as RuleTrigger["type"])}>
                <SelectTrigger className="h-9 text-[12.5px]" aria-label="Событие"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="record_created">Создана запись</SelectItem>
                  <SelectItem value="stage_enter">Запись попала на стадию</SelectItem>
                  <SelectItem value="stage_stuck">Запись застряла на стадии</SelectItem>
                  <SelectItem value="quiet">По записи тишина N дней</SelectItem>
                  <SelectItem value="unanswered">Клиент ждёт ответа N часов</SelectItem>
                  <SelectItem value="date_before">За N дней до даты в поле</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger className="h-9 flex-1 text-[12.5px]" aria-label="Раздел"><SelectValue placeholder="Раздел" /></SelectTrigger>
                  <SelectContent>
                    {ents.map(e => <SelectItem key={e.id} value={e.id}>{e.namePlural}</SelectItem>)}
                  </SelectContent>
                </Select>
                {trigType === "stage_enter" && (
                  <Select value={enterSel} onValueChange={setStageId}>
                    <SelectTrigger className="h-9 flex-1 text-[12.5px]" aria-label="Стадия"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kind:won">Любая успешная ✓</SelectItem>
                      <SelectItem value="kind:lost">Любая провальная ✕</SelectItem>
                      {ent?.stages?.map(st => <SelectItem key={st.id} value={st.id}>{st.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {trigType === "stage_stuck" && (
                  <Select value={stuckSel} onValueChange={setStuckStage}>
                    <SelectTrigger className="h-9 flex-1 text-[12.5px]" aria-label="Стадия"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_STAGE}>Любая стадия</SelectItem>
                      {ent?.stages?.filter(st => st.kind === "open").map(st => <SelectItem key={st.id} value={st.id}>{st.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {trigType === "date_before" && (
                  <Select value={fieldSel} onValueChange={setFieldId}>
                    <SelectTrigger className="h-9 flex-1 text-[12.5px]" aria-label="Поле-дата"><SelectValue placeholder="Поле-дата" /></SelectTrigger>
                    <SelectContent>
                      {dateFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {(trigType === "stage_stuck" || trigType === "quiet" || trigType === "date_before") && (
                  <div className="flex items-center gap-1.5">
                    <Input className="h-9 w-16 text-center text-[12.5px] tnum" type="number" min={trigType === "date_before" ? 0 : 1} aria-label="Дней" value={days} onChange={e => setDays(e.target.value)} />
                    <span className="whitespace-nowrap text-[12px] text-muted-foreground">{trigType === "date_before" ? "дн. до" : "дн."}</span>
                  </div>
                )}
                {trigType === "unanswered" && (
                  <div className="flex items-center gap-1.5">
                    <Input className="h-9 w-16 text-center text-[12.5px] tnum" type="number" min={0} aria-label="Часов" value={hours} onChange={e => setHours(e.target.value)} />
                    <span className="text-[12px] text-muted-foreground">ч.</span>
                  </div>
                )}
              </div>
              {trigType === "date_before" && !dateFields.length && (
                <p className="text-[11.5px] leading-snug text-destructive">В разделе нет поля с датой — добавьте его в конструкторе.</p>
              )}
              {trigType === "unanswered" && (
                <p className="text-[11px] leading-snug text-muted-foreground">Считаются настоящие диалоги подключённых каналов, привязанные к записи: последнее сообщение — от клиента, и оно ждёт дольше указанного.</p>
              )}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Тогда</div>
            <div className="mb-2 grid grid-cols-2 gap-0.5 rounded-md border p-0.5" role="radiogroup" aria-label="Что сделать">
              {seg("task", "Поставить задачу")}
              {seg("message", "Написать клиенту")}
            </div>
            {actType === "task" ? (
              <div className="flex flex-col gap-2">
                <Input className="h-9 text-[13px]" placeholder="Текст задачи, например: Связаться с клиентом" value={title} onChange={e => setTitle(e.target.value)} />
                <div className="flex gap-2">
                  <Select value={kind} onValueChange={v => setKind(v as TaskKind)}>
                    <SelectTrigger className="h-9 flex-1 text-[12.5px]" aria-label="Тип задачи"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="call">Звонок</SelectItem>
                      <SelectItem value="msg">Написать</SelectItem>
                      <SelectItem value="meet">Встреча</SelectItem>
                      <SelectItem value="todo">Сделать</SelectItem>
                    </SelectContent>
                  </Select>
                  <WhenSelect value={after} onChange={setAfter} prefix={whenPrefix} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Select value={tplSel} onValueChange={setTemplateId}>
                    <SelectTrigger className="h-9 flex-1 text-[12.5px]" aria-label="Шаблон сообщения"><SelectValue placeholder="Шаблон ответа" /></SelectTrigger>
                    <SelectContent>
                      {s.replyTemplates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <WhenSelect value={after} onChange={setAfter} prefix={whenPrefix} />
                </div>
                {tpl
                  ? <div className="rounded-md bg-muted/70 px-2.5 py-1.5 text-[11.5px] leading-snug text-muted-foreground">{tpl.text}</div>
                  : <p className="text-[11.5px] leading-snug text-destructive">Шаблонов ответа нет — добавьте в Настройках.</p>}
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Уйдёт в диалог клиента в подключённом канале (Telegram, WhatsApp, MAX) в рабочее время 9–22; переменные подставятся из записи.
                  Нет диалога или канала — вместо письма встанет задача «Написать клиенту».
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button className="h-10 flex-1" onClick={save} disabled={!canSave}>Сохранить правило</Button>
            <Button variant="outline" className="h-10" onClick={onClose}>Отмена</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WhenSelect({ value, onChange, prefix }: { value: string; onChange: (v: string) => void; prefix: string }) {
  const opts: [string, string][] = [["0", "сразу"], ["0.25", "через 15 минут"], ["1", "через час"], ["3", "через 3 часа"], ["24", "завтра"], ["72", "через 3 дня"]];
  const known = opts.some(([v]) => v === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 flex-1 text-[12.5px]" aria-label="Когда"><SelectValue /></SelectTrigger>
      <SelectContent>
        {!known && <SelectItem value={value}>{prefix}: {whenText(Number(value) || 0)}</SelectItem>}
        {opts.map(([v, l]) => <SelectItem key={v} value={v}>{prefix}: {l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function AutomationsLive() {
  const s = useApp();
  const [editing, setEditing] = useState<Rule | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="cascade mx-auto max-w-3xl px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Автоматизации</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">правила «когда → тогда»: система двигает клиента сама, без напоминаний себе</p>
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setAdding(true)}><Plus className="size-3.5" /> Правило</Button>
      </div>

      <div className="mt-5 rounded-lg border bg-card px-4 py-3.5">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          <RouteIcon className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Приём заявок
          <button onClick={() => A.goto("settings")} className="press ml-auto text-[11.5px] font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">настроить</button>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">Первое, что делает система сама: превращает входящее сообщение или заявку с сайта в запись.</p>
        <div className="mt-2 flex flex-col gap-1">
          {SOURCES.map(src => {
            const { entity, stage, route, ownerId } = resolveRoute(src);
            return (
              <div key={src} className="flex items-center gap-2 text-[12px]">
                <span className="w-[130px] shrink-0 text-muted-foreground">{sourceName(src)}</span>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />
                {route.auto
                  ? <span className="truncate"><b className="font-medium">{entity?.namePlural ?? "—"}</b>{stage ? ` · ${stage.label}` : ""}{ownerId ? ` · ${userName(ownerId)}` : ""}{route.createClient ? " · + карточка клиента" : ""}</span>
                  : <span className="text-muted-foreground">только диалог во Входящих</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 divide-y rounded-lg border bg-card">
        {s.automations.length === 0 && (
          <div className="p-6 text-center text-[13px] text-muted-foreground">Правил нет — добавьте первое.</div>
        )}
        {s.automations.map(r => {
          const broken = ruleBroken(r);
          return (
            <div key={r.id} className={cn("group flex items-start gap-3 px-4 py-3", !r.enabled && "opacity-60")}>
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: r.enabled ? "hsl(var(--brass) / 0.18)" : "hsl(var(--muted))" }}>
                <Zap className="size-3.5" style={{ color: r.enabled ? "var(--brass-ink)" : "hsl(var(--muted-foreground))" }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-snug">{r.name}</div>
                <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                  {broken ? (
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      <AlertTriangle className="size-3.5 shrink-0" /> Не работает: {broken}.
                      <button onClick={() => setEditing(r)} className="press underline underline-offset-2">починить</button>
                    </span>
                  ) : `${triggerText(r.trigger)} → ${actionText(r)}`}
                </div>
                <div className="font-mono2 mt-1 text-[10.5px] text-muted-foreground">сработало {r.fired} {plural(r.fired, "раз", "раза", "раз")}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button className="press rounded p-1 text-muted-foreground/0 transition-colors hover:text-foreground group-hover:text-muted-foreground" title="Редактировать" onClick={() => setEditing(r)}>
                  <Pencil className="size-3.5" />
                </button>
                <button className="press rounded p-1 text-muted-foreground/0 transition-colors hover:text-destructive group-hover:text-muted-foreground" title="Удалить" onClick={() => A.ruleDelete(r.id)}>
                  <Trash2 className="size-3.5" />
                </button>
                <Switch checked={r.enabled} aria-label={`Правило «${r.name}»: ${r.enabled ? "включено" : "выключено"}`} onCheckedChange={() => A.ruleToggle(r.id)} />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
        Правила работают с любыми разделами конструктора. Задача достаётся ответственному за запись; «застряла», «тишина», «ждёт ответа» и «за N дней до даты» проверяются раз в час.
        Сообщение клиенту уходит по шаблону в настоящий диалог подключённого канала — только в рабочее время; нет диалога — встанет задача «Написать клиенту». Дубли исключены: одно событие — одна задача или одно письмо, даже в команде.
      </p>

      {(adding || editing) && <RuleDialog rule={editing} open onClose={() => { setAdding(false); setEditing(null); }} />}
    </div>
  );
}

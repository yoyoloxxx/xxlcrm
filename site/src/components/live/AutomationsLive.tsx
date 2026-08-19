// Живые автоматизации: правила «когда → тогда» для любых разделов конструктора
import { useState } from "react";
import type { Rule, RuleTrigger, TaskKind } from "@/lib/model";
import { useApp, A, allEntities, ruleIssue, resolveRoute, userName } from "@/lib/store";
import { SOURCES, sourceName } from "@/lib/model";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowRight, Pencil, Plus, Route as RouteIcon, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<TaskKind, string> = { call: "звонок", meet: "встреча", todo: "сделать", msg: "написать" };

function entName(id: string): string {
  return allEntities().find(e => e.id === id)?.namePlural ?? "удалённый раздел";
}
function stageName(entityId: string, stageId: string): string {
  if (stageId === "kind:won") return "любую успешную";
  if (stageId === "kind:lost") return "любую провальную";
  return allEntities().find(e => e.id === entityId)?.stages?.find(s => s.id === stageId)?.label ?? "стадию";
}
function triggerText(t: RuleTrigger): string {
  switch (t.type) {
    case "record_created": return `Создана запись в «${entName(t.entityId)}»`;
    case "stage_enter": return `Запись в «${entName(t.entityId)}» попала на ${stageName(t.entityId, t.stageId)} стадию`;
    case "stage_stuck": return `Запись в «${entName(t.entityId)}» стоит на стадии дольше ${t.days} дн.`;
    case "quiet": return `По записи в «${entName(t.entityId)}» тишина дольше ${t.days} дн.`;
  }
}
function actionText(r: Rule): string {
  const h = r.action.afterHours;
  const when = h === 0 ? "сразу" : h < 24 ? `через ${h} ч.` : `через ${Math.round(h / 24)} дн.`;
  return `задача «${r.action.title}» (${KIND_LABEL[r.action.kind]}, ${when})`;
}
const ruleBroken = (r: Rule) => ruleIssue(r);

function RuleDialog({ rule, open, onClose }: { rule: Rule | null; open: boolean; onClose: () => void }) {
  const ents = allEntities();
  const [name, setName] = useState(rule?.name ?? "");
  const [trigType, setTrigType] = useState<RuleTrigger["type"]>(rule?.trigger.type ?? "record_created");
  const [entityId, setEntityId] = useState(rule?.trigger.entityId ?? ents[0]?.id ?? "");
  const [stageId, setStageId] = useState(rule?.trigger.type === "stage_enter" ? rule.trigger.stageId : "kind:won");
  const [days, setDays] = useState(String(rule && "days" in rule.trigger ? rule.trigger.days : 3));
  const [title, setTitle] = useState(rule?.action.title ?? "");
  const [kind, setKind] = useState<TaskKind>(rule?.action.kind ?? "todo");
  const [after, setAfter] = useState(String(rule?.action.afterHours ?? 1));
  const ent = ents.find(e => e.id === entityId);

  const save = () => {
    if (!title.trim()) return;
    const trigger: RuleTrigger =
      trigType === "record_created" ? { type: "record_created", entityId }
      : trigType === "stage_enter" ? { type: "stage_enter", entityId, stageId }
      : trigType === "stage_stuck" ? { type: "stage_stuck", entityId, days: Math.max(1, Number(days) || 3) }
      : { type: "quiet", entityId, days: Math.max(1, Number(days) || 30) };
    const action = { type: "task" as const, title: title.trim(), kind, afterHours: Math.max(0, Number(after) || 0) };
    const ruleName = name.trim() || triggerText(trigger);
    if (rule) A.ruleUpdate(rule.id, { name: ruleName, trigger, action });
    else A.ruleAdd({ name: ruleName, enabled: true, trigger, action });
    onClose();
  };

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
                <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="record_created">Создана запись</SelectItem>
                  <SelectItem value="stage_enter">Запись попала на стадию</SelectItem>
                  <SelectItem value="stage_stuck">Запись застряла на стадии</SelectItem>
                  <SelectItem value="quiet">По записи тишина N дней</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger className="h-9 flex-1 text-[12.5px]"><SelectValue placeholder="Раздел" /></SelectTrigger>
                  <SelectContent>
                    {ents.map(e => <SelectItem key={e.id} value={e.id}>{e.namePlural}</SelectItem>)}
                  </SelectContent>
                </Select>
                {trigType === "stage_enter" && (
                  <Select value={stageId} onValueChange={setStageId}>
                    <SelectTrigger className="h-9 flex-1 text-[12.5px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kind:won">Любая успешная ✓</SelectItem>
                      <SelectItem value="kind:lost">Любая провальная ✕</SelectItem>
                      {ent?.stages?.map(st => <SelectItem key={st.id} value={st.id}>{st.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {(trigType === "stage_stuck" || trigType === "quiet") && (
                  <div className="flex items-center gap-1.5">
                    <Input className="h-9 w-16 text-center text-[12.5px] tnum" type="number" min={1} value={days} onChange={e => setDays(e.target.value)} />
                    <span className="text-[12px] text-muted-foreground">дн.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Тогда — создать задачу</div>
            <div className="flex flex-col gap-2">
              <Input className="h-9 text-[13px]" placeholder="Текст задачи, например: Связаться с клиентом" value={title} onChange={e => setTitle(e.target.value)} />
              <div className="flex gap-2">
                <Select value={kind} onValueChange={v => setKind(v as TaskKind)}>
                  <SelectTrigger className="h-9 flex-1 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Звонок</SelectItem>
                    <SelectItem value="msg">Написать</SelectItem>
                    <SelectItem value="meet">Встреча</SelectItem>
                    <SelectItem value="todo">Сделать</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={after} onValueChange={setAfter}>
                  <SelectTrigger className="h-9 flex-1 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">срок: сразу</SelectItem>
                    <SelectItem value="1">срок: через час</SelectItem>
                    <SelectItem value="3">срок: через 3 часа</SelectItem>
                    <SelectItem value="24">срок: завтра</SelectItem>
                    <SelectItem value="72">срок: через 3 дня</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <Button className="h-10" onClick={save} disabled={!title.trim()}>Сохранить правило</Button>
        </div>
      </DialogContent>
    </Dialog>
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
                <div className="font-mono2 mt-1 text-[10.5px] text-muted-foreground">сработало {r.fired} {r.fired % 10 === 1 && r.fired % 100 !== 11 ? "раз" : "раз(а)"}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button className="press rounded p-1 text-muted-foreground/0 transition-colors hover:text-foreground group-hover:text-muted-foreground" title="Редактировать" onClick={() => setEditing(r)}>
                  <Pencil className="size-3.5" />
                </button>
                <button className="press rounded p-1 text-muted-foreground/0 transition-colors hover:text-destructive group-hover:text-muted-foreground" title="Удалить" onClick={() => A.ruleDelete(r.id)}>
                  <Trash2 className="size-3.5" />
                </button>
                <Switch checked={r.enabled} onCheckedChange={() => A.ruleToggle(r.id)} />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
        Правила работают с любыми разделами конструктора. Задача достаётся ответственному за запись; проверка «застряла» и «тишина» — раз в час. Дубли исключены: одно событие — одна задача, даже в команде.
      </p>

      {(adding || editing) && <RuleDialog rule={editing} open onClose={() => { setAdding(false); setEditing(null); }} />}
    </div>
  );
}

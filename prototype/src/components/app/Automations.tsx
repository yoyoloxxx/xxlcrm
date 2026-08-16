// Автоматизации: работающий движок «триггер → действие» + конструктор правил
import { useState } from "react";
import { A, useApp, entityById } from "@/lib/store";
import type { Automation, AutoAction, TaskKind } from "@/lib/model";
import { plural } from "@/lib/model";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Plus, Trash2, Zap } from "lucide-react";

export function Automations() {
  const s = useApp();
  const ws = s.ws!;
  const [addOpen, setAddOpen] = useState(false);

  const trigLabel = (a: Automation) => {
    const e = entityById(a.entityId);
    const st = e?.pipeline?.stages.find(x => x.id === a.stageId)?.label;
    if (a.trigger === "record.created") return `Создана запись в «${e?.namePlural}»`;
    if (a.trigger === "stage.changed") return `Стадия стала «${st}» (${e?.namePlural})`;
    return `Запись висит на «${st}» дольше ${a.days ?? 3} ${plural(a.days ?? 3, "дня", "дней", "дней")} (${e?.namePlural})`;
  };
  const actLabel = (x: AutoAction) =>
    x.kind === "task" ? `создать задачу «${x.title}»` : x.kind === "notify" ? `уведомить: «${x.text}»` : "сменить стадию";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Автоматизации</h1>
            <p className="mt-0.5 max-w-md text-[13px] leading-snug text-muted-foreground">
              Работают по-настоящему: создайте запись или перетащите карточку по стадиям — и смотрите, как появляются задачи и уведомления.
            </p>
          </div>
          <Button size="sm" className="h-8 gap-1" onClick={() => setAddOpen(true)}><Plus className="size-4" /> Правило</Button>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          {ws.automations.map(a => (
            <div key={a.id} className="group flex items-start gap-3 rounded-xl border bg-card p-3.5">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: a.enabled ? "hsl(42 42% 55% / 0.18)" : "hsl(44 22% 94%)" }}>
                <Zap className="size-4" style={{ color: a.enabled ? "var(--brass-ink)" : "hsl(40 9% 60%)" }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold leading-snug">{a.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">{trigLabel(a)}</span>
                  <ArrowRight className="size-3" />
                  {a.actions.map((x, i) => <span key={i} className="rounded bg-muted px-1.5 py-0.5">{actLabel(x)}</span>)}
                </div>
                <div className="mt-1.5 text-[11.5px] text-muted-foreground tnum">Сработала {a.fired} {plural(a.fired, "раз", "раза", "раз")}</div>
              </div>
              <button className="mt-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100" onClick={() => A.deleteAutomation(a.id)}>
                <Trash2 className="size-4" />
              </button>
              <Switch className="mt-1" checked={a.enabled} onCheckedChange={() => A.toggleAutomation(a.id)} />
            </div>
          ))}
        </div>

        <p className="mt-5 text-[12px] leading-snug text-muted-foreground">
          В прототипе — 3 триггера и 2 действия. В продукте: входящие сообщения, вебхуки, расписание; отправка сообщений клиенту, генерация документов, действия AI.
        </p>
      </div>
      <AddAutomationDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function AddAutomationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useApp();
  const ws = s.ws!;
  const [entityId, setEntityId] = useState(ws.entities.find(e => e.pipeline)?.id ?? ws.entities[0]?.id);
  const [trigger, setTrigger] = useState<Automation["trigger"]>("record.created");
  const [stageId, setStageId] = useState<string | undefined>();
  const [daysN, setDaysN] = useState("3");
  const [actKind, setActKind] = useState<"task" | "notify">("task");
  const [taskTitle, setTaskTitle] = useState("Связаться с клиентом");
  const [taskKind, setTaskKind] = useState<TaskKind>("call");
  const [notifyText, setNotifyText] = useState("Проверьте запись");

  const e = entityById(entityId);
  const stages = e?.pipeline?.stages ?? [];
  const needStage = trigger !== "record.created";

  const create = () => {
    const st = stageId ?? stages[0]?.id;
    if (needStage && !st) return;
    const action: AutoAction = actKind === "task"
      ? { kind: "task", title: taskTitle.trim() || "Задача", inDays: 0, taskKind }
      : { kind: "notify", text: notifyText.trim() || "Уведомление" };
    const trigName = trigger === "record.created" ? `Новая запись в «${e?.namePlural}»`
      : trigger === "stage.changed" ? `Стадия «${stages.find(x => x.id === st)?.label}»`
      : `Застряла на «${stages.find(x => x.id === st)?.label}» ${daysN} дн.`;
    A.addAutomation({
      name: `${trigName} → ${action.kind === "task" ? "задача" : "уведомление"}`,
      enabled: true, entityId, trigger,
      stageId: needStage ? st : undefined,
      days: trigger === "stale" ? Number(daysN) || 3 : undefined,
      actions: [action],
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-[15px]">Новое правило</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Раздел</label>
            <Select value={entityId} onValueChange={v => { setEntityId(v); setStageId(undefined); }}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{ws.entities.map(en => <SelectItem key={en.id} value={en.id}>{en.icon} {en.namePlural}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Когда (триггер)</label>
            <Select value={trigger} onValueChange={v => setTrigger(v as Automation["trigger"])}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="record.created">Создана новая запись</SelectItem>
                <SelectItem value="stage.changed" disabled={!stages.length}>Запись перешла на стадию…</SelectItem>
                <SelectItem value="stale" disabled={!stages.length}>Запись застряла на стадии…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {needStage && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Стадия</label>
                <Select value={stageId ?? stages[0]?.id} onValueChange={setStageId}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{stages.map(x => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {trigger === "stale" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Дней без движения</label>
                  <Input className="mt-1 h-9 tnum" type="number" min={1} value={daysN} onChange={ev => setDaysN(ev.target.value)} />
                </div>
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Тогда (действие)</label>
            <Select value={actKind} onValueChange={v => setActKind(v as "task")}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="task">Создать задачу</SelectItem>
                <SelectItem value="notify">Показать уведомление</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {actKind === "task" ? (
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Текст задачи</label>
                <Input className="mt-1 h-9" value={taskTitle} onChange={ev => setTaskTitle(ev.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Тип</label>
                <Select value={taskKind} onValueChange={v => setTaskKind(v as TaskKind)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Звонок</SelectItem>
                    <SelectItem value="meet">Встреча</SelectItem>
                    <SelectItem value="todo">Дело</SelectItem>
                    <SelectItem value="msg">Сообщение</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Текст уведомления</label>
              <Input className="mt-1 h-9" value={notifyText} onChange={ev => setNotifyText(ev.target.value)} />
            </div>
          )}
          <Button onClick={create}>Создать и включить</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

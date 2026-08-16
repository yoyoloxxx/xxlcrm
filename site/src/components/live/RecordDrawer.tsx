// Карточка записи: поля, полоса стадий, задачи, хронология, Esc для закрытия
import { useEffect, useState } from "react";
import type { TaskKind } from "@/lib/model";
import { relTime, fmtDateTime, fmtDate } from "@/lib/model";
import { A, entityCfg, recById, recTitle, userName, getState, relatedOf, allEntities, entityCfg as entCfg } from "@/lib/store";
import { FieldInput } from "./FieldInput";
import { OwnerPicker } from "./TableLive";
import { UserChip } from "./bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CalendarClock, ListChecks, MessageSquare, MoreVertical, Phone, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const TASK_ICON: Record<TaskKind, React.ElementType> = { call: Phone, meet: CalendarClock, todo: ListChecks, msg: MessageSquare };
const TASK_NAME: Record<TaskKind, string> = { call: "Звонок", meet: "Встреча", todo: "Дело", msg: "Сообщение" };

export function RecordDrawer({ recordId }: { recordId: string }) {
  const r = recById(recordId);
  const e = r ? entityCfg(r.entityId) : undefined;
  const [comment, setComment] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [taskKind, setTaskKind] = useState<TaskKind>("call");

  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest("[role=dialog]") || t.closest("[data-radix-popper-content-wrapper]"))) return;
      A.openRecord(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!r || !e) return null;
  const titleField = e.fields.find(f => f.id === e.titleFieldId)!;
  const tasks = getState().tasks.filter(t => t.recordId === r.id).sort((a, b) => Number(a.done) - Number(b.done) || a.due - b.due);
  const acts = getState().activities.filter(a => a.recordId === r.id).sort((a, b) => b.ts - a.ts);
  const stageIdx = e.stages?.findIndex(s => s.id === r.stageId) ?? -1;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/10 md:bg-transparent" onClick={() => A.openRecord(null)} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[500px] flex-col border-l bg-card shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.25)]"
        style={{ animation: "rise 0.22s var(--ease-out)" }}>
        <header className="flex items-start gap-2.5 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <input
              value={String(r.values[e.titleFieldId] ?? "")}
              onChange={ev => A.setValue(r.id, titleField, ev.target.value)}
              placeholder={recTitle(r.id)}
              className="w-full bg-transparent text-[15px] font-semibold outline-none placeholder:text-muted-foreground/60"
            />
            <div className="font-mono2 mt-0.5 text-[10.5px] text-muted-foreground">{e.name} №{r.num} · создана {relTime(r.createdAt)}</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><MoreVertical className="size-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="gap-2 text-destructive" onClick={() => A.deleteRecord(r.id)}><Trash2 className="size-4" /> Удалить запись</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" onClick={() => A.openRecord(null)}><X className="size-4" /></button>
        </header>

        {e.stages && (
          <div className="border-b px-4 py-2.5">
            <div className="flex gap-1">
              {e.stages.map((st, i) => (
                <button key={st.id} title={st.label} onClick={() => A.moveStage(r.id, st.id)}
                  className="h-4 flex-1 rounded-[3px] transition-all hover:opacity-80"
                  style={{ background: i <= stageIdx ? st.color : "hsl(var(--muted))" }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10.5px]">
              <span className="font-medium">{e.stages[stageIdx]?.label}</span>
              <span className="text-muted-foreground">клик по полосе — смена стадии</span>
            </div>
          </div>
        )}

        <LinkToPipeline rec={r} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="px-4 py-3.5">
            <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Ответственный</label>
                <OwnerPicker rec={r} />
              </div>
              {e.fields.filter(f => f.id !== e.titleFieldId).map(f => (
                <div key={f.id} className={cn("flex flex-col gap-1", f.type === "textarea" && "sm:col-span-2")}>
                  <label className="eyebrow">{f.label}{f.required && <span style={{ color: "var(--brass-ink)" }}> *</span>}</label>
                  <FieldInput field={f} value={r.values[f.id]} onChange={v => A.setValue(r.id, f, v)} />
                </div>
              ))}
            </div>
          </section>

          <section className="border-t px-4 py-3.5">
            <div className="eyebrow mb-2">Задачи</div>
            <div className="flex flex-col gap-1.5">
              {tasks.map(t => {
                const Ic = TASK_ICON[t.kind];
                const overdue = !t.done && t.due < Date.now();
                return (
                  <div key={t.id} className="flex items-center gap-2.5 rounded-md border bg-background px-2.5 py-2">
                    <Checkbox checked={t.done} onCheckedChange={() => A.toggleTask(t.id)} />
                    <Ic className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className={cn("flex-1 text-[12.5px] leading-snug", t.done && "text-muted-foreground line-through")}>{t.title}</span>
                    <span className={cn("font-mono2 tnum text-[10.5px]", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {overdue ? "просрочено" : t.done ? "готово" : fmtDate(t.due)}
                    </span>
                    <UserChip id={t.ownerId} size={17} />
                  </div>
                );
              })}
              <div className="flex items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="grid h-9 w-9 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-muted">
                      {(() => { const Ic = TASK_ICON[taskKind]; return <Ic className="size-3.5" />; })()}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(Object.keys(TASK_ICON) as TaskKind[]).map(k => {
                      const Ic = TASK_ICON[k];
                      return <DropdownMenuItem key={k} onClick={() => setTaskKind(k)} className="gap-2"><Ic className="size-3.5" /> {TASK_NAME[k]}</DropdownMenuItem>;
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Input
                  value={taskDraft} onChange={ev => setTaskDraft(ev.target.value)}
                  onKeyDown={ev => { if (ev.key === "Enter" && taskDraft.trim()) { A.addTask(r.id, taskDraft.trim(), taskKind, 24); setTaskDraft(""); } }}
                  placeholder="Новая задача (на завтра) + Enter" className="h-9 text-[12.5px]"
                />
              </div>
            </div>
          </section>

          <RelatedBlock recId={r.id} />

          <section className="border-t px-4 py-3.5">
            <div className="eyebrow mb-2">Хронология</div>
            <div className="mb-2.5 flex gap-1.5">
              <Input
                value={comment} onChange={ev => setComment(ev.target.value)}
                onKeyDown={ev => { if (ev.key === "Enter" && comment.trim()) { A.addComment(r.id, comment.trim()); setComment(""); } }}
                placeholder="Комментарий — видит вся команда…" className="h-9 text-[12.5px]"
              />
              <Button size="sm" className="h-9" disabled={!comment.trim()} onClick={() => { A.addComment(r.id, comment.trim()); setComment(""); }}>OK</Button>
            </div>
            <div className="flex flex-col gap-2.5">
              {acts.map(a => (
                <div key={a.id} className="flex items-baseline gap-2.5">
                  <span className="font-mono2 w-14 shrink-0 text-[10px] text-muted-foreground">{relTime(a.ts)}</span>
                  <div className="min-w-0">
                    <div className={cn("text-[12.5px] leading-snug", a.kind === "comment" && "rounded-md bg-muted/70 px-2.5 py-1.5")}>{a.text}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{a.userId ? userName(a.userId) + " · " : ""}{fmtDateTime(a.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

// Связанное: вся история клиента в одном месте — записи, ссылающиеся сюда, и его диалоги
function RelatedBlock({ recId }: { recId: string }) {
  const { records, chats } = relatedOf(recId);
  if (!records.length && !chats.length) return null;
  return (
    <section className="border-t px-4 py-3.5">
      <div className="eyebrow mb-2">Связанное</div>
      <div className="flex flex-col gap-1.5">
        {records.map(rr => {
          const e = entCfg(rr.entityId);
          const stg = e.stages?.find(x => x.id === rr.stageId);
          return (
            <button key={rr.id} onClick={() => A.openRecord(rr.id)}
              className="press flex items-center gap-2.5 rounded-md border bg-background px-2.5 py-2 text-left transition-colors hover:border-foreground/25">
              <span className="text-[11px] text-muted-foreground">{e.name}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{recTitle(rr.id)}</span>
              {stg && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px]" style={{ background: stg.color + "18", borderColor: stg.color + "50" }}>
                  <span className="size-1 rounded-full" style={{ background: stg.color }} />{stg.label}
                </span>
              )}
            </button>
          );
        })}
        {chats.map(c => (
          <button key={c.id} onClick={() => { A.openChat(c.id); A.goto("inbox"); }}
            className="press flex items-center gap-2.5 rounded-md border border-dashed bg-background px-2.5 py-2 text-left transition-colors hover:border-foreground/25">
            <span className="text-[11px] text-muted-foreground">диалог</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.name}</span>
            <span className="font-mono2 shrink-0 text-[10px] text-muted-foreground">{c.msgs.length} сообщ.</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// «Подтянуть в воронку»: если какой-то раздел со стадиями умеет ссылаться на этот раздел —
// одной кнопкой создаём в нём запись, уже связанную с текущей (напр. из клиента → новая сделка).
function LinkToPipeline({ rec }: { rec: { id: string; entityId: string } }) {
  const pipe = allEntities().find(en => en.id !== rec.entityId && (en.stages?.length ?? 0) > 0
    && en.fields.some(fl => fl.type === "relation" && fl.relationTo === rec.entityId));
  if (!pipe) return null;
  const field = pipe.fields.find(fl => fl.type === "relation" && fl.relationTo === rec.entityId)!;
  const linked = getState().records.filter(r => r.entityId === pipe.id && r.values[field.id] === rec.id);
  const create = () => {
    const id = A.createRecord(pipe.id, { [field.id]: rec.id });
    A.openRecord(id);
  };
  return (
    <div className="border-b bg-card/40 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{pipe.namePlural} клиента{linked.length ? ` · ${linked.length}` : ""}</span>
        <Button size="sm" className="h-7 gap-1.5 px-2.5 text-[12px]" onClick={create}>
          <Plus className="size-3.5" /> {pipe.name}
        </Button>
      </div>
      {linked.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {linked.map(r => {
            const stg = pipe.stages?.find(x => x.id === r.stageId);
            return (
              <button key={r.id} onClick={() => A.openRecord(r.id)}
                className="press flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left transition-colors hover:border-foreground/25">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{recTitle(r.id)}</span>
                {stg && <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px]" style={{ background: stg.color + "18", borderColor: stg.color + "50" }}><span className="size-1 rounded-full" style={{ background: stg.color }} />{stg.label}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

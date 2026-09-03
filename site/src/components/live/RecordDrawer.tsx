// Карточка записи: поля, полоса стадий, задачи, хронология, Esc для закрытия
import { useEffect, useRef, useState } from "react";
import type { TaskKind } from "@/lib/model";
import { relTime, fmtDateTime, fmtDate } from "@/lib/model";
import { A, entityCfg, recById, recTitle, userName, getState, relatedOf, allEntities, collapseFieldRuns, missingRequired, isBlank, entityCfg as entCfg, recordsOf, phoneKey } from "@/lib/store";
import { sendChatMessage } from "@/lib/integrations";
import { toast } from "sonner";
import { fillTemplate, unfilledVars } from "@/lib/fill";
import { channelName, FIELD_TYPES, PALETTE, uid } from "@/lib/model";
import type { Field, Rec } from "@/lib/model";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldInput, RelationInput } from "./FieldInput";
import { OwnerPicker } from "./TableLive";
import { UserChip } from "./bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowUpRight, CalendarClock, ListChecks, Merge, MessageSquare, MoreVertical, Phone, Plus, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const TASK_ICON: Record<TaskKind, React.ElementType> = { call: Phone, meet: CalendarClock, todo: ListChecks, msg: MessageSquare };
const TASK_NAME: Record<TaskKind, string> = { call: "Звонок", meet: "Встреча", todo: "Дело", msg: "Сообщение" };

// «Фокус на поле»: стор просит карточку подсветить поле (перенос в «Проиграна» → «Причина отказа»)
// событием окна, а не импортом — стор о компонентах не знает. Просьба лежит здесь, пока
// карточка нужной записи не смонтируется и не заберёт её.
let wantFocus: { recId: string; fieldId: string } | null = null;
const focusWaiters = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("xxl:focus-field", ev => {
    const d = (ev as CustomEvent<{ recId: string; fieldId: string }>).detail;
    if (d?.recId && d?.fieldId) { wantFocus = d; focusWaiters.forEach(w => w()); }
  });
}

export function RecordDrawer({ recordId }: { recordId: string }) {
  const r = recById(recordId);
  const e = r ? entityCfg(r.entityId) : undefined;
  // подсвеченное поле: держим, пока оно пустое; заполнили — подсветка гаснет
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    setFocusId(null);
    const take = () => { if (wantFocus && wantFocus.recId === recordId) { setFocusId(wantFocus.fieldId); wantFocus = null; } };
    take();
    focusWaiters.add(take);
    return () => { focusWaiters.delete(take); };
  }, [recordId]);
  useEffect(() => {
    if (!focusId) return;
    // после собственного фокуса карточки (360 мс), иначе он перебьёт наш
    const t = window.setTimeout(() => {
      const el = document.getElementById(`fld_${recordId}_${focusId}`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.querySelector<HTMLElement>("button,input,textarea")?.focus();
    }, 450);
    return () => window.clearTimeout(t);
  }, [focusId, recordId]);
  const [merging, setMerging] = useState(false); // «Объединить с…» из меню
  useEffect(() => { setMerging(false); }, [recordId]);
  // Карточка открывается ровно поверх кнопки «+ Сделка». Второй щелчок двойного клика попадал
  // в полосу стадий и мгновенно помечал новую сделку «Проиграна». Первые 350 мс щелчки не берём.
  const [armed, setArmed] = useState(false);
  useEffect(() => { setArmed(false); const t = window.setTimeout(() => setArmed(true), 350); return () => window.clearTimeout(t); }, [recordId]);
  // Карточка — модальное окно: фокус входит в неё (иначе до первого поля 14 нажатий Tab),
  // а после закрытия возвращается туда, откуда её открыли, а не падает в body.
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    // Фокус ставим на саму карточку, а не в первое поле: тогда Tab сразу идёт по её
    // содержимому, а Escape закрывает карточку, не «выходя из поля» лишним нажатием.
    // Новая пустая карточка — фокус сразу в заголовок, чтобы печатать без лишнего клика;
    // раньше отложенный фокус на панель перебивал autoFocus поля.
    const t = window.setTimeout(() => {
      const title = asideRef.current?.querySelector<HTMLInputElement>('input[data-title-field]');
      if (title && !title.value) title.focus(); else asideRef.current?.focus();
    }, 360);
    return () => { window.clearTimeout(t); if (returnTo && document.body.contains(returnTo)) returnTo.focus(); };
  }, [recordId]);
  // Tab не должен выпадать из карточки в фон: там лежит то, чего человек сейчас не видит
  const trap = (ev: React.KeyboardEvent) => {
    if (ev.key !== "Tab") return;
    const nodes = asideRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
    if (!nodes?.length) return;
    const list = [...nodes].filter(n => n.offsetParent !== null);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  };
  const [comment, setComment] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [taskKind, setTaskKind] = useState<TaskKind>("call");

  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      const t = ev.target as HTMLElement | null;
      // Карточка сама теперь role="dialog" — не путаем её с ЧУЖИМ диалогом поверх неё
      const dlg = t?.closest("[role=dialog]");
      if ((dlg && !dlg.hasAttribute("data-drawer")) || t?.closest("[data-radix-popper-content-wrapper]")) return;
      // Первый Escape в поле — выйти из поля, а не выбросить карточку: человек правил дату,
      // передумал, нажал Escape — и терял всю карточку. Второй Escape закрывает.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) { t.blur(); return; }
      A.openRecord(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!r || !e) return null;
  const titleField = e.fields.find(f => f.id === e.titleFieldId)!;
  const tasks = getState().tasks.filter(t => t.recordId === r.id).sort((a, b) => Number(a.done) - Number(b.done) || a.due - b.due);
  const acts = collapseFieldRuns(getState().activities.filter(a => a.recordId === r.id).sort((a, b) => b.ts - a.ts));
  const stageIdx = e.stages?.findIndex(s => s.id === r.stageId) ?? -1;
  const gaps = missingRequired(r.id);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/10 md:bg-transparent" onClick={() => A.openRecord(null)} />
      <aside data-drawer role="dialog" aria-modal="true" aria-label={`Карточка: ${recTitle(r.id) || e.name}`}
        ref={asideRef} onKeyDown={trap} tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[500px] flex-col border-l bg-card shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.25)]"
        style={{ animation: "rise 0.22s var(--ease-out)", pointerEvents: armed ? undefined : "none" }}>
        <header className="flex items-start gap-2.5 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <label className="eyebrow block">{titleField.label}{titleField.required && <span style={{ color: "var(--brass-ink)" }}> *</span>}</label>
            <input
              value={String(r.values[e.titleFieldId] ?? "")}
              onChange={ev => A.setValue(r.id, titleField, ev.target.value)}
              placeholder={`${titleField.label}…`}
              autoFocus={!String(r.values[e.titleFieldId] ?? "")} data-title-field
              className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-[15px] font-semibold outline-none transition-colors focus:border-ring"
            />
            <div className="font-mono2 mt-1 text-[10.5px] text-muted-foreground">{e.name} №{r.num} · создана {relTime(r.createdAt)}</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Ещё действия" title="Ещё" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><MoreVertical className="size-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="gap-2" onClick={() => setMerging(true)}><Merge className="size-4" /> Объединить с…</DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-destructive" onClick={() => A.deleteRecord(r.id)}><Trash2 className="size-4" /> Удалить запись</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button aria-label="Закрыть карточку" title="Закрыть (Esc)" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" onClick={() => A.openRecord(null)}><X className="size-4" /></button>
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

        {gaps.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-[11.5px]"
            style={{ background: "hsl(var(--brass) / 0.12)" }}>
            <span className="font-medium" style={{ color: "var(--brass-ink)" }}>Не заполнено:</span>
            {gaps.map(f => (
              <button key={f.id} onClick={() => document.getElementById(`fld_${r.id}_${f.id}`)?.querySelector<HTMLElement>("input,textarea,button")?.focus()}
                className="press rounded border px-1.5 py-0.5 hover:border-foreground/30" style={{ borderColor: "var(--brass-ink)", color: "var(--brass-ink)" }}>
                {f.label}
              </button>
            ))}
            <span className="text-muted-foreground">— сохранить можно, но перед «выиграно» напомню</span>
          </div>
        )}

        <LinkToPipeline rec={r} />
        {merging ? <MergeWith rec={r} onClose={() => setMerging(false)} /> : <DuplicateHint rec={r} />}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="px-4 py-3.5">
            <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Ответственный</label>
                <OwnerPicker rec={r} />
              </div>
              {e.fields.filter(f => f.id !== e.titleFieldId).map(f => {
                const hl = focusId === f.id && isBlank(r.values[f.id]);
                return (
                  <div key={f.id} id={`fld_${r.id}_${f.id}`} data-highlight={hl ? "1" : undefined}
                    className={cn("flex flex-col gap-1 rounded-md transition-shadow", (f.type === "textarea" || f.type === "multiselect") && "sm:col-span-2",
                      hl && "-m-1.5 p-1.5 ring-2 ring-[hsl(var(--brass))]")}>
                    <label className="eyebrow" style={hl ? { color: "var(--brass-ink)" } : undefined}>
                      {f.label}{f.required && <span title="обязательное" style={{ color: isBlank(r.values[f.id]) ? "var(--brass-ink)" : undefined }}> *</span>}
                      {hl && <span className="ml-1.5 normal-case tracking-normal" style={{ color: "var(--brass-ink)" }}>— укажите</span>}
                    </label>
                    <FieldInput field={f} value={r.values[f.id]} onChange={v => A.setValue(r.id, f, v)} />
                  </div>
                );
              })}
            </div>
            <AddFieldInline entityId={e.id} />
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

          <ChatBlock recId={r.id} />

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
  const { records, chats: all } = relatedOf(recId);
  const primary = primaryChat(recId);
  const chats = all.filter(c => c.id !== primary?.id);
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

// Один человек = одна карточка. В справочнике (раздел без стадий) тот же телефон у другой
// записи — почти наверняка дубль: предлагаем слить, старшая карточка остаётся, задачи,
// история и связи переезжают в неё. Два шага — одно нажатие не должно уносить карточку.
function DuplicateHint({ rec }: { rec: Rec }) {
  const [armed, setArmed] = useState(false);
  const e = entityCfg(rec.entityId);
  if (e.stages?.length) return null;
  const phoneF = e.fields.find(f => f.type === "phone");
  const key = phoneF ? phoneKey(rec.values[phoneF.id]) : null;
  if (!phoneF || !key) return null;
  const dup = recordsOf(e.id).find(x => x.id !== rec.id && phoneKey(x.values[phoneF.id]) === key);
  if (!dup) return null;
  const [keep, drop] = dup.createdAt <= rec.createdAt ? [dup, rec] : [rec, dup];
  const merge = () => { A.mergeRecords(keep.id, drop.id); setArmed(false); };
  return (
    <div data-dup-hint className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-[11.5px]" style={{ background: "hsl(var(--brass) / 0.12)" }}>
      <span className="font-medium" style={{ color: "var(--brass-ink)" }}>Похожая запись по телефону:</span>
      <button onClick={() => A.openRecord(dup.id)} className="press truncate underline-offset-2 hover:underline" title="Открыть">«{recTitle(dup.id)}»</button>
      {!armed ? (
        <button onClick={() => setArmed(true)} className="press rounded border px-1.5 py-0.5 font-medium hover:bg-background" style={{ borderColor: "var(--brass-ink)", color: "var(--brass-ink)" }}>
          → Объединить
        </button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Останется «{recTitle(keep.id)}», вторая вольётся в неё и будет удалена. Ctrl+Z вернёт.</span>
          <button onClick={merge} className="press rounded border px-2 py-0.5 font-medium text-primary-foreground" style={{ background: "hsl(var(--primary))", borderColor: "transparent" }}>да, объединить</button>
          <button onClick={() => setArmed(false)} className="press rounded border px-2 py-0.5 text-muted-foreground">нет</button>
        </span>
      )}
    </div>
  );
}

// «Объединить с…» из меню карточки: выбираем вторую запись тем же комбобоксом с поиском,
// она вливается в ЭТУ карточку и удаляется.
function MergeWith({ rec, onClose }: { rec: Rec; onClose: () => void }) {
  const [pick, setPick] = useState<string | undefined>();
  const [armed, setArmed] = useState(false);
  const e = entityCfg(rec.entityId);
  const pseudo: Field = { id: "__merge", label: "С какой записью объединить", type: "relation", relationTo: e.id };
  const other = pick ? recById(pick) : undefined;
  const merge = () => { if (!other) return; A.mergeRecords(rec.id, other.id); onClose(); };
  return (
    <div data-merge-with className="border-b px-4 py-2.5" style={{ background: "hsl(var(--brass) / 0.12)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow" style={{ color: "var(--brass-ink)" }}>Объединить с…</span>
        <button onClick={onClose} aria-label="Не объединять" className="press rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      <div className="mt-1.5">
        <RelationInput f={pseudo} value={pick} onChange={v => { setPick(typeof v === "string" ? v : undefined); setArmed(false); }} exclude={[rec.id]} noCreate />
      </div>
      {other && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {!armed ? (
            <Button size="sm" className="h-7 gap-1.5 text-[12px]" onClick={() => setArmed(true)}><Merge className="size-3.5" /> Объединить</Button>
          ) : (
            <>
              <span className="text-muted-foreground">«{recTitle(other.id)}» вольётся в эту карточку и будет удалена: задачи, история и связи переедут сюда. Ctrl+Z вернёт.</span>
              <Button size="sm" className="h-7 text-[12px]" onClick={merge}>да, объединить</Button>
              <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => setArmed(false)}>нет</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Поле можно завести прямо из карточки: понял в моменте, что нужен «трек-номер» — добавил, не уходя в конструктор
function AddFieldInline({ entityId }: { entityId: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="press mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed px-2 text-[11.5px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
        <Plus className="size-3" /> поле
      </button>
    );
  }
  const save = () => {
    if (!label.trim()) return;
    // список без вариантов бесполезен — даём два стартовых, переименуют в конструкторе
    const options = type === "select" || type === "multiselect"
      ? ["Вариант 1", "Вариант 2"].map((l, i) => ({ id: uid("o"), label: l, color: PALETTE[i % PALETTE.length] })) : undefined;
    A.fieldAdd(entityId, { label: label.trim(), type: type as Field["type"], inTable: true, ...(options ? { options } : {}) });
    setLabel(""); setType("text"); setOpen(false);
  };
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-md border border-dashed p-2">
      <Input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Название поля"
        onKeyDown={e => e.key === "Enter" && save()} className="h-8 w-[150px] text-[12px]" />
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="h-8 w-[130px] text-[12px]"><SelectValue /></SelectTrigger>
        <SelectContent>{FIELD_TYPES.filter(t => t.type !== "relation").map(t => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" className="h-8 text-[12px]" disabled={!label.trim()} onClick={save}>Добавить</Button>
      <button onClick={() => setOpen(false)} className="press rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
    </div>
  );
}

// Главный диалог записи: привязанный напрямую, иначе самый свежий из связанных
function primaryChat(recId: string) {
  const { chats } = relatedOf(recId);
  const ts = (c: { msgs: { ts: number }[] }) => c.msgs[c.msgs.length - 1]?.ts ?? 0;
  return chats.find(c => c.recordId === recId) ?? [...chats].sort((a, b) => ts(b) - ts(a))[0];
}

// Переписка прямо в карточке: ответить клиенту, не уходя во Входящие — разделы перестают жить отдельно
function ChatBlock({ recId }: { recId: string }) {
  const chat = primaryChat(recId);
  const [draft, setDraft] = useState("");
  if (!chat) return null;
  const msgs = chat.msgs.slice(-6);
  const send = () => {
    if (!draft.trim()) return;
    const holes = unfilledVars(draft);
    if (holes.length) { toast.error(`Заполните ${holes.join(", ")}`, { description: "В тексте остались переменные — клиент получит их как есть" }); return; }
    sendChatMessage(chat.id, draft.trim());
    setDraft("");
  };
  return (
    <section className="border-t px-4 py-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow">Переписка · {channelName(chat.channel)}</span>
        {chat.ext && <span title="Настоящий диалог — ответ уйдёт клиенту" className="size-1.5 rounded-full" style={{ background: "#6E8B4F" }} />}
        <button onClick={() => { A.openChat(chat.id); A.goto("inbox"); A.openRecord(null); }}
          className="press ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          весь диалог <ArrowUpRight className="size-3" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {msgs.map(m => (
          <div key={m.id} className={cn("flex", m.out ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug", m.out ? "rounded-br-[3px] text-primary-foreground" : "rounded-bl-[3px] border bg-background")}
              style={m.out ? { background: "hsl(var(--primary))" } : undefined}>
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder={chat.ext ? "Ответить клиенту…" : "Ответить (демо-диалог)…"} className="h-9 text-[12.5px]" />
        <Button size="sm" className="h-9 w-9 p-0" disabled={!draft.trim()} onClick={send}><Send className="size-3.5" /></Button>
      </div>
      {getState().replyTemplates.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {getState().replyTemplates.slice(0, 4).map(t => (
            <button key={t.id} onClick={() => setDraft(fillTemplate(t.text, chat))}
              className="press h-6 rounded-full border px-2 text-[10.5px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
              {t.name}
            </button>
          ))}
        </div>
      )}
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

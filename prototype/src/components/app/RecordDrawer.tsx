// Карточка записи: поля, стадии, задачи, таймлайн, связи, AI (настоящий или демо), счёт
import { useEffect, useMemo, useState } from "react";
import { A, useApp, entityById, recById, recTitle, userName, dispCtx, getState, rollupValue, channelName } from "@/lib/store";
import type { TaskKind } from "@/lib/model";
import { fmtMoney, relTime, fmtDateTime, plural } from "@/lib/model";
import { aiReady, llm, recordContext } from "@/lib/ai";
import { toast } from "sonner";
import { FieldInput } from "./FieldInput";
import { OwnerPicker } from "./TableView";
import { DueLabel, UserChip } from "./bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CalendarClock, Copy, FileText, MessageSquare, MoreVertical, Phone, Plus, Sparkles, Trash2, X, Zap, CircleDot, ListChecks, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TASK_ICON: Record<TaskKind, React.ReactNode> = {
  call: <Phone className="size-3.5" />, meet: <CalendarClock className="size-3.5" />,
  todo: <ListChecks className="size-3.5" />, msg: <MessageSquare className="size-3.5" />,
};

export function RecordDrawer({ recordId }: { recordId: string }) {
  const s = useApp();
  const r = recById(recordId);
  const e = entityById(r?.entityId);
  const [comment, setComment] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [taskKind, setTaskKind] = useState<TaskKind>("call");
  const [ai, setAi] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

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
  const ws = s.ws!;
  const titleField = e.fields.find(f => f.id === e.titleFieldId)!;
  const hasMoney = e.fields.some(f => f.type === "money");
  const linkedChat = ws.chats.find(c => c.recordId === r.id);
  const tasks = s.ws!.tasks.filter(t => t.recordId === r.id).sort((a, b) => Number(a.done) - Number(b.done) || a.due - b.due);
  const acts = s.ws!.activities.filter(a => a.recordId === r.id).sort((a, b) => b.ts - a.ts);

  const related = useMemo(() => {
    const ws = getState().ws!;
    const groups: { entity: NonNullable<ReturnType<typeof entityById>>; recs: typeof ws.records }[] = [];
    for (const oe of ws.entities) {
      if (oe.id === e.id) continue;
      const relFields = oe.fields.filter(f => f.type === "relation" && f.relationTo === e.id);
      if (!relFields.length) continue;
      const recs = ws.records.filter(x => x.entityId === oe.id && relFields.some(f => x.values[f.id] === r.id));
      if (recs.length) groups.push({ entity: oe, recs });
    }
    return groups;
  }, [s.ws!.records, r.id, e.id, acts.length]);

  const fallbackSummary = () => {
    const money = e.fields.find(f => f.type === "money");
    const stage = e.pipeline?.stages.find(x => x.id === r.stageId);
    const open = tasks.filter(t => !t.done);
    const daysIn = Math.max(1, Math.round((Date.now() - (r.stageAt ?? r.createdAt)) / 86400000));
    const lastComment = acts.find(a => a.kind === "comment");
    return [
      `${recTitle(r.id)} — ${e.name.toLowerCase()}${money && r.values[money.id] ? ` на ${fmtMoney(r.values[money.id])}` : ""}, ведёт ${userName(r.ownerId)}.`,
      stage ? `Стадия «${stage.label}» уже ${daysIn} ${plural(daysIn, "день", "дня", "дней")}.` : "",
      lastComment ? `Последний комментарий: «${lastComment.text}».` : "",
      open.length ? `Открытых задач: ${open.length} (ближайшая — «${open[0].title}»).` : "Открытых задач нет — стоит назначить следующий шаг.",
      stage && stage.kind === "open" && daysIn >= 3 ? "Рекомендация: запись давно без движения — свяжитесь с клиентом сегодня." : "Рекомендация: держите темп, следующий шаг запланирован.",
    ].filter(Boolean).join(" ");
  };

  const genAI = async (kind: "summary" | "reply" = "summary") => {
    if (!aiReady()) {
      if (kind === "reply") { toast("Для черновика ответа нужен API-ключ — Настройки → AI"); return; }
      setAi(fallbackSummary());
      return;
    }
    setAiBusy(true); setAi(kind === "summary" ? "Думаю над резюме…" : "Пишу черновик ответа…");
    try {
      const sys = "Ты — AI-ассистент CRM-системы XXLcrm. Отвечай по-русски, кратко и по делу, без воды.";
      const prompt = kind === "summary"
        ? `Сделай резюме записи CRM в 3–4 предложениях: суть, статус, риски. В конце одной строкой: «Следующий шаг: …». Данные:\n${recordContext(r)}`
        : `Напиши короткий черновик сообщения клиенту от лица менеджера (дружелюбно, на «вы», 2–4 предложения, без темы письма) по контексту записи CRM. Цель — продвинуть запись на следующий шаг. Данные:\n${recordContext(r)}`;
      setAi(await llm(sys, prompt));
    } catch (err) {
      setAi(null);
      toast.error(String((err as Error).message ?? err).slice(0, 140));
    } finally { setAiBusy(false); }
  };

  const invoice = () => {
    const money = e.fields.find(f => f.type === "money");
    const client = e.fields.filter(f => f.type === "relation").map(f => r.values[f.id]).filter(Boolean).map(id => recTitle(id as string))[0];
    const sum = Number(money ? r.values[money.id] : 0) || 0;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Счёт №СЧ-${r.num}</title>
      <style>body{font-family:Georgia,serif;max-width:640px;margin:48px auto;color:#221e16}
      .top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #221e16;padding-bottom:12px}
      h1{font-size:22px;margin:0} .brass{color:#8a6f2f} table{width:100%;border-collapse:collapse;margin-top:28px}
      td,th{border:1px solid #d8d2c2;padding:10px 12px;text-align:left;font-size:14px} th{background:#f5f1e6}
      .sum{font-size:18px;font-weight:bold;text-align:right;margin-top:16px}.muted{color:#77705f;font-size:12px;margin-top:36px}</style></head><body>
      <div class="top"><h1>Счёт <span class="brass">№СЧ-${r.num}</span></h1><div>${new Date().toLocaleDateString("ru-RU")}</div></div>
      <p>Исполнитель: <b>${ws.name}</b><br>Заказчик: <b>${client ?? recTitle(r.id)}</b></p>
      <table><tr><th>№</th><th>Наименование</th><th>Сумма</th></tr>
      <tr><td>1</td><td>${recTitle(r.id)}</td><td>${sum.toLocaleString("ru-RU")} ₽</td></tr></table>
      <div class="sum">Итого к оплате: ${sum.toLocaleString("ru-RU")} ₽</div>
      <p class="muted">Сформировано в XXLcrm (прототип): документ по шаблону из данных записи. Печать: Ctrl+P → сохранить как PDF.</p>
      <script>window.print()</script></body></html>`;
    try {
      const w = window.open("", "_blank");
      if (!w) throw new Error("popup");
      w.document.write(html); w.document.close();
    } catch { toast("Не удалось открыть окно печати (заблокированы всплывающие окна)"); }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/10 md:hidden" onClick={() => A.openRecord(null)} />
      <aside className="drawer-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l bg-card" style={{ boxShadow: "var(--shadow-drawer)" }}>
        <header className="flex items-start gap-2 border-b px-4 py-3 md:px-5">
          <span className="mt-0.5 text-lg">{e.icon}</span>
          <div className="min-w-0 flex-1">
            <input
              value={String(r.values[e.titleFieldId] ?? "")}
              onChange={ev => A.setValue(r.id, titleField, ev.target.value)}
              placeholder={recTitle(r.id)}
              className="w-full bg-transparent text-[16px] font-semibold outline-none placeholder:text-muted-foreground/60"
            />
            <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
              {e.name} №{r.num} · создана {relTime(r.createdAt)}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={() => genAI("summary")} disabled={aiBusy}>
            <Sparkles className="size-4" style={{ color: "var(--brass-ink)" }} /> AI
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><MoreVertical className="size-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {hasMoney && <DropdownMenuItem className="gap-2" onClick={invoice}><FileText className="size-4" /> Счёт (печать / PDF)</DropdownMenuItem>}
              {linkedChat && <DropdownMenuItem className="gap-2" onClick={() => A.openChat(linkedChat.id)}><MessageSquare className="size-4" /> Диалог в {channelName(linkedChat.channel)}</DropdownMenuItem>}
              <DropdownMenuItem className="gap-2 text-destructive" onClick={() => A.deleteRecord(r.id)}><Trash2 className="size-4" /> Удалить запись</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" onClick={() => A.openRecord(null)}><X className="size-4" /></button>
        </header>

        {e.pipeline && (
          <div className="border-b px-4 py-2.5 md:px-5">
            <div className="flex gap-1">
              {e.pipeline.stages.map(st => {
                const idx = e.pipeline!.stages.findIndex(x => x.id === r.stageId);
                const my = e.pipeline!.stages.findIndex(x => x.id === st.id);
                const passed = my <= idx;
                return (
                  <button
                    key={st.id} title={st.label}
                    onClick={() => A.moveStage(r.id, st.id)}
                    className="group/st h-5 flex-1 rounded-[4px] transition-all"
                    style={{ background: passed ? st.color : "hsl(43 18% 88%)" }}
                  >
                    <span className="sr-only">{st.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[12px]">
              <span className="font-medium">{e.pipeline.stages.find(x => x.id === r.stageId)?.label}</span>
              <span className="text-muted-foreground">клик по полосе — смена стадии</span>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {ai && (
            <div className="mx-4 mt-3 rounded-lg border p-3 text-[13px] leading-relaxed md:mx-5" style={{ background: "hsl(42 42% 55% / 0.08)", borderColor: "hsl(42 42% 55% / 0.35)" }}>
              <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--brass-ink)" }}>
                <Sparkles className="size-3.5" /> {aiReady() ? "AI-ассистент" : "AI · демо без ключа"}
                <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setAi(null)}><X className="size-3.5" /></button>
              </div>
              <div className="whitespace-pre-wrap">{ai}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-7 gap-1 text-[11.5px]" disabled={aiBusy} onClick={() => genAI("summary")}>
                  <Sparkles className="size-3" /> Резюме
                </Button>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-[11.5px]" disabled={aiBusy} onClick={() => genAI("reply")}>
                  <MessageSquare className="size-3" /> Черновик ответа
                </Button>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-[11.5px]"
                  onClick={() => { navigator.clipboard?.writeText(ai).then(() => toast("Скопировано")); }}>
                  <Copy className="size-3" /> Копировать
                </Button>
                {!aiReady() && <span className="text-[11px] text-muted-foreground">Ключ для настоящего AI — в Настройках</span>}
              </div>
            </div>
          )}

          <section className="px-4 py-3 md:px-5">
            <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11.5px] font-medium text-muted-foreground">Ответственный</label>
                <OwnerPicker rec={r} />
              </div>
              {e.fields.filter(f => f.id !== e.titleFieldId).map(f => (
                <div key={f.id} className={cn("flex flex-col gap-1", f.type === "textarea" && "sm:col-span-2")}>
                  <label className="text-[11.5px] font-medium text-muted-foreground">
                    {f.label}{f.required && <span style={{ color: "var(--brass-ink)" }}> *</span>}
                  </label>
                  {f.type === "rollup" ? (
                    <div className="flex h-9 items-center rounded-md border border-dashed px-2.5 text-sm font-medium tnum">
                      {(() => { const v = rollupValue(f, r); const t = f.rollup?.targetFieldId ? getState().ws!.entities.find(x => x.id === f.rollup!.entityId)?.fields.find(x => x.id === f.rollup!.targetFieldId) : undefined; return f.rollup?.agg === "sum" && t?.type === "money" ? (fmtMoney(v) || "0 ₽") : v; })()}
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">авто</span>
                    </div>
                  ) : (
                    <FieldInput field={f} value={r.values[f.id]} onChange={v => A.setValue(r.id, f, v)} />
                  )}
                </div>
              ))}
            </div>
          </section>

          {related.length > 0 && (
            <section className="border-t px-4 py-3 md:px-5">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground"><Link2 className="size-3.5" /> Связанные записи</div>
              <div className="flex flex-col gap-1">
                {related.map(g => g.recs.map(x => (
                  <button key={x.id} onClick={() => { A.go("entity", g.entity.id); A.openRecord(x.id); }}
                    className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left text-[13px] hover:bg-muted">
                    <span>{g.entity.icon}</span>
                    <span className="flex-1 truncate">{recTitle(x.id)}</span>
                    <span className="text-[11.5px] text-muted-foreground">{g.entity.name}</span>
                  </button>
                )))}
              </div>
            </section>
          )}

          <section className="border-t px-4 py-3 md:px-5">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground"><ListChecks className="size-3.5" /> Задачи</div>
            <div className="flex flex-col gap-1.5">
              {tasks.map(t => (
                <div key={t.id} className="flex items-center gap-2.5 rounded-md border bg-background px-2.5 py-2">
                  <Checkbox checked={t.done} onCheckedChange={() => A.toggleTask(t.id)} />
                  <span className="text-muted-foreground">{TASK_ICON[t.kind]}</span>
                  <span className={cn("flex-1 text-[13px] leading-snug", t.done && "text-muted-foreground line-through")}>{t.title}</span>
                  <DueLabel due={t.due} done={t.done} />
                  <UserChip id={t.ownerId} size={18} />
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="grid h-8 w-8 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-muted">{TASK_ICON[taskKind]}</button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(Object.keys(TASK_ICON) as TaskKind[]).map(k => (
                      <DropdownMenuItem key={k} onClick={() => setTaskKind(k)} className="gap-2">
                        {TASK_ICON[k]} {{ call: "Звонок", meet: "Встреча", todo: "Дело", msg: "Сообщение" }[k]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Input
                  value={taskDraft} onChange={ev => setTaskDraft(ev.target.value)}
                  onKeyDown={ev => { if (ev.key === "Enter" && taskDraft.trim()) { A.addTask(r.id, taskDraft.trim(), taskKind, 24); setTaskDraft(""); } }}
                  placeholder="Новая задача (на завтра) + Enter" className="h-8 text-[13px]"
                />
              </div>
            </div>
          </section>

          <section className="border-t px-4 py-3 md:px-5">
            <div className="mb-2 text-[12px] font-semibold text-muted-foreground">Хронология</div>
            <div className="mb-2.5 flex gap-1.5">
              <Input
                value={comment} onChange={ev => setComment(ev.target.value)}
                onKeyDown={ev => { if (ev.key === "Enter" && comment.trim()) { A.addComment(r.id, comment.trim()); setComment(""); } }}
                placeholder="Комментарий… (видит вся команда)" className="h-8.5 h-9 text-[13px]"
              />
              <Button size="sm" className="h-9" disabled={!comment.trim()} onClick={() => { A.addComment(r.id, comment.trim()); setComment(""); }}>OK</Button>
            </div>
            <div className="flex flex-col">
              {acts.map(a => (
                <div key={a.id} className="flex gap-2.5 border-l pl-3 pb-3 last:pb-1" style={{ borderColor: "hsl(43 18% 85%)" }}>
                  <span className="mt-1 -ml-[19px] grid size-2.5 h-2.5 w-2.5 place-items-center rounded-full border bg-card">
                    {a.kind === "auto" && <Zap className="size-2" style={{ color: "var(--brass-ink)" }} />}
                    {a.kind !== "auto" && <CircleDot className="size-2 text-muted-foreground/60" />}
                  </span>
                  <div className="min-w-0">
                    <div className={cn("text-[13px] leading-snug", a.kind === "comment" && "rounded-md bg-muted/70 px-2.5 py-1.5")}>{a.text}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {a.userId ? userName(a.userId) + " · " : a.kind === "auto" ? "автоматизация · " : ""}{fmtDateTime(a.ts)}
                    </div>
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

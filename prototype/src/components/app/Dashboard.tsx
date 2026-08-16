// Дашборд: живые виджеты по данным + конструктор виджетов
import { useState } from "react";
import { A, useApp, entityById, recTitle, userName } from "@/lib/store";
import type { Rec, Widget } from "@/lib/model";
import { fmtMoney, relTime, sameMonth, isToday, DAY, plural } from "@/lib/model";
import { aiReady, llm, crmContext } from "@/lib/ai";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

const inPeriod = (ts: number, p?: Widget["period"]) =>
  !p || p === "all" ? true : p === "today" ? isToday(ts) : p === "week" ? ts > Date.now() - 7 * DAY : sameMonth(ts);

export function Dashboard() {
  const s = useApp();
  const ws = s.ws!;
  const [addOpen, setAddOpen] = useState(false);

  const recsOf = (w: Widget) => {
    let rs = ws.records.filter(r => r.entityId === w.entityId);
    const e = entityById(w.entityId);
    if (w.openOnly && e?.pipeline) rs = rs.filter(r => e.pipeline!.stages.find(x => x.id === r.stageId)?.kind === "open");
    if (w.period && w.period !== "all") rs = rs.filter(r => inPeriod(r.createdAt, w.period));
    return rs;
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Дашборд</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Виджеты считаются по живым данным — измените сделку и вернитесь сюда.</p>
          </div>
          <Button size="sm" className="h-8 gap-1" onClick={() => setAddOpen(true)}><Plus className="size-4" /> Виджет</Button>
        </div>

        <AskCrm />

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {ws.widgets.map(w => (
            <div key={w.id} className={cn("group/w relative rounded-xl border bg-card p-4", (w.type === "funnel" || w.type === "bars" || w.type === "activity") && "col-span-2")}>
              <button
                onClick={() => A.deleteWidget(w.id)}
                className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/w:opacity-100"
                title="Удалить виджет"
              >
                <X className="size-3.5" />
              </button>
              <WidgetBody w={w} recs={recsOf(w)} />
            </div>
          ))}
        </div>
      </div>
      <AddWidgetDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function AskCrm() {
  const [q, setQ] = useState("");
  const [a, setA] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    if (!q.trim()) return;
    if (!aiReady()) { toast("«Спроси CRM» работает с API-ключом: Настройки → AI"); return; }
    setBusy(true); setA("Считаю…");
    try {
      setA(await llm(
        "Ты — аналитик CRM-системы XXLcrm. Отвечай по-русски, кратко, с числами из данных. Если данных не хватает — так и скажи.",
        `Вопрос пользователя: «${q.trim()}»\n\nДанные CRM:\n${crmContext()}`
      ));
    } catch (err) { setA(null); toast.error(String((err as Error).message ?? err).slice(0, 140)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-lg">
          <Sparkles className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" style={{ color: "var(--brass-ink)" }} />
          <Input
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && ask()}
            placeholder={aiReady() ? "Спроси CRM: «сколько сделок в работе и на какую сумму?»" : "Спроси CRM (нужен API-ключ в Настройках)…"}
            className="h-9 pl-9"
          />
        </div>
        <Button size="sm" className="h-9" onClick={ask} disabled={busy || !q.trim()}>Спросить</Button>
      </div>
      {a && (
        <div className="fade-in mt-2 max-w-lg whitespace-pre-wrap rounded-lg border p-3 text-[13px] leading-relaxed" style={{ background: "hsl(42 42% 55% / 0.08)", borderColor: "hsl(42 42% 55% / 0.35)" }}>
          {a}
          <button className="ml-2 text-[11.5px] text-muted-foreground hover:text-foreground" onClick={() => setA(null)}>скрыть</button>
        </div>
      )}
    </div>
  );
}

function WidgetBody({ w, recs }: { w: Widget; recs: Rec[] }) {
  const s = useApp();
  const ws = s.ws!;
  const e = entityById(w.entityId);

  if (w.type === "number") {
    const val = w.metric === "sum" && w.fieldId ? recs.reduce((sum, r) => sum + (Number(r.values[w.fieldId!]) || 0), 0) : recs.length;
    return (
      <div>
        <div className="text-[12px] font-medium text-muted-foreground">{w.title}</div>
        <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight tnum">{w.metric === "sum" ? fmtMoney(val) || "0 ₽" : val}</div>
        <div className="mt-1.5 text-[11.5px] text-muted-foreground">
          {e ? e.namePlural : ""}{w.period === "month" ? " · месяц" : w.period === "week" ? " · 7 дней" : w.period === "today" ? " · сегодня" : ""}{w.openOnly ? " · в работе" : ""}
        </div>
      </div>
    );
  }

  if (w.type === "plan") {
    const won = ws.records.filter(r => {
      if (r.entityId !== w.entityId) return false;
      const st = e?.pipeline?.stages.find(x => x.id === r.stageId);
      return st?.kind === "won" && sameMonth(r.stageAt ?? r.updatedAt);
    });
    const fact = won.reduce((sum, r) => sum + (Number(r.values[w.fieldId ?? ""]) || 0), 0);
    const pct = Math.min(100, Math.round((fact / (w.target || 1)) * 100));
    return (
      <div>
        <div className="text-[12px] font-medium text-muted-foreground">{w.title}</div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
          <span className="whitespace-nowrap text-[21px] font-semibold leading-tight tracking-tight tnum">{fmtMoney(fact) || "0 ₽"}</span>
          <span className="whitespace-nowrap text-[12px] text-muted-foreground tnum">/ {fmtMoney(w.target)}</span>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + "%", background: "hsl(41 46% 45%)" }} />
        </div>
        <div className="mt-1.5 text-[11.5px] text-muted-foreground tnum">{pct}% плана · {won.length} {plural(won.length, "успешная", "успешные", "успешных")}</div>
      </div>
    );
  }

  if (w.type === "funnel" && e?.pipeline) {
    const stages = e.pipeline.stages.filter(x => x.kind !== "lost");
    const all = ws.records.filter(r => r.entityId === e.id);
    const idxOf = (id?: string) => e.pipeline!.stages.findIndex(x => x.id === id);
    const counts = stages.map(st => {
      const i = idxOf(st.id);
      return all.filter(r => idxOf(r.stageId) >= i && e.pipeline!.stages[idxOf(r.stageId)]?.kind !== "lost").length;
    });
    const max = Math.max(1, counts[0] ?? 1);
    return (
      <div>
        <div className="text-[12px] font-medium text-muted-foreground">{w.title}</div>
        <div className="mt-3 flex flex-col gap-1.5">
          {stages.map((st, i) => (
            <div key={st.id} className="flex items-center gap-2.5">
              <span className="w-28 truncate text-[12px] text-muted-foreground">{st.label}</span>
              <div className="h-[18px] flex-1 overflow-hidden rounded-[4px] bg-muted/60">
                <div className="flex h-full items-center rounded-[4px] pl-2 text-[10.5px] font-semibold text-white/95 transition-all duration-500"
                  style={{ width: Math.max(7, (counts[i] / max) * 100) + "%", background: st.color }}>
                  {counts[i]}
                </div>
              </div>
              <span className="w-10 text-right text-[11.5px] text-muted-foreground tnum">{Math.round((counts[i] / max) * 100)}%</span>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11.5px] text-muted-foreground">Дошло до стадии, от всех созданных ({max})</div>
      </div>
    );
  }

  if (w.type === "bars" && e) {
    const f = e.fields.find(x => x.id === w.groupFieldId);
    const groups = new Map<string, number>();
    for (const r of recs) {
      const v = r.values[f?.id ?? ""];
      const key = f?.type === "user" ? (userName(v as string) || "Не назначен") : (f?.options?.find(o => o.id === v)?.label ?? "Не указано");
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = Math.max(1, ...rows.map(r => r[1]));
    return (
      <div>
        <div className="text-[12px] font-medium text-muted-foreground">{w.title}</div>
        <div className="mt-3 flex flex-col gap-1.5">
          {rows.map(([label, n], i) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className="w-28 truncate text-[12px] text-muted-foreground">{label}</span>
              <div className="h-[18px] flex-1 overflow-hidden rounded-[4px] bg-muted/60">
                <div className="h-full rounded-[4px] transition-all duration-500" style={{ width: (n / max) * 100 + "%", background: i === 0 ? "hsl(41 46% 48%)" : "hsl(42 25% 70%)" }} />
              </div>
              <span className="w-8 text-right text-[12px] tnum">{n}</span>
            </div>
          ))}
          {rows.length === 0 && <div className="text-[12.5px] text-muted-foreground">Нет данных для группировки</div>}
        </div>
      </div>
    );
  }

  if (w.type === "activity") {
    const acts = [...ws.activities].sort((a, b) => b.ts - a.ts).slice(0, 7);
    return (
      <div>
        <div className="text-[12px] font-medium text-muted-foreground">{w.title}</div>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {acts.map(a => {
            const r = ws.records.find(x => x.id === a.recordId);
            const en = r ? entityById(r.entityId) : undefined;
            return (
              <button key={a.id} className="flex items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/60"
                onClick={() => { if (r && en) { A.go("entity", en.id); A.openRecord(r.id); } }}>
                <span className="shrink-0 text-[11px] text-muted-foreground tnum">{relTime(a.ts)}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px]">
                  <b className="font-medium">{r ? recTitle(r.id) : "—"}</b> · {a.text}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return <div className="text-[12.5px] text-muted-foreground">{w.title}: нет данных (проверьте раздел/воронку)</div>;
}

function AddWidgetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useApp();
  const ws = s.ws!;
  const [type, setType] = useState<Widget["type"]>("number");
  const [entityId, setEntityId] = useState(ws.entities[0]?.id);
  const [metric, setMetric] = useState<"count" | "sum">("count");
  const [fieldId, setFieldId] = useState<string | undefined>();
  const [groupFieldId, setGroupFieldId] = useState<string | undefined>();
  const [period, setPeriod] = useState<Widget["period"]>("all");
  const [target, setTarget] = useState("1000000");
  const [title, setTitle] = useState("");

  const e = entityById(entityId);
  const moneyFields = e?.fields.filter(f => f.type === "money") ?? [];
  const groupFields = e?.fields.filter(f => f.type === "select" || f.type === "user") ?? [];

  const add = () => {
    const name = title.trim() || ({ number: metric === "sum" ? "Сумма" : "Количество", funnel: "Воронка", bars: "Распределение", plan: "План", activity: "Последние события" }[type] + (e ? ` · ${e.namePlural}` : ""));
    A.addWidget({
      type, title: name,
      entityId: type === "activity" ? undefined : entityId,
      metric: type === "number" ? metric : undefined,
      fieldId: type === "plan" ? (fieldId ?? moneyFields[0]?.id) : metric === "sum" ? (fieldId ?? moneyFields[0]?.id) : undefined,
      groupFieldId: type === "bars" ? (groupFieldId ?? groupFields[0]?.id) : undefined,
      target: type === "plan" ? Number(target) || 0 : undefined,
      period,
    });
    onOpenChange(false); setTitle("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-[15px]">Новый виджет</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Тип</label>
              <Select value={type} onValueChange={v => setType(v as Widget["type"])}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">Число (кол-во / сумма)</SelectItem>
                  <SelectItem value="plan">План / факт</SelectItem>
                  <SelectItem value="funnel">Воронка</SelectItem>
                  <SelectItem value="bars">Распределение</SelectItem>
                  <SelectItem value="activity">Лента событий</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type !== "activity" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Раздел</label>
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{ws.entities.map(en => <SelectItem key={en.id} value={en.id}>{en.icon} {en.namePlural}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          {type === "number" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Метрика</label>
                <Select value={metric} onValueChange={v => setMetric(v as "count")}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">Количество записей</SelectItem>
                    <SelectItem value="sum" disabled={!moneyFields.length}>Сумма по полю-деньгам</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {metric === "sum" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Поле</label>
                  <Select value={fieldId ?? moneyFields[0]?.id} onValueChange={setFieldId}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{moneyFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          {type === "bars" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Группировать по</label>
              <Select value={groupFieldId ?? groupFields[0]?.id} onValueChange={setGroupFieldId}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Поле-список или сотрудник" /></SelectTrigger>
                <SelectContent>{groupFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {type === "plan" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Поле-деньги</label>
                <Select value={fieldId ?? moneyFields[0]?.id} onValueChange={setFieldId}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{moneyFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Цель, ₽/мес</label>
                <Input className="mt-1 h-9 tnum" type="number" value={target} onChange={e2 => setTarget(e2.target.value)} />
              </div>
            </div>
          )}
          {type === "number" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Период</label>
              <Select value={period} onValueChange={v => setPeriod(v as Widget["period"])}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Всё время</SelectItem>
                  <SelectItem value="month">Этот месяц</SelectItem>
                  <SelectItem value="week">7 дней</SelectItem>
                  <SelectItem value="today">Сегодня</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Название (необязательно)</label>
            <Input className="mt-1 h-9" value={title} onChange={e2 => setTitle(e2.target.value)} placeholder="Автоматически" />
          </div>
          <Button onClick={add}>Добавить на дашборд</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

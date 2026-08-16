// Экран раздела: вкладки представлений, тулбар, фильтры, рендер активного представления
import { useState } from "react";
import { A, useApp, entityById, recTitle, dispCtx, getState } from "@/lib/store";
import type { View, FilterRule, Field } from "@/lib/model";
import { plural, matchRule, displayValue, OPS_BY_TYPE, uid } from "@/lib/model";
import { TableView } from "./TableView";
import { KanbanView } from "./KanbanView";
import { CalendarView } from "./CalendarView";
import { CardsView } from "./CardsView";
import { EntitySettings } from "./EntitySettings";
import { ImportDialog } from "./ImportDialog";
import { WebFormDialog } from "./WebFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Columns3, FileUp, LayoutGrid, ListFilter, MoreHorizontal, PanelTop, Plus, Search, Settings2, Table2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEW_ICON = { table: Table2, kanban: Columns3, calendar: Calendar, cards: LayoutGrid };
const VIEW_NAME = { table: "Таблица", kanban: "Канбан", calendar: "Календарь", cards: "Карточки" };

export function EntityScreen({ entityId }: { entityId: string }) {
  const s = useApp();
  const e = entityById(entityId);
  const [q, setQ] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  if (!e) return null;

  const view = e.views.find(v => v.id === s.activeView[entityId]) ?? e.views[0];

  let records = s.ws!.records.filter(r => r.entityId === entityId);
  if (mineOnly) records = records.filter(r => r.ownerId === s.currentUserId);
  const qq = q.trim().toLowerCase();
  if (qq) records = records.filter(r => {
    const hay = [recTitle(r.id), ...e.fields.map(f => String(r.values[f.id] ?? ""))].join(" ").toLowerCase();
    return hay.includes(qq);
  });
  const rules = view.filters ?? [];
  if (rules.length) records = records.filter(r => {
    const res = rules.map(rule => {
      const f = e.fields.find(x => x.id === rule.fieldId);
      if (!f) return true;
      return matchRule(f, r.values[f.id], rule, displayValue(f, r.values[f.id], dispCtx()));
    });
    return (view.filterMode ?? "and") === "and" ? res.every(Boolean) : res.some(Boolean);
  });

  const quickCreate = () => {
    const id = A.createRecord(entityId, {});
    A.openRecord(id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 pb-0 pt-3 md:px-5">
        <div className="flex items-center gap-2.5">
          <span className="text-xl leading-none">{e.icon}</span>
          <h1 className="text-[17px] font-semibold tracking-tight">{e.namePlural}</h1>
          <span className="text-[13px] text-muted-foreground tnum">{records.length} {plural(records.length, "запись", "записи", "записей")}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" /> Настроить раздел
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="gap-2" onClick={() => setImportOpen(true)}><FileUp className="size-4" /> Импорт CSV / из Excel</DropdownMenuItem>
              {e.pipeline && <DropdownMenuItem className="gap-2" onClick={() => setFormOpen(true)}><PanelTop className="size-4" /> Веб-форма → заявка</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="h-8 gap-1" onClick={quickCreate}>
            <Plus className="size-4" /> {e.name}
          </Button>
        </div>

        <div className="flex w-full items-center gap-1">
          <div className="flex items-center gap-0.5 overflow-x-auto">
            {e.views.map(v => {
              const Ic = VIEW_ICON[v.type];
              const active = v.id === view.id;
              return (
                <button key={v.id}
                  onClick={() => A.setView(entityId, v.id)}
                  className={cn("relative flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2 text-[13px] transition-colors",
                    active ? "font-medium" : "text-muted-foreground hover:text-foreground")}>
                  <Ic className="size-3.5" /> {v.name}
                  {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ background: "hsl(41 46% 45%)" }} />}
                </button>
              );
            })}
            <AddViewButton entityId={entityId} />
          </div>
          <div className="ml-auto flex items-center gap-1.5 pb-1.5">
            <div className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={ev => setQ(ev.target.value)} placeholder="Фильтр…" className="h-7.5 h-8 w-40 pl-7 text-[13px]" />
              {q && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setQ("")}><X className="size-3.5 text-muted-foreground" /></button>}
            </div>
            <FilterButton entityId={entityId} view={view} />
            <button
              onClick={() => setMineOnly(m => !m)}
              className={cn("h-8 rounded-md border px-2.5 text-[12.5px] transition-colors",
                mineOnly ? "border-transparent font-medium" : "text-muted-foreground hover:text-foreground")}
              style={mineOnly ? { background: "hsl(42 42% 55% / 0.2)", color: "var(--brass-ink)" } : undefined}
            >
              Мои
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {view.type === "table" && <TableView entity={e} view={view} records={records} />}
        {view.type === "kanban" && <KanbanView entity={e} records={records} />}
        {view.type === "calendar" && <CalendarView entity={e} view={view} records={records} />}
        {view.type === "cards" && <CardsView entity={e} records={records} />}
      </div>

      <EntitySettings entityId={entityId} open={settingsOpen} onOpenChange={setSettingsOpen} />
      {importOpen && <ImportDialog entityId={entityId} open={importOpen} onOpenChange={setImportOpen} />}
      {formOpen && <WebFormDialog entityId={entityId} open={formOpen} onOpenChange={setFormOpen} />}
    </div>
  );
}

function FilterButton({ entityId, view }: { entityId: string; view: View }) {
  const e = entityById(entityId)!;
  const rules = view.filters ?? [];
  const filterable = e.fields.filter(f => !["autonumber", "rollup"].includes(f.type));
  const upd = (next: FilterRule[]) => A.updateView(entityId, view.id, { filters: next });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn("flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors",
            rules.length ? "border-transparent font-medium" : "text-muted-foreground hover:text-foreground")}
          style={rules.length ? { background: "hsl(42 42% 55% / 0.2)", color: "var(--brass-ink)" } : undefined}
        >
          <ListFilter className="size-3.5" /> Фильтры{rules.length ? ` · ${rules.length}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-w-[92vw] p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">Показывать записи, где</div>
          {rules.length > 1 && (
            <div className="flex overflow-hidden rounded-md border text-[11.5px]">
              {(["and", "or"] as const).map(m => (
                <button key={m}
                  onClick={() => A.updateView(entityId, view.id, { filterMode: m })}
                  className={cn("px-2 py-0.5", (view.filterMode ?? "and") === m ? "bg-foreground/10 font-semibold" : "text-muted-foreground")}>
                  {m === "and" ? "И" : "ИЛИ"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {rules.map(rule => {
            const f = e.fields.find(x => x.id === rule.fieldId);
            const ops = f ? OPS_BY_TYPE(f.type) : [];
            const cur = ops.find(o => o.op === rule.op);
            return (
              <div key={rule.id} className="grid grid-cols-[1fr_100px_1fr_26px] items-center gap-1.5">
                <Select value={rule.fieldId} onValueChange={fid => {
                  const nf = e.fields.find(x => x.id === fid)!;
                  upd(rules.map(r2 => r2.id === rule.id ? { ...r2, fieldId: fid, op: OPS_BY_TYPE(nf.type)[0].op, value: undefined } : r2));
                }}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">{filterable.map(ff => <SelectItem key={ff.id} value={ff.id}>{ff.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={rule.op} onValueChange={op => upd(rules.map(r2 => r2.id === rule.id ? { ...r2, op: op as FilterRule["op"] } : r2))}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{ops.map(o => <SelectItem key={o.op} value={o.op}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                {cur?.needsValue && f ? (
                  <FilterValue f={f} value={rule.value} onChange={v => upd(rules.map(r2 => r2.id === rule.id ? { ...r2, value: v } : r2))} />
                ) : <div />}
                <button className="grid h-8 w-[26px] place-items-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                  onClick={() => upd(rules.filter(r2 => r2.id !== rule.id))}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Button variant="outline" size="sm" className="h-7.5 h-8 gap-1 text-[12.5px]"
            onClick={() => { const f = filterable[0]; if (f) upd([...rules, { id: uid("fl"), fieldId: f.id, op: OPS_BY_TYPE(f.type)[0].op }]); }}>
            <Plus className="size-3.5" /> Условие
          </Button>
          {rules.length > 0 && <button className="text-[12px] text-muted-foreground hover:text-foreground" onClick={() => upd([])}>Сбросить все</button>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterValue({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  const ws = getState().ws!;
  if (f.type === "select" || f.type === "multiselect")
    return (
      <Select value={(value as string) ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-[12.5px]"><SelectValue placeholder="значение" /></SelectTrigger>
        <SelectContent>{f.options?.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    );
  if (f.type === "user")
    return (
      <Select value={(value as string) ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-[12.5px]"><SelectValue placeholder="сотрудник" /></SelectTrigger>
        <SelectContent>{ws.users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
      </Select>
    );
  if (f.type === "relation") {
    const targets = ws.records.filter(r => r.entityId === f.relationTo);
    return (
      <Select value={(value as string) ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-[12.5px]"><SelectValue placeholder="запись" /></SelectTrigger>
        <SelectContent className="max-h-60">{targets.map(r => <SelectItem key={r.id} value={r.id}>{recTitle(r.id)}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (f.type === "date" || f.type === "datetime")
    return <Input type="date" className="h-8 text-[12.5px]"
      value={value ? new Date(Number(value)).toISOString().slice(0, 10) : ""}
      onChange={ev => onChange(ev.target.value ? new Date(ev.target.value + "T12:00").getTime() : undefined)} />;
  if (["number", "money", "rating"].includes(f.type))
    return <Input type="number" className="h-8 text-[12.5px] tnum" value={value === undefined ? "" : String(value)}
      onChange={ev => onChange(ev.target.value === "" ? undefined : Number(ev.target.value))} />;
  return <Input className="h-8 text-[12.5px]" value={String(value ?? "")} onChange={ev => onChange(ev.target.value)} placeholder="текст" />;
}

function AddViewButton({ entityId }: { entityId: string }) {
  const e = entityById(entityId)!;
  const [open, setOpen] = useState(false);
  const [dateField, setDateField] = useState<string | undefined>();
  const dateFields = e.fields.filter(f => f.type === "date" || f.type === "datetime");

  const add = (type: View["type"]) => {
    if (type === "calendar") {
      const df = dateField ?? dateFields[0]?.id;
      if (!df) return;
      A.addView(entityId, type, VIEW_NAME[type], df);
    } else A.addView(entityId, type, VIEW_NAME[type]);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 px-2 py-2 text-[13px] text-muted-foreground hover:text-foreground" title="Добавить представление">
          <Plus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Новое представление</div>
        {(["table", "kanban", "cards", "calendar"] as const).map(t => {
          const Ic = VIEW_ICON[t];
          const disabled = (t === "kanban" && !e.pipeline) || (t === "calendar" && dateFields.length === 0);
          return (
            <div key={t}>
              <button
                disabled={disabled}
                onClick={() => add(t)}
                className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm", disabled ? "cursor-not-allowed opacity-40" : "hover:bg-muted")}
              >
                <Ic className="size-4 text-muted-foreground" /> {VIEW_NAME[t]}
                {disabled && <span className="ml-auto text-[10.5px] text-muted-foreground">{t === "kanban" ? "нужна воронка" : "нужно поле-дата"}</span>}
              </button>
              {t === "calendar" && !disabled && dateFields.length > 1 && (
                <div className="mb-1 ml-8 mr-1 mt-0.5">
                  <Select value={dateField ?? dateFields[0].id} onValueChange={setDateField}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{dateFields.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

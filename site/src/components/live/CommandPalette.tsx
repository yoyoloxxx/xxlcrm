// Палитра (Ctrl+K или «/»): один поиск по ВСЕМ разделам, диалогам и задачам.
// Смысл — не прыгать между вкладками: нашёл клиента → сразу его карточка, диалог или задача.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, A, allEntities, recTitle, entityCfg, getState, relatedOf } from "@/lib/store";
import { relTime, displayValue } from "@/lib/model";
import { EntIcon } from "./icons";
import { Inbox, ListChecks, MessageSquare, Search, Settings, Sparkles, SunMedium, Zap, LayoutDashboard, Plus, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaletteItem {
  id: string; group: string; title: string; sub?: string;
  icon: React.ElementType; tone?: string; run: () => void;
}

const norm = (v: unknown) => String(v ?? "").toLowerCase();

export function CommandPalette({ open, onClose, goPage }: { open: boolean; onClose: () => void; goPage: (page: string) => void }) {
  const s = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    const st = getState();
    const needle = q.trim().toLowerCase();
    const out: PaletteItem[] = [];
    const go = (page: string) => { goPage(page); onClose(); };

    // ---- записи всех разделов
    const recScore = (r: { id: string; entityId: string; values: Record<string, unknown>; updatedAt: number }) => {
      if (!needle) return 0;
      const title = recTitle(r.id).toLowerCase();
      if (title.startsWith(needle)) return 3;
      if (title.includes(needle)) return 2;
      const e = entityCfg(r.entityId);
      return e.fields.some(f => norm(displayValue(f, r.values[f.id])).includes(needle)) ? 1 : -1;
    };
    const recs = needle
      ? st.records.map(r => ({ r, sc: recScore(r) })).filter(x => x.sc >= 0)
        .sort((a, b) => b.sc - a.sc || b.r.updatedAt - a.r.updatedAt).slice(0, 8).map(x => x.r)
      : [...st.records].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    for (const r of recs) {
      const e = entityCfg(r.entityId);
      const stg = e.stages?.find(x => x.id === r.stageId);
      out.push({
        id: "r_" + r.id, group: needle ? "Записи" : "Недавние", title: recTitle(r.id) || `${e.name} №${r.num}`,
        sub: `${e.name}${stg ? " · " + stg.label : ""} · ${relTime(r.updatedAt)}`,
        icon: () => <EntIcon name={e.icon} className="size-4" />, tone: stg?.color,
        run: () => { go("ent:" + r.entityId); A.openRecord(r.id); },
      });
    }

    // ---- диалоги
    if (needle) {
      const chats = st.chats.filter(c =>
        norm(c.name).includes(needle) || norm(c.phone).includes(needle) || c.msgs.some(m => norm(m.text).includes(needle))
      ).slice(0, 5);
      for (const c of chats) {
        const hit = c.msgs.find(m => norm(m.text).includes(needle));
        out.push({
          id: "c_" + c.id, group: "Диалоги", title: c.name,
          sub: hit ? `${hit.out ? "вы: " : ""}${hit.text.slice(0, 60)}` : `${c.msgs.length} сообщений`,
          icon: MessageSquare,
          run: () => { A.openChat(c.id); go("inbox"); },
        });
      }
      // ---- задачи
      const tasks = st.tasks.filter(t => norm(t.title).includes(needle)).slice(0, 5);
      for (const t of tasks) {
        out.push({
          id: "t_" + t.id, group: "Задачи", title: t.title,
          sub: t.recordId ? recTitle(t.recordId) : t.done ? "выполнена" : "без записи",
          icon: ListChecks,
          run: () => { if (t.recordId) { go("ent:" + (getState().records.find(r => r.id === t.recordId)?.entityId ?? "")); A.openRecord(t.recordId); } else go("tasks"); },
        });
      }
    }

    // ---- разделы и экраны
    const pages: [string, string, React.ElementType][] = [
      ["myday", "Мой день", SunMedium], ["tasks", "Задачи", ListChecks], ["inbox", "Входящие", Inbox],
      ["dashboard", "Дашборд", LayoutDashboard], ["automations", "Автоматизации", Zap], ["settings", "Настройки", Settings],
    ];
    for (const e of allEntities()) {
      if (needle && !norm(e.namePlural).includes(needle) && !norm(e.name).includes(needle)) continue;
      out.push({
        id: "e_" + e.id, group: "Разделы", title: e.namePlural, sub: `${st.records.filter(r => r.entityId === e.id).length} записей`,
        icon: () => <EntIcon name={e.icon} className="size-4" />, run: () => go("ent:" + e.id),
      });
    }
    for (const [id, label, icon] of pages) {
      if (needle && !norm(label).includes(needle)) continue;
      out.push({ id: "p_" + id, group: "Экраны", title: label, icon, run: () => go(id) });
    }

    // ---- действия
    const actions: PaletteItem[] = allEntities().map(e => ({
      id: "new_" + e.id, group: "Создать", title: `Новая запись: ${e.name}`, icon: Plus,
      run: () => { go("ent:" + e.id); A.openRecord(A.createRecord(e.id, {})); },
    }));
    for (const a of actions) if (!needle || norm(a.title).includes(needle) || "создать".includes(needle)) out.push(a);

    return out.slice(0, 24);
  }, [open, q, s]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(i => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-foreground/25 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div onMouseDown={e => e.stopPropagation()} onKeyDown={onKey}
        className="w-full max-w-[560px] overflow-hidden rounded-xl border bg-card shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)]"
        style={{ animation: "rise 0.16s var(--ease-out)" }}>
        <div className="flex items-center gap-2 border-b px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Клиент, заказ, сообщение, задача, раздел…"
            className="h-11 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/70" />
          <kbd className="font-mono2 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
              Ничего не нашлось. Ищется по названиям, полям, сообщениям и задачам.
            </div>
          )}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : "";
            lastGroup = it.group;
            const Ic = it.icon;
            return (
              <div key={it.id}>
                {head && <div className="eyebrow px-3.5 pb-1 pt-2">{head}</div>}
                <button data-idx={i} onMouseEnter={() => setSel(i)} onClick={() => it.run()}
                  className={cn("flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors", i === sel ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]")}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-md border text-muted-foreground" style={it.tone ? { borderColor: it.tone + "60", color: it.tone } : undefined}>
                    <Ic className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{it.title}</span>
                    {it.sub && <span className="block truncate text-[11px] text-muted-foreground">{it.sub}</span>}
                  </span>
                  {i === sel && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t px-3.5 py-1.5 text-[10.5px] text-muted-foreground">
          <span>↑↓ выбрать</span><span>↵ открыть</span>
          <span className="ml-auto inline-flex items-center gap-1"><Sparkles className="size-3" /> Ctrl+K из любого места</span>
        </div>
      </div>
    </div>
  );
}

// Сколько всего связано с записью — для компактной подписи в карточке
export function relatedCount(recId: string): number {
  const { records, chats } = relatedOf(recId);
  return records.length + chats.length;
}

// XXLcrm — обёртка приложения (стиль yoyoloxxx Dev).
// Правило обёртки: интерактивна ТОЛЬКО навигация (сайдбар, вкладки представлений, переключатели экранов).
// Все остальные элементы присутствуют, имеют hover/press-состояния, но осознанно бездействуют.
import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { useApp, A, recordsOf, undo, entityCfg, getState, setAuthStage } from "@/lib/store";
import { KanbanLive } from "@/components/live/KanbanLive";
import { TableLive } from "@/components/live/TableLive";
import { RecordDrawer } from "@/components/live/RecordDrawer";
import { InboxLive } from "@/components/live/InboxLive";
import { IntegrationsLive, TemplatesLive } from "@/components/live/SettingsLive";
import { initIntegrations } from "@/lib/integrations";
import { cloudBoot } from "@/lib/cloud";
import { AuthOverlay, TeamLive } from "@/components/live/AuthLive";
import { ConstructorDialog, NewEntityDialog } from "@/components/live/ConstructorLive";
import { EntIcon } from "@/components/live/icons";
import { TasksLive } from "@/components/live/TasksLive";
import { MyDayLive } from "@/components/live/MyDayLive";
import { ensureBirthdayTasks } from "@/lib/bday";
import {
  Bell, Calendar, Copy, LogIn,
  Columns3, FileUp, Inbox as InboxIcon, LayoutDashboard, ListChecks, ListFilter,
  Moon, Package, PanelLeft, Plus,
  Search, Settings, SlidersHorizontal, Sparkles, Sun, SunMedium, Table2, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Page = string; // "myday" | "tasks" | ... | "ent:<entityId>" — разделы теперь динамические

const NAV: { id: Page; label: string; icon: React.ElementType; badge?: () => number }[] = [
  { id: "myday", label: "Мой день", icon: SunMedium },
  { id: "tasks", label: "Задачи", icon: ListChecks, badge: () => getState().tasks.filter(t => !t.done).length },
  { id: "inbox", label: "Входящие", icon: InboxIcon, badge: () => getState().chats.reduce((n, c) => n + c.unread, 0) },
  { id: "dashboard", label: "Дашборд", icon: LayoutDashboard },
  { id: "automations", label: "Автоматизации", icon: Zap },
];
const TITLES: Record<string, string> = {
  myday: "Мой день", tasks: "Задачи", inbox: "Входящие",
  dashboard: "Дашборд", automations: "Автоматизации", settings: "Настройки",
};

// Бездействующая кнопка: выглядит и нажимается как настоящая, но ничего не делает (правило обёртки)
function Idle({ children, className, primary, title }: { children: React.ReactNode; className?: string; primary?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title ?? "В обёртке активна только навигация"}
      className={cn(
        "press inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors duration-150",
        primary
          ? "bg-primary font-medium text-primary-foreground hover:opacity-90"
          : "border text-muted-foreground hover:border-foreground/25 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function Avatar({ n, hue, size = 22 }: { n: string; hue: number; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full text-[10px] font-semibold"
      style={{ width: size, height: size, background: `hsl(${hue} 30% 87%)`, color: `hsl(${hue} 42% 27%)` }}>
      {n}
    </span>
  );
}

export default function App() {
  const s = useApp();
  const [page, setPage] = useState<Page>("ent:deals");
  const [newEnt, setNewEnt] = useState(false);
  const [setupEnt, setSetupEnt] = useState<string | null>(null); // конструктор открыт для раздела
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try { return (localStorage.getItem("xxl-shell-theme") as "dark") === "dark" ? "dark" : "light"; } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("xxl-shell-theme", theme); } catch { /* нет хранилища */ }
  }, [theme]);
  useEffect(() => {
    initIntegrations(); void cloudBoot(); // каналы + вход в облако, если сессия сохранена
    const t = window.setTimeout(ensureBirthdayTasks, 1500); // напоминания «поздравить» — после загрузки данных
    const iv = window.setInterval(ensureBirthdayTasks, 3600000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, []);
  const entId = page.startsWith("ent:") ? page.slice(4) : null;
  useEffect(() => {
    if (entId && !s.entities.some(e => e.id === entId)) setPage(s.entities.length ? "ent:" + s.entities[0].id : "myday");
  }, [entId, s.entities]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        const t = e.target as HTMLElement | null;
        if (t && t.closest("input,textarea,[contenteditable]")) return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="grain" />

      {/* ─── Сайдбар ─── */}
      <aside className="flex w-[232px] shrink-0 flex-col border-r" style={{ background: "hsl(var(--sidebar))" }}>
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-[18px]">
          <span className="mark-frame grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[9.5px] font-bold" style={{ color: "var(--brass-ink)" }}>XXL</span>
          <span className="text-[15px] font-semibold tracking-tight">XXLcrm</span>
          <span className="font-mono2 ml-auto text-[9.5px] text-muted-foreground/70">v0.8</span>
        </div>

        {s.mode === "cloud" ? (
          <button
            onClick={() => { navigator.clipboard?.writeText(s.inviteCode).then(() => toast("Код приглашения скопирован: " + s.inviteCode)); }}
            title="Скопировать код приглашения для сотрудника"
            className="press mx-3 mb-3 flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-[7px] text-left transition-colors duration-150 hover:border-foreground/25">
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium">{s.wsName}</span>
              <span className="font-mono2 block text-[9.5px] text-muted-foreground">в команде: {s.users.length} · код {s.inviteCode}</span>
            </span>
            <Copy className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <button
            onClick={() => setAuthStage("auth")}
            title="Войти или создать аккаунт — данные станут общими для команды"
            className="press mx-3 mb-3 flex items-center justify-between gap-2 rounded-md border border-dashed bg-card px-2.5 py-[7px] text-left transition-colors duration-150 hover:border-foreground/25">
            <span>
              <span className="block text-[12.5px] font-medium">Digital Loft</span>
              <span className="block text-[9.5px] text-muted-foreground">демо · войти в аккаунт</span>
            </span>
            <LogIn className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}

        <nav className="flex flex-col gap-px px-3">
          {NAV.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)}
              className={cn("press flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13px] transition-colors duration-150",
                page === n.id ? "bg-foreground/[0.07] font-medium" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
              <n.icon className="size-4" />
              <span className="flex-1">{n.label}</span>
              {n.badge && n.badge() > 0 && <span className="font-mono2 rounded-full px-1.5 text-[10.5px] font-medium" style={{ background: "hsl(var(--brass) / 0.22)", color: "var(--brass-ink)" }}>{n.badge()}</span>}
            </button>
          ))}
        </nav>

        <div className="mt-5 flex items-center justify-between pl-[22px] pr-3">
          <span className="eyebrow">Разделы</span>
          <button onClick={() => setNewEnt(true)} title="Новый раздел"
            className="press grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-3.5" /></button>
        </div>
        <nav className="mt-1 flex flex-col gap-px overflow-y-auto px-3">
          {s.entities.map(sec => (
            <button key={sec.id} onClick={() => setPage("ent:" + sec.id)}
              className={cn("press flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13px] transition-colors duration-150",
                page === "ent:" + sec.id ? "bg-foreground/[0.07] font-medium" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
              <EntIcon name={sec.icon} className="size-4" />
              <span className="min-w-0 flex-1 truncate">{sec.namePlural}</span>
              <span className="font-mono2 text-[10.5px] text-muted-foreground/70">{recordsOf(sec.id).length}</span>
            </button>
          ))}
          <button onClick={() => setNewEnt(true)}
            className="press mt-1 inline-flex h-8 items-center justify-start gap-2 rounded-md border border-dashed px-2.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:border-foreground/25 hover:text-foreground">
            <Plus className="size-3.5" /> Новый раздел
          </button>
        </nav>

        <div className="mt-auto border-t px-3 py-2.5">
          <button onClick={() => setPage("settings")}
            className={cn("press flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors duration-150",
              page === "settings" ? "bg-foreground/[0.07] font-medium" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
            <Settings className="size-4" /> Настройки
          </button>
        </div>
      </aside>

      {/* ─── Основная область ─── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[50px] shrink-0 items-center gap-1.5 border-b px-3.5">
          <Idle className="h-7 w-7 justify-center border-0 px-0 text-muted-foreground"><PanelLeft className="size-4" /></Idle>
          <div className="relative ml-1 w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input readOnly placeholder="Поиск по всем разделам…" title="В обёртке активна только навигация"
              className="h-8 w-full cursor-default rounded-md border-0 bg-muted/70 pl-8 pr-10 text-[12.5px] outline-none placeholder:text-muted-foreground/80" />
            <kbd className="font-mono2 absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-card px-1 text-[10px] text-muted-foreground">/</kbd>
          </div>
          <div className="flex-1" />
          <span className="pulse-dot mr-1 hidden size-1.5 rounded-full sm:block" style={{ background: "hsl(var(--brass))" }} title="Синхронизация активна (демо)" />
          <span className="font-mono2 hidden text-[10.5px] text-muted-foreground sm:block">синхронизировано</span>
          <button
            onClick={() => setTheme(t => (t === "light" ? "dark" : "light"))}
            title={theme === "light" ? "Тёмная тема" : "Светлая тема"}
            className="press grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </button>
          <Idle className="relative h-8 w-8 justify-center border-0 px-0 text-muted-foreground">
            <Bell className="size-4" />
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full" style={{ background: "hsl(var(--brass))" }} />
          </Idle>
          {s.mode === "cloud" ? (() => { const me = s.users.find(u => u.id === s.currentUserId); return (
            <button className="press h-8 px-1" title={me?.name ?? ""} onClick={() => setPage("settings")}>
              <Avatar n={(me?.name ?? "?").trim().charAt(0).toUpperCase() || "?"} hue={me?.hue ?? 42} size={26} />
            </button>
          ); })() : <Idle className="h-8 border-0 px-1"><Avatar n="Г" hue={42} size={26} /></Idle>}
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          {page === "myday" && <MyDayLive goTasks={() => setPage("tasks")} goInbox={() => setPage("inbox")} />}
          {page === "tasks" && <TasksLive goInbox={() => setPage("inbox")} />}
          {page === "inbox" && <InboxLive goSettings={() => setPage("settings")} />}
          {entId && s.entities.some(e => e.id === entId) && <EntityScreen key={entId} id={entId} openSetup={() => setSetupEnt(entId)} />}
          {page === "dashboard" && <Dashboard />}
          {page === "automations" && <Automations />}
          {page === "settings" && <SettingsScreen theme={theme} setTheme={setTheme} />}
        </main>

        <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3.5">
          <span className="font-mono2 text-[10px] text-muted-foreground">XXLcrm v0.8 · живое: всё основное — разделы и конструктор, Входящие, Задачи, Мой день, команда · заглушки: Дашборд, Автоматизации</span>
          <span className="font-mono2 ml-auto text-[10px] text-muted-foreground/70">{entId ? (s.entities.find(e => e.id === entId)?.namePlural ?? "") : TITLES[page] ?? ""}</span>
        </footer>
      </div>

      {s.drawerRecordId && <RecordDrawer recordId={s.drawerRecordId} />}
      {s.authStage && <AuthOverlay stage={s.authStage} />}
      <NewEntityDialog open={newEnt} onOpenChange={setNewEnt} onCreated={id => { setPage("ent:" + id); setSetupEnt(id); }} />
      {setupEnt && <ConstructorDialog entityId={setupEnt} open={!!setupEnt} onOpenChange={o => !o && setSetupEnt(null)} onDeleted={() => setSetupEnt(null)} />}
      <Toaster position="bottom-left" toastOptions={{ style: theme === "dark"
        ? { background: "hsl(43 22% 90%)", color: "hsl(40 12% 12%)", border: "none", fontSize: "13px", fontFamily: "inherit" }
        : { background: "hsl(40 18% 13%)", color: "hsl(45 40% 96%)", border: "none", fontSize: "13px", fontFamily: "inherit" } }} />
    </div>
  );
}

/* ───────────────────────── Экраны ───────────────────────── */

function ScreenHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[21px] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-1.5">{children}</div>}
    </div>
  );
}

type ViewId = "kanban" | "table" | "calendar";

function EntityScreen({ id, openSetup }: { id: string; openSetup: () => void }) {
  const e = entityCfg(id);
  const hasStages = !!e.stages?.length;
  const [view, setView] = useState<ViewId>(hasStages ? "kanban" : "table");
  const count = recordsOf(id).length;
  const tabs: [ViewId, string, React.ElementType][] = hasStages
    ? [["kanban", "Канбан", Columns3], ["table", "Таблица", Table2], ...(id === "deals" ? [["calendar", "Календарь", Calendar] as [ViewId, string, React.ElementType]] : [])]
    : [["table", "Таблица", Table2]];
  const activeView = tabs.some(t => t[0] === view) ? view : tabs[0][0];
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 pt-4">
        <ScreenHead title={e.namePlural} sub={`${count} записей · ${hasStages ? "воронка со стадиями" : "таблица"} · живой раздел`}>
          <button onClick={openSetup}
            className="press inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:border-foreground/25 hover:text-foreground">
            <SlidersHorizontal className="size-3" /> Настроить раздел
          </button>
          <Idle title="Импорт CSV — следующая итерация"><FileUp className="size-3" /> Импорт</Idle>
          <button onClick={() => A.openRecord(A.createRecord(id, {}))}
            className="press inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12.5px] font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90">
            <Plus className="size-3.5" /> {e.name}
          </button>
        </ScreenHead>
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            {tabs.map(([tid, label, Ic]) => (
              <button key={tid} onClick={() => setView(tid)}
                className={cn("press relative flex items-center gap-1.5 px-2.5 py-2 text-[12.5px] transition-colors duration-150", activeView === tid ? "font-medium" : "text-muted-foreground hover:text-foreground")}>
                <Ic className="size-3.5" /> {label}
                {activeView === tid && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full" style={{ background: "hsl(var(--primary))" }} />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 pb-1.5">
            <Idle title="Фильтры — следующая итерация"><ListFilter className="size-3" /> Фильтры</Idle>
            <Idle title="Фильтр по ответственному — следующая итерация">Мои</Idle>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {activeView === "kanban" && hasStages && <KanbanLive entity={e} />}
        {activeView === "table" && <TableLive entity={e} />}
        {activeView === "calendar" && <DealsCalendar />}
      </div>
    </div>
  );
}

function Dashboard() {
  const funnel = [["Новая", 100, "14"], ["Квалификация", 74, "10"], ["КП отправлено", 51, "7"], ["Переговоры", 38, "5"], ["Оплачено", 21, "3"]] as const;
  const bars = [["Рекомендации", 86, "5"], ["Сайт", 64, "4"], ["Telegram", 47, "3"], ["Конференции", 21, "1"]] as const;
  return (
    <div className="cascade mx-auto max-w-4xl px-5 py-6">
      <ScreenHead title="Дашборд" sub="живые метрики появятся после подключения данных">
        <div className="relative">
          <Sparkles className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" style={{ color: "var(--brass-ink)" }} />
          <input readOnly placeholder="Спроси CRM…" title="В обёртке активна только навигация"
            className="h-8 w-48 cursor-default rounded-md border bg-card pl-8 pr-3 text-[12px] outline-none placeholder:text-muted-foreground/70" />
        </div>
        <Idle><Plus className="size-3" /> Виджет</Idle>
      </ScreenHead>

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-y py-4 md:grid-cols-4 md:divide-x">
        {[["В работе, сумма", "3 659 000 ₽", "+12,4% к июлю"], ["План месяца", "47,2%", "1 415 000 из 3 000 000 ₽"], ["Новых за неделю", "11", "6 — из Telegram"], ["Конверсия в оплату", "21,3%", "медиана цикла — 19 дней"]].map(([l, v, s], i) => (
          <div key={l} className={cn("md:px-5", i === 0 && "md:pl-0")}>
            <div className="eyebrow">{l}</div>
            <div className="font-mono2 tnum mt-1.5 text-[22px] font-medium leading-none tracking-tight">{v}</div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">{s}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <div className="eyebrow">Воронка продаж</div>
          <div className="mt-3 flex flex-col gap-1.5">
            {funnel.map(([l, w, n]) => (
              <div key={l} className="flex items-center gap-2.5">
                <span className="w-28 truncate text-[11.5px] text-muted-foreground">{l}</span>
                <div className="h-[16px] flex-1 overflow-hidden rounded-[3px] bg-muted/70">
                  <div className="flex h-full items-center rounded-[3px] pl-1.5" style={{ width: w + "%", background: `hsl(var(--brass) / ${0.35 + w / 180})` }}>
                    <span className="font-mono2 text-[9.5px] font-medium text-foreground/80">{n}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="eyebrow">Сделки по источникам</div>
          <div className="mt-3 flex flex-col gap-1.5">
            {bars.map(([l, w, n], i) => (
              <div key={l} className="flex items-center gap-2.5">
                <span className="w-28 truncate text-[11.5px] text-muted-foreground">{l}</span>
                <div className="h-[16px] flex-1 overflow-hidden rounded-[3px] bg-muted/70">
                  <div className="h-full rounded-[3px]" style={{ width: w + "%", background: i === 0 ? "hsl(var(--primary) / 0.75)" : "hsl(42 22% 72%)" }} />
                </div>
                <span className="font-mono2 w-5 text-right text-[11px]">{n}</span>
              </div>
            ))}
          </div>
          <div className="eyebrow mt-6">Последние события</div>
          <div className="mt-2.5 flex flex-col gap-2">
            {[["12:47", "Ответ клиенту в Telegram — Максим Веретенников"], ["11:20", "Стадия «Переговоры» — Портал для «СтройТех»"], ["09:05", "Автоматизация: задача «Связаться за час»"]].map(([t, e]) => (
              <div key={e} className="flex items-baseline gap-2.5 text-[12px]">
                <span className="font-mono2 shrink-0 text-[10.5px] text-muted-foreground">{t}</span>
                <span className="truncate">{e}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Automations() {
  const rules = [
    { on: true, n: "Новая сделка → связаться за час", d: "Создана запись в «Сделки» → задача «Связаться с клиентом», звонок", fired: "38" },
    { on: true, n: "«Переговоры» 3 дня без движения", d: "Запись застряла на стадии → задача ответственному + уведомление РОПу", fired: "12" },
    { on: false, n: "Оплата получена → поздравить команду", d: "Стадия «Оплачено» → уведомление в ленту", fired: "7" },
    { on: true, n: "Заявка с Tilda → в воронку", d: "Вебхук формы → запись в «Сделки», источник «Сайт»", fired: "26" },
  ];
  return (
    <div className="cascade mx-auto max-w-3xl px-5 py-6">
      <ScreenHead title="Автоматизации" sub="правила «когда → тогда»: система делает рутину сама">
        <Idle primary><Plus className="size-3.5" /> Правило</Idle>
      </ScreenHead>
      <div className="mt-5 divide-y rounded-lg border bg-card">
        {rules.map((r, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: r.on ? "hsl(var(--brass) / 0.18)" : "hsl(var(--muted))" }}>
              <Zap className="size-3.5" style={{ color: r.on ? "var(--brass-ink)" : "hsl(var(--muted-foreground))" }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold leading-snug">{r.n}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{r.d}</div>
              <div className="font-mono2 mt-1 text-[10.5px] text-muted-foreground">сработала {r.fired} раз</div>
            </div>
            <Idle className={cn("h-[22px] w-10 rounded-full border-0 p-0.5", r.on ? "justify-end" : "justify-start")} title="В обёртке переключатели неактивны">
              <span className="block h-[17px] w-[17px] rounded-full bg-card shadow-sm" style={{ outline: "1px solid hsl(var(--border))" }} />
            </Idle>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-muted-foreground">Триггеры: создание записи, смена стадии, застревание, входящее сообщение, вебхук. Действия: задача, уведомление, смена поля, сообщение клиенту, AI.</p>
    </div>
  );
}

function SettingsScreen({ theme, setTheme }: { theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void }) {
  return (
    <div className="cascade mx-auto max-w-2xl px-5 py-6">
      <ScreenHead title="Настройки" />
      <div className="mt-5 divide-y rounded-lg border bg-card">
        <div className="px-4 py-3.5">
          <div className="text-[13px] font-semibold">Пространство</div>
          <label className="eyebrow mt-3 block">Название компании</label>
          <input readOnly value="Digital Loft" title="В обёртке активна только навигация" className="mt-1 h-9 w-full max-w-xs cursor-default rounded-md border bg-background px-2.5 text-[13px] outline-none" />
          <label className="eyebrow mt-3.5 block">Тема</label>
          <div className="mt-1.5 flex gap-1.5">
            {([["light", "Светлая", SunMedium], ["dark", "Тёмная", Moon]] as const).map(([id, label, Ic]) => (
              <button key={id} type="button" onClick={() => setTheme(id)}
                className={cn("press inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors duration-150",
                  theme === id
                    ? "border border-transparent bg-[hsl(42_42%_55%/0.2)] font-medium text-[color:var(--brass-ink)]"
                    : "border text-muted-foreground hover:border-foreground/25 hover:text-foreground")}>
                <Ic className="size-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>
        <IntegrationsLive />
        <div className="px-4 py-3.5">
          <div className="text-[13px] font-semibold">Скоро</div>
          <div className="mt-2.5 flex flex-col gap-2">
            <div className="flex items-center gap-3 rounded-md border border-dashed px-3 py-2.5">
              <InstaIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium">Instagram · через провайдера</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">без VPN нужен провайдер (Wazzup/Umnico) и серверная часть — подключу на шаге Supabase</span>
              </div>
              <Idle title="Появится после серверной части (шаг Supabase)">Скоро</Idle>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-dashed px-3 py-2.5">
              <Package className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium">СДЭК: трек-номера в сделки</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">API СДЭК закрыт для браузера — нужен серверный мост, добавлю на шаге Supabase</span>
              </div>
              <Idle title="Появится после серверной части (шаг Supabase)">Скоро</Idle>
            </div>
          </div>
        </div>
        <TemplatesLive />
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles className="size-3.5" style={{ color: "var(--brass-ink)" }} /> AI-ассистент</div>
          <p className="mt-1 text-[12px] text-muted-foreground">Резюме записей, черновики ответов, «спроси CRM». Ключ хранится локально.</p>
          <div className="mt-2 flex gap-2">
            <input readOnly placeholder="API-ключ (OpenRouter и совместимые)" title="В обёртке активна только навигация" className="h-9 flex-1 cursor-default rounded-md border bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground/70" />
            <Idle primary className="h-9">Сохранить</Idle>
          </div>
        </div>
        <TeamLive />
      </div>
    </div>
  );
}

function DealsCalendar() {
  const events: Record<number, { t: string; tone: number }[]> = {
    17: [{ t: "11:30 Звонок: смета", tone: 4 }],
    18: [{ t: "15:00 Zoom: договор", tone: 1 }],
    19: [{ t: "ДР: Ксения Макарова", tone: 1 }, { t: "Дедлайн: лендинг", tone: 3 }],
    21: [{ t: "Показ макетов", tone: 2 }],
    24: [{ t: "ДР: Виктор Гусев", tone: 1 }],
    26: [{ t: "Оплата по графику", tone: 5 }],
  };
  const tones = ["#8A8578", "#BC9F5C", "#7D8A5C", "#B0725A", "#6E8B8A", "#6E8B4F"];
  return (
    <div className="cascade flex-1 overflow-y-auto p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13.5px] font-semibold capitalize">август 2026</span>
        <div className="ml-auto flex gap-1.5">
          <Idle>‹</Idle><Idle>Сегодня</Idle><Idle>›</Idle>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(w => (
          <div key={w} className="bg-background px-2 py-1.5 text-center text-[10.5px] font-medium text-muted-foreground">{w}</div>
        ))}
        {Array.from({ length: 35 }, (_, i) => {
          const day = i - 4; // 1 августа 2026 — суббота
          const inMonth = day >= 1 && day <= 31;
          const isToday = day === 16;
          return (
            <div key={i} className={cn("min-h-[84px] bg-card p-1.5", !inMonth && "bg-muted/40")}>
              {inMonth && (
                <>
                  <span className={cn("font-mono2 grid h-5 min-w-5 w-fit place-items-center rounded-full px-1 text-[10.5px]", isToday ? "font-bold text-primary-foreground" : "text-foreground/70")}
                    style={isToday ? { background: "hsl(var(--primary))" } : undefined}>{day}</span>
                  <div className="mt-1 flex flex-col gap-1">
                    {(events[day] ?? []).map((e, j) => (
                      <span key={j} className="truncate rounded border px-1.5 py-0.5 text-[10px] leading-snug"
                        style={{ background: tones[e.tone] + "1c", borderColor: tones[e.tone] + "55" }}>{e.t}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Instagram-иконка: в этой версии lucide бренд-иконок нет — аккуратный примитив
function InstaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={cn("lucide", className)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

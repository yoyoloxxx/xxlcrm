// XXLcrm — приложение целиком (стиль yoyoloxxx Dev).
// Правило: в интерфейсе не должно быть кнопок-обманок. Всё, что выглядит рабочим, работает;
// то, чего ещё нет, лежит в блоке «Скоро» с честной подписью и компонентом Idle.
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { useApp, A, recordsOf, undo, entityCfg, getState, setAuthStage, setWsMeta, recTitle, recById, allEntities, dispCtx, collapseFieldRuns, storageState, tabState, tabTakeOver } from "@/lib/store";
import { KanbanLive } from "@/components/live/KanbanLive";
import { TableLive } from "@/components/live/TableLive";
import { RecordDrawer } from "@/components/live/RecordDrawer";
import { InboxLive } from "@/components/live/InboxLive";
import { IntegrationsLive, TemplatesLive } from "@/components/live/SettingsLive";
import { RoutingLive } from "@/components/live/RoutingLive";
import { CommandPalette } from "@/components/live/CommandPalette";
import { CalendarLive } from "@/components/live/CalendarLive";
import { ImportDialog } from "@/components/live/ImportDialog";
import { getViewState, setViewState } from "@/lib/viewstate";
import type { SavedSeg } from "@/lib/viewstate";
import type { Cond } from "@/lib/filters";
import { matchAll } from "@/lib/filters";
import { FilterBar } from "@/components/live/FilterBar";
import { toCSV, downloadCSV } from "@/lib/export";
import { initIntegrations } from "@/lib/integrations";
import { cloudBoot, renameWs } from "@/lib/cloud";
import { AuthOverlay, TeamLive } from "@/components/live/AuthLive";
import { ConstructorDialog, NewEntityDialog } from "@/components/live/ConstructorLive";
import { PresetPicker } from "@/components/live/PresetPicker";
import { cloudState } from "@/lib/cloud";
import { setupMarks, markSetup } from "@/lib/setup";
import { EntIcon } from "@/components/live/icons";
import { TasksLive } from "@/components/live/TasksLive";
import { MyDayLive } from "@/components/live/MyDayLive";
import { ensureBirthdayTasks } from "@/lib/bday";
import { initAutomations } from "@/lib/automations";
import { AutomationsLive } from "@/components/live/AutomationsLive";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Rec, EntityCfg } from "@/lib/model";
import { DAY, now, fmtMoney, relTime, plural, displayValue } from "@/lib/model";
import {
  Calendar, Copy, LogIn,
  Columns3, FileUp, Inbox as InboxIcon, LayoutDashboard, ListChecks,
  Moon, Package, PanelLeft, Plus,
  Route as RouteIcon, Search, Settings, SlidersHorizontal, Sparkles, Sun, SunMedium, Table2, X, Zap, Download,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Page = string; // "myday" | "tasks" | ... | "ent:<entityId>" — разделы теперь динамические

const NAV: { id: Page; label: string; icon: React.ElementType; badge?: () => number }[] = [
  { id: "myday", label: "Мой день", icon: SunMedium },
  { id: "tasks", label: "Задачи", icon: ListChecks, badge: () => getState().tasks.filter(t => !t.done).length },
  { id: "inbox", label: "Входящие", icon: InboxIcon, badge: () => getState().chats.reduce((n, c) => n + c.unread, 0) },
  { id: "routing", label: "Приём заявок", icon: RouteIcon },
  { id: "automations", label: "Автоматизации", icon: Zap },
];
const TITLES: Record<string, string> = {
  myday: "Мой день", tasks: "Задачи", inbox: "Входящие",
  routing: "Приём заявок", automations: "Автоматизации", settings: "Настройки",
};

// Кнопка «Скоро»: только для блока честных заглушек — в рабочих местах интерфейса её быть не должно
function Idle({ children, className, primary, title }: { children: React.ReactNode; className?: string; primary?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title ?? "Появится после серверной части"}
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
  const [page, setPage] = useState<Page>("myday"); // утро начинается с «что у меня сегодня», а не с воронки
  const [newEnt, setNewEnt] = useState(false);
  const [palette, setPalette] = useState(false); // Ctrl+K — общий поиск по всему пространству
  const [sidebar, setSidebar] = useState(() => {   // на телефоне панель закрыта, на десктопе — как оставили
    try {
      const saved = localStorage.getItem("xxl-sidebar");
      if (saved !== null) return saved === "1";
      return window.matchMedia("(min-width: 768px)").matches;
    } catch { return true; }
  });
  const isPhone = () => { try { return window.matchMedia("(max-width: 767px)").matches; } catch { return false; } };
  useEffect(() => { try { localStorage.setItem("xxl-sidebar", sidebar ? "1" : "0"); } catch { /* нет хранилища */ } }, [sidebar]);
  // переход по навигации на телефоне закрывает панель — иначе она закрывает собой весь экран
  const go = (pg: Page) => { setPage(pg); if (isPhone()) setSidebar(false); };
  const [presets, setPresets] = useState(false); // выбор пресета ниши
  const [presetsOnboarding, setPresetsOnboarding] = useState(false); // пикер открылся сам на пустом пространстве
  const openPresets = () => { setPresetsOnboarding(false); setPresets(true); };
  const [setupEnt, setSetupEnt] = useState<string | null>(null); // конструктор открыт для раздела
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try { return (localStorage.getItem("xxl-shell-theme") as "dark") === "dark" ? "dark" : "light"; } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("xxl-shell-theme", theme); } catch { /* нет хранилища */ }
  }, [theme]);
  // Первый запуск: сам предлагаю шаблон ниши — иначе человек сидит в чужих демо-сделках
  // и не догадывается, что раздел настраивается. Спрашиваю ОДИН раз и больше не лезу.
  useEffect(() => {
    if (s.mode === "cloud") return;
    const m = setupMarks();
    if (m.greeted || m.structure || m.imported) return;
    const t = window.setTimeout(() => { markSetup("greeted"); setPresetsOnboarding(true); setPresets(true); }, 800);
    return () => window.clearTimeout(t);
  }, [s.mode]);
  useEffect(() => {
    initIntegrations(); void cloudBoot(); initAutomations(); // каналы + облако + правила «когда → тогда»
    const t = window.setTimeout(ensureBirthdayTasks, 1500); // напоминания «поздравить» — после загрузки данных
    const iv = window.setInterval(ensureBirthdayTasks, 3600000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, []);
  // Онбординг: на пустом пространстве сам предлагаем выбрать нишу (один раз, после загрузки данных)
  const onboardShown = useRef(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!onboardShown.current && getState().records.length === 0 && getState().authStage === null) {
        onboardShown.current = true;
        setPresetsOnboarding(true);
        setPresets(true);
      }
    }, 2200);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (s.nav) setPage(s.nav.page); }, [s.nav?.tick]); // «открыть диалог» из карточки
  const entId = page.startsWith("ent:") ? page.slice(4) : null;
  useEffect(() => {
    if (entId && !s.entities.some(e => e.id === entId)) setPage(s.entities.length ? "ent:" + s.entities[0].id : "myday");
  }, [entId, s.entities]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const inField = () => { const t = e.target as HTMLElement | null; return !!t?.closest("input,textarea,[contenteditable]"); };
      // Пока открыт модальный диалог, палитру не зовём: она всплывала ПОВЕРХ него, но фокус
      // оставался в диалоге — ни набрать, ни закрыть. И действия из неё меняли данные вслепую.
      const modalOpen = () => !!document.querySelector('[role="dialog"][data-state="open"]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (modalOpen()) return;
        e.preventDefault(); setPalette(v => !v); return;
      }
      if (e.key === "/" && !inField()) { if (modalOpen()) return; e.preventDefault(); setPalette(true); return; }
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
      {/* Телефон: панель выезжает поверх содержимого, фон затемняется и закрывает её по тапу */}
      {sidebar && (
        <button aria-label="Закрыть панель" onClick={() => setSidebar(false)}
          className="fixed inset-0 z-40 bg-foreground/25 md:hidden" />
      )}
      <aside className={cn(
        "flex flex-col overflow-hidden border-r transition-all duration-200 md:shrink-0",
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[264px] max-md:shadow-[10px_0_40px_-16px_rgba(0,0,0,.5)]",
        sidebar ? "md:w-[232px] max-md:translate-x-0" : "md:w-0 md:border-r-0 max-md:-translate-x-full",
      )} style={{ background: "hsl(var(--sidebar))" }}>
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-[18px]">
          <span className="mark-frame grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[9.5px] font-bold" style={{ color: "var(--brass-ink)" }}>XXL</span>
          <span className="text-[15px] font-semibold tracking-tight">XXLcrm</span>
          <span className="font-mono2 ml-auto text-[9.5px] text-muted-foreground/70">v0.25</span>
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
              <span className="block truncate text-[12.5px] font-medium">{s.wsName}</span>
              <span className="block text-[9.5px] text-muted-foreground">только это устройство · войти</span>
            </span>
            <LogIn className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}

        <nav className="flex flex-col gap-px px-3">
          {NAV.map(n => (
            <button key={n.id} onClick={() => go(n.id)}
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
            <button key={sec.id} onClick={() => go("ent:" + sec.id)}
              className={cn("press flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13px] transition-colors duration-150",
                page === "ent:" + sec.id ? "bg-foreground/[0.07] font-medium" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
              <EntIcon name={sec.icon} className="size-4" />
              <span className="min-w-0 flex-1 truncate">{sec.namePlural}</span>
              <span className="font-mono2 text-[10.5px] text-muted-foreground">{recordsOf(sec.id).length}</span>
            </button>
          ))}
          <button onClick={() => setNewEnt(true)}
            className="press mt-1 inline-flex h-8 items-center justify-start gap-2 rounded-md border border-dashed px-2.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:border-foreground/25 hover:text-foreground">
            <Plus className="size-3.5" /> Новый раздел
          </button>
          <button onClick={openPresets} title="Готовая настройка под нишу — в один клик"
            className="press inline-flex h-8 items-center justify-start gap-2 rounded-md px-2.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.04] hover:text-foreground">
            <Sparkles className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Шаблон ниши
          </button>
        </nav>

        <div className="mt-auto border-t px-3 py-2.5">
          <button onClick={() => go("settings")}
            className={cn("press flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors duration-150",
              page === "settings" ? "bg-foreground/[0.07] font-medium" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
            <Settings className="size-4" /> Настройки
          </button>
        </div>
      </aside>

      {/* ─── Основная область ─── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[50px] shrink-0 items-center gap-1.5 border-b px-3.5">
          <button onClick={() => setSidebar(v => !v)} title={sidebar ? "Свернуть панель" : "Показать панель"}
            className="press grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <PanelLeft className="size-4" />
          </button>
          <button onClick={() => setPalette(true)} title="Поиск по всему: записи, диалоги, задачи (Ctrl+K)"
            className="press relative ml-1 flex h-8 w-full max-w-sm items-center overflow-hidden whitespace-nowrap rounded-md bg-muted/70 pl-8 pr-14 text-left text-[12.5px] text-muted-foreground/90 transition-colors hover:bg-muted">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <span className="truncate">Поиск: записи, диалоги, задачи…</span>
            <kbd className="font-mono2 absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-card px-1 text-[10px] text-muted-foreground sm:block">Ctrl K</kbd>
          </button>
          <div className="flex-1" />
          <button onClick={() => setPage("settings")} className="press mr-1 hidden items-center gap-1.5 rounded-md px-1.5 py-1 sm:flex"
            title={s.mode === "cloud" ? `Общее пространство «${s.wsName}»: данные видит вся команда и они одинаковы на всех устройствах` : "Данные лежат только в этом браузере. Включите общее пространство — и они будут на всех устройствах и у команды"}>
            <span className={cn("size-1.5 rounded-full", s.mode === "cloud" && "pulse-dot")} style={{ background: s.mode === "cloud" ? "hsl(var(--brass))" : "hsl(var(--muted-foreground))" }} />
            <span className={cn("font-mono2 text-[10.5px]", s.mode === "cloud" && cloudState().broken ? "font-medium text-destructive" : "text-muted-foreground")}>
              {s.mode === "cloud" ? (cloudState().broken ? "облако · НЕ сохраняется" : "облако · синхронно") : "только это устройство"}
            </span>
          </button>
          <button
            onClick={() => setTheme(t => (t === "light" ? "dark" : "light"))}
            title={theme === "light" ? "Тёмная тема" : "Светлая тема"}
            className="press grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </button>
          {s.mode === "cloud" ? (() => { const me = s.users.find(u => u.id === s.currentUserId); return (
            <button className="press h-8 px-1" title={me?.name ?? ""} onClick={() => setPage("settings")}>
              <Avatar n={(me?.name ?? "?").trim().charAt(0).toUpperCase() || "?"} hue={me?.hue ?? 42} size={26} />
            </button>
          ); })() : <Idle className="h-8 border-0 px-1"><Avatar n="Г" hue={42} size={26} /></Idle>}
        </header>

        <StorageAlarm />
        <main className="min-h-0 flex-1 overflow-y-auto max-md:pb-[56px]">
          {page === "myday" && <MyDayLive goTasks={() => setPage("tasks")} goInbox={() => setPage("inbox")}
            goSettings={() => setPage("settings")} onPresets={openPresets} goEntity={() => setPage("ent:" + (s.entities[0]?.id ?? "deals"))} />}
          {page === "tasks" && <TasksLive goInbox={() => setPage("inbox")} />}
          {page === "inbox" && <InboxLive goSettings={() => setPage("settings")} />}
          {entId && s.entities.some(e => e.id === entId) && <EntityScreen key={entId} id={entId} openSetup={() => setSetupEnt(entId)} />}
          {page === "routing" && (
            <div className="cascade mx-auto max-w-2xl px-3 py-6 md:px-5">
              <ScreenHead title="Приём заявок" sub="Что система делает сама с каждым входящим сообщением и заявкой с сайта" />
              <div className="mt-5 rounded-lg border bg-card"><RoutingLive goSettings={() => setPage("settings")} /></div>
            </div>
          )}
          {page === "automations" && <AutomationsLive />}
          {page === "settings" && <SettingsScreen theme={theme} setTheme={setTheme} />}
        </main>

        {/* Телефон: постоянная нижняя навигация — иначе, свернув панель, человек теряет способ переходить */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[56px] border-t bg-card md:hidden">
          {([
            ["myday", "Сегодня", SunMedium],
            ["inbox", "Входящие", InboxIcon],
            ["tasks", "Задачи", ListChecks],
            [entId ? "ent:" + entId : (s.entities[0] ? "ent:" + s.entities[0].id : "myday"), "Разделы", Package],
          ] as [string, string, React.ElementType][]).map(([id, label, Ic]) => (
            <button key={label} onClick={() => { if (label === "Разделы" && !isPhone()) return; if (label === "Разделы") { setPage(id); setSidebar(true); } else go(id); }}
              className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px]",
                page === id ? "font-medium" : "text-muted-foreground")}
              style={page === id ? { color: "var(--brass-ink)" } : undefined}>
              <Ic className="size-[18px]" /> {label}
            </button>
          ))}
        </nav>

        <footer className="hidden h-7 shrink-0 items-center gap-3 border-t px-3.5 sm:flex">
          <span className="font-mono2 text-[10px] text-muted-foreground">XXLcrm v0.25 · встречные связи не роняют CRM, отмена есть и без клавиатуры, чужой не подпишется на заявки</span>
          <span className="font-mono2 ml-auto text-[10px] text-muted-foreground/70">{entId ? (s.entities.find(e => e.id === entId)?.namePlural ?? "") : TITLES[page] ?? ""}</span>
        </footer>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} goPage={setPage} />
      {s.drawerRecordId && <RecordDrawer recordId={s.drawerRecordId} />}
      {s.authStage && <AuthOverlay stage={s.authStage} />}
      <NewEntityDialog open={newEnt} onOpenChange={setNewEnt} onCreated={id => { setPage("ent:" + id); setSetupEnt(id); }} />
      <PresetPicker open={presets} onOpenChange={o => { setPresets(o); if (!o) setPresetsOnboarding(false); }} hasData={s.records.length > 0} onboarding={presetsOnboarding} onApplied={() => setPage("ent:deals")} />
      {setupEnt && <ConstructorDialog entityId={setupEnt} open={!!setupEnt} onOpenChange={o => !o && setSetupEnt(null)} onDeleted={() => setSetupEnt(null)} />}
      {/* Описание в тосте раньше рисовалось приглушённым и давало контраст 1.49:1 —
          то есть предупреждение «данные живут только до закрытия вкладки» было почти не видно. */}
      <Toaster position="bottom-right" toastOptions={{
        style: theme === "dark"
          ? { background: "hsl(43 22% 90%)", color: "hsl(40 12% 12%)", border: "none", fontSize: "13px", fontFamily: "inherit" }
          : { background: "hsl(40 18% 13%)", color: "hsl(45 40% 96%)", border: "none", fontSize: "13px", fontFamily: "inherit" },
        classNames: { description: theme === "dark" ? "!text-[hsl(40_12%_25%)]" : "!text-[hsl(45_30%_88%)]" },
      }} />
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
      {children && <div className="flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
}

type ViewId = "kanban" | "table" | "calendar" | "stats";

function EntityScreen({ id, openSetup }: { id: string; openSetup: () => void }) {
  const e = entityCfg(id);
  const hasStages = !!e.stages?.length;
  // состояние вкладки и фильтров запоминается по разделу: переключение представлений и переходы ничего не сбрасывают
  const saved = getViewState(id);
  const [view, setView] = useState<ViewId>((saved.view as ViewId) || (hasStages ? "kanban" : "table"));
  const [q, setQ] = useState(saved.q);
  const [mine, setMine] = useState(saved.mine);
  const [seg, setSeg] = useState(saved.seg);
  const [conds, setConds] = useState<Cond[]>(saved.conds);      // фильтр по любым полям
  const [segs, setSegs] = useState<SavedSeg[]>(saved.saved);    // сохранённые наборы условий
  const [importOpen, setImportOpen] = useState(false);
  const count = recordsOf(id).length;
  const lastAct = (rid: string) => {
    let last = recById(rid)?.updatedAt ?? 0;
    for (const a of getState().activities) if (a.recordId === rid && a.ts > last) last = a.ts;
    return last;
  };
  const filterOn = !!q.trim() || mine || seg !== "all" || conds.length > 0;
  const pred = (r: Rec): boolean => {
    if (mine && r.ownerId !== getState().currentUserId) return false;
    if (conds.length && !matchAll(r, e, conds, dispCtx())) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      if (!recTitle(r.id).toLowerCase().includes(needle) && !JSON.stringify(r.values).toLowerCase().includes(needle)) return false;
    }
    const stg = e.stages?.find(x => x.id === r.stageId);
    if (seg === "active") return !!stg && stg.kind === "open";
    if (seg === "won") return !!stg && stg.kind === "won";
    if (seg === "quiet") return Date.now() - lastAct(r.id) > 60 * DAY;
    if (seg === "notask") return (!stg || stg.kind === "open") && !getState().tasks.some(t => t.recordId === r.id && !t.done);
    return true;
  };
  const shown = filterOn ? recordsOf(id).filter(pred).length : count;
  const tabs: [ViewId, string, React.ElementType][] = hasStages
    ? [["kanban", "Канбан", Columns3], ["table", "Таблица", Table2], ["calendar", "Календарь", Calendar], ["stats", "Сводка", LayoutDashboard]]
    : [["table", "Таблица", Table2], ["calendar", "Календарь", Calendar], ["stats", "Сводка", LayoutDashboard]];
  const activeView = tabs.some(t => t[0] === view) ? view : tabs[0][0];
  useEffect(() => { setViewState(id, { view: activeView, q, mine, seg, conds, saved: segs }); }, [id, activeView, q, mine, seg, conds, segs]);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 pt-4 md:px-5">
        <ScreenHead title={e.namePlural} sub={`${filterOn ? `показано ${shown} из ${count}` : `${count} ${plural(count, "запись", "записи", "записей")}`} · ${hasStages ? "воронка со стадиями" : "таблица"} · живой раздел`}>
          <button onClick={openSetup}
            className="press inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:border-foreground/25 hover:text-foreground">
            <SlidersHorizontal className="size-3" /> Настроить раздел
          </button>
          <button onClick={() => {
              const rows = filterOn ? recordsOf(id).filter(pred) : recordsOf(id);
              if (!rows.length) { toast.error("Выгружать нечего", { description: "Под текущим фильтром нет записей — сбросьте фильтр" }); return; }
              downloadCSV(e.namePlural, toCSV(e, rows, dispCtx()));
              toast.success(`Выгружено: ${rows.length} ${plural(rows.length, "запись", "записи", "записей")}`);
            }}
            title="Выгрузить в CSV то, что сейчас на экране — открывается в Excel"
            className="press inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:border-foreground/25 hover:text-foreground">
            <Download className="size-3" /> Выгрузить
          </button>
          <button onClick={() => setImportOpen(true)} title="Загрузить клиентов и заказы из Excel или другой CRM"
            className="press inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:border-foreground/25 hover:text-foreground">
            <FileUp className="size-3" /> Загрузить
          </button>
          <button onClick={() => A.openRecord(A.createRecord(id, {}))}
            className="press inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12.5px] font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90">
            <Plus className="size-3.5" /> {e.name}
          </button>
        </ScreenHead>
        <div className="mt-1 flex items-center justify-between gap-2 max-md:flex-col max-md:items-stretch">
          <div className="flex items-center gap-0.5 overflow-x-auto">
            {tabs.map(([tid, label, Ic]) => (
              <button key={tid} onClick={() => setView(tid)}
                className={cn("press relative flex items-center gap-1.5 px-2.5 py-2 text-[12.5px] transition-colors duration-150", activeView === tid ? "font-medium" : "text-muted-foreground hover:text-foreground")}>
                <Ic className="size-3.5" /> {label}
                {activeView === tid && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full" style={{ background: "hsl(var(--primary))" }} />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={ev => setQ(ev.target.value)} placeholder="Поиск в разделе…"
                onKeyDown={ev => { if (ev.key === "Escape") { setQ(""); (ev.target as HTMLInputElement).blur(); } }}
                className="h-7 w-40 rounded-md border bg-card pl-7 pr-6 text-[12px] outline-none transition-colors focus:border-ring" />
              {!!q && (
                <button onClick={() => setQ("")} title="Очистить поиск" aria-label="Очистить поиск"
                  className="press absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              )}
            </div>
            <FilterBar entity={e} conds={conds} onChange={setConds}
              onSave={(name, c) => { setSegs(prev => [...prev, { id: "sv" + Date.now().toString(36), name, conds: c }]); toast.success(`Сегмент «${name}» сохранён`); }} />
            <Select value={seg} onValueChange={v => {
              if (v.startsWith("sv:")) { const sv = segs.find(x => x.id === v.slice(3)); if (sv) { setConds(sv.conds); setSeg("all"); } return; }
              setSeg(v);
            }}>
              <SelectTrigger className={cn("h-7 w-[132px] text-[12px]", seg !== "all" && "border-transparent font-medium")}
                style={seg !== "all" ? { background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" } : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {hasStages && <SelectItem value="active">Активные</SelectItem>}
                {hasStages && <SelectItem value="won">Успешные</SelectItem>}
                <SelectItem value="quiet">Спящие 60+ дн.</SelectItem>
                <SelectItem value="notask">Без задачи</SelectItem>
                {segs.map(sv => <SelectItem key={sv.id} value={"sv:" + sv.id}>★ {sv.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {filterOn && (
              <button onClick={() => { setQ(""); setMine(false); setSeg("all"); setConds([]); }} title="Сбросить поиск, сегмент и фильтры"
                className="press inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
                <X className="size-3" /> Сбросить
              </button>
            )}
            <button onClick={() => setMine(m => !m)} title="Только мои записи"
              className={cn("press inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] transition-colors duration-150",
                mine ? "border-transparent font-medium" : "text-muted-foreground hover:border-foreground/25 hover:text-foreground")}
              style={mine ? { background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" } : undefined}>
              Мои
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {activeView === "kanban" && hasStages && (
          <>
            <KanbanLive entity={e} filter={filterOn ? pred : undefined} />
            <p className="px-4 pb-3 text-[11px] text-muted-foreground">
              Карточку можно тащить мышью или перенести с клавиатуры: Tab до карточки, Ctrl+← / Ctrl+→.
              Выделить несколько записей и сменить им стадию, ответственного или поставить задачу — во вкладке «Таблица».
            </p>
          </>
        )}
        {activeView === "table" && <TableLive entity={e} filter={filterOn ? pred : undefined} />}
        {activeView === "calendar" && <CalendarLive entity={e} filter={filterOn ? pred : undefined} />}
        {activeView === "stats" && <Dashboard entity={e} />}
      </div>
      <ImportDialog entity={e} open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function Dashboard({ entity, onPresets }: { entity?: EntityCfg; onPresets?: () => void }) {
  useApp(); // живая подписка на стор
  const s = getState();
  const pipelines = allEntities().filter(e => (e.stages?.length ?? 0) > 0);
  const primary = entity ?? pipelines[0];   // сводка по разделу, в котором стоишь
  const recs = primary ? s.records.filter(r => r.entityId === primary.id) : [];

  // Нет воронки или совсем нет записей — честное пустое состояние вместо выдуманных цифр.
  if (!primary || recs.length === 0) {
    return (
      <div className="cascade mx-auto max-w-4xl px-5 py-6">
        <ScreenHead title="Дашборд" sub="Сводка соберётся сама, как только появятся записи" />
        <div className="mt-8 grid place-items-center rounded-lg border border-dashed px-6 py-16 text-center">
          <LayoutDashboard className="size-7 text-muted-foreground/50" />
          <div className="mt-3 text-[14px] font-medium">
            {primary ? `Пока нет записей в разделе «${primary.namePlural}»` : "Пока нет ни одной воронки"}
          </div>
          <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">
            {primary
              ? "Дашборд посчитает воронку, суммы и источники автоматически — по вашим настоящим данным, без выдуманных цифр."
              : "Создайте раздел с этапами (воронку) — и здесь появится живая сводка."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {onPresets && (
              <button
                onClick={onPresets}
                className="press inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                <Sparkles className="size-3.5" /> Выбрать шаблон ниши
              </button>
            )}
            {primary && (
              <button
                onClick={() => { const id = A.createRecord(primary.id, {}); A.openRecord(id); }}
                className="press inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
                <Plus className="size-3.5" /> {primary.name} вручную
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const stages = primary.stages!;
  const kindOf = (id?: string) => stages.find(x => x.id === id)?.kind;
  const openRecs = recs.filter(r => kindOf(r.stageId) === "open");
  const wonRecs = recs.filter(r => kindOf(r.stageId) === "won");
  const lostRecs = recs.filter(r => kindOf(r.stageId) === "lost");
  const moneyF = primary.fields.find(f => f.type === "money");
  const sumOf = (arr: Rec[]) => moneyF ? arr.reduce((n, r) => n + (Number(r.values[moneyF.id]) || 0), 0) : 0;
  const newWeek = recs.filter(r => r.createdAt >= now() - 7 * DAY).length;
  const wonMonth = wonRecs.filter(r => (r.stageAt ?? r.updatedAt) >= now() - 30 * DAY);
  const closed = wonRecs.length + lostRecs.length;
  const conv = closed ? Math.round((wonRecs.length / closed) * 100) : 0;
  const pl = primary.namePlural.toLowerCase();

  const cards: [string, string, string][] = moneyF
    ? [
        ["В работе", fmtMoney(sumOf(openRecs)) || "0 ₽", `${openRecs.length} ${plural(openRecs.length, "открыта", "открыты", "открыто")}`],
        ["Выиграно за месяц", fmtMoney(sumOf(wonMonth)) || "0 ₽", `${wonMonth.length} ${plural(wonMonth.length, "сделка", "сделки", "сделок")}`],
        ["Новых за неделю", String(newWeek), pl],
        ["Конверсия", closed ? conv + "%" : "—", closed ? `${wonRecs.length} из ${closed} закрытых` : "нет закрытых"],
      ]
    : [
        ["Открытых", String(openRecs.length), pl],
        ["Выиграно", String(wonRecs.length), `из ${recs.length} всего`],
        ["Новых за неделю", String(newWeek), pl],
        ["Конверсия", closed ? conv + "%" : "—", closed ? `${wonRecs.length} из ${closed}` : "нет закрытых"],
      ];

  const stageCount = (id: string) => recs.filter(r => r.stageId === id).length;
  const maxStage = Math.max(1, ...stages.map(st => stageCount(st.id)));

  // Источники — по полю «Источник», если он есть в разделе.
  const srcF = primary.fields.find(f => f.id === "source" || /источник/i.test(f.label));
  let sources: [string, number][] = [];
  if (srcF) {
    const m = new Map<string, number>();
    for (const r of recs) {
      const label = displayValue(srcF, r.values[srcF.id], dispCtx()).trim();
      if (label) m.set(label, (m.get(label) ?? 0) + 1);
    }
    sources = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }
  const maxSrc = Math.max(1, ...sources.map(([, n]) => n));

  const events = collapseFieldRuns([...s.activities].sort((a, b) => b.ts - a.ts)).slice(0, 7);

  return (
    <div className="cascade mx-auto max-w-4xl px-5 py-6">
      <ScreenHead title="Дашборд" sub={`Живая сводка по разделу «${primary.namePlural}»`} />

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-y py-4 md:grid-cols-4 md:divide-x">
        {cards.map(([l, v, sub], i) => (
          <div key={l} className={cn("md:px-5", i === 0 && "md:pl-0")}>
            <div className="eyebrow">{l}</div>
            <div className="font-mono2 tnum mt-1.5 text-[22px] font-medium leading-none tracking-tight">{v}</div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">{sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <div className="eyebrow">Воронка · {primary.namePlural}</div>
          <div className="mt-3 flex flex-col gap-1.5">
            {stages.map(stage => {
              const n = stageCount(stage.id);
              const w = Math.round((n / maxStage) * 100);
              return (
                <div key={stage.id} className="flex items-center gap-2.5">
                  <span className="w-28 truncate text-[11.5px] text-muted-foreground" title={stage.label}>{stage.label}</span>
                  <div className="h-[16px] flex-1 overflow-hidden rounded-[3px] bg-muted/70">
                    <div className="h-full rounded-[3px]" style={{ width: (n ? Math.max(6, w) : 0) + "%", background: stage.color + "d9" }} />
                  </div>
                  <span className="font-mono2 w-5 text-right text-[11px]">{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          {sources.length > 0 && (
            <>
              <div className="eyebrow">Источники</div>
              <div className="mt-3 flex flex-col gap-1.5">
                {sources.map(([l, n], i) => (
                  <div key={l} className="flex items-center gap-2.5">
                    <span className="w-28 truncate text-[11.5px] text-muted-foreground" title={l}>{l}</span>
                    <div className="h-[16px] flex-1 overflow-hidden rounded-[3px] bg-muted/70">
                      <div className="h-full rounded-[3px]" style={{ width: Math.max(6, Math.round((n / maxSrc) * 100)) + "%", background: i === 0 ? "hsl(var(--primary) / 0.75)" : "hsl(42 22% 72%)" }} />
                    </div>
                    <span className="font-mono2 w-5 text-right text-[11px]">{n}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className={cn("eyebrow", sources.length > 0 && "mt-6")}>Последние события</div>
          <div className="mt-2.5 flex flex-col gap-2">
            {events.length === 0 && <div className="text-[12px] text-muted-foreground">Пока пусто — события появятся с активностью в разделах.</div>}
            {events.map(a => {
              const rec = recById(a.recordId);
              return (
                <div key={a.id} className="flex items-baseline gap-2.5 text-[12px]">
                  <span className="font-mono2 shrink-0 text-[10.5px] text-muted-foreground">{relTime(a.ts)}</span>
                  <span className="min-w-0 flex-1 truncate" title={a.text}>{a.text}</span>
                  {rec && <span className="max-w-[110px] shrink-0 truncate text-[10.5px] text-muted-foreground">{recTitle(a.recordId)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Демо-данные: пока в базе примеры, человек должен знать, что это не его бизнес
// Хранилище браузера отказало — молчать нельзя: всё, что человек делает, живёт до закрытия вкладки
function StorageAlarm() {
  const app = useApp();
  const tab = tabState();
  const st = storageState();
  if (tab.follower && app.mode === "local") {
    return (
      <div role="alert" aria-live="assertive" className="flex flex-wrap items-center gap-2 border-b bg-destructive/10 px-4 py-2">
        <TriangleAlert className="size-4 shrink-0 text-destructive" />
        <span className="text-[12px] leading-snug text-destructive">
          <b className="font-semibold">CRM уже открыта в другой вкладке.</b> Здесь я ничего не сохраняю — иначе две вкладки
          затрут работу друг друга. Работайте в первой или перехватите здесь.
        </span>
        <button onClick={tabTakeOver}
          className="press ml-auto shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-[11.5px] text-destructive hover:bg-destructive/5">
          Работать здесь
        </button>
      </div>
    );
  }
  if (!st.broken) return null;
  return (
    <div role="alert" aria-live="assertive" className="flex flex-wrap items-center gap-2 border-b bg-destructive/10 px-4 py-2">
      <TriangleAlert className="size-4 shrink-0 text-destructive" />
      <span className="text-[12px] leading-snug text-destructive">
        <b className="font-semibold">База не сохраняется.</b> Браузер не даёт больше места ({Math.round(st.bytes / 1e5) / 10} МБ).
        Изменения пропадут при закрытии вкладки — выгрузите разделы в CSV и переходите в облачное пространство.
      </span>
    </div>
  );
}

function DemoNotice() {
  const s = useApp();
  const [armed, setArmed] = useState(false);
  if (s.mode === "cloud") return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2">
      <span className="text-[11.5px] leading-snug text-muted-foreground">
        В базе примеры — чужие сделки и клиенты. Загрузите свои через «Загрузить» в разделе или начните с чистого листа.
      </span>
      {armed ? (
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-destructive">удалить все примеры?</span>
          <button onClick={() => { A.resetDemo(); setArmed(false); }}
            className="press rounded border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/5">да</button>
          <button onClick={() => setArmed(false)} className="press rounded border px-2 py-0.5 text-[11px] text-muted-foreground">нет</button>
        </span>
      ) : (
        <button onClick={() => setArmed(true)}
          className="press ml-auto shrink-0 rounded-md border px-2 py-1 text-[11.5px] text-muted-foreground hover:border-foreground/25 hover:text-foreground">
          Очистить примеры
        </button>
      )}
    </div>
  );
}

// Название пространства: в облаке переименовывает команду, локально — просто подпись
function WorkspaceName() {
  const s = useApp();
  const [v, setV] = useState(s.wsName);
  useEffect(() => { setV(s.wsName); }, [s.wsName]);
  const save = () => { const n = v.trim(); if (!n || n === s.wsName) return; if (s.mode === "cloud") void renameWs(n); else setWsMeta(n, s.inviteCode); };
  return (
    <div className="mt-1 flex items-center gap-2">
      <input value={v} onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-9 w-full max-w-xs rounded-md border bg-background px-2.5 text-[13px] outline-none transition-colors focus:border-ring" />
      <span className="text-[11.5px] text-muted-foreground">{s.mode === "cloud" ? "видит вся команда" : "локально · войдите, чтобы делиться"}</span>
    </div>
  );
}

function SettingsScreen({ theme, setTheme }: { theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void }) {
  return (
    <div className="cascade mx-auto max-w-2xl px-3 py-6 md:px-5">
      <ScreenHead title="Настройки" />
      <div className="mt-5 divide-y rounded-lg border bg-card">
        <div className="px-4 py-3.5">
          <div className="text-[13px] font-semibold">Пространство</div>
          <DemoNotice />
          <label className="eyebrow mt-3 block">Название компании</label>
          <WorkspaceName />
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
        <RoutingLive />
        <TemplatesLive />
        <TeamLive />
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
              <Sparkles className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium">AI-ассистент</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">резюме карточки, черновик ответа, «спроси CRM» — ключ будет храниться на сервере, а не в браузере</span>
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

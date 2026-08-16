// Оболочка приложения: сайдбар, топбар (поиск, уведомления, пользователь), роутинг экранов
import { useEffect, useMemo, useRef, useState } from "react";
import { A, useApp, recTitle, entityById, undo } from "@/lib/store";
import { relTime, plural } from "@/lib/model";
import { Inbox } from "./Inbox";
import { Logo, SectionLabel, UserChip } from "./bits";
import { NewEntityDialog } from "./NewEntityDialog";
import { EntityScreen } from "./EntityScreen";
import { MyDay } from "./MyDay";
import { Dashboard } from "./Dashboard";
import { Automations } from "./Automations";
import { SettingsScreen } from "./SettingsScreen";
import { RecordDrawer } from "./RecordDrawer";
import { Checklist } from "./Checklist";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Bell, Inbox as InboxIcon, LayoutDashboard, Menu, Moon, Plus, Search, Settings, Sun, SunMedium, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function Shell() {
  const s = useApp();
  const ws = s.ws!;
  const [newEntityOpen, setNewEntityOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

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

  const myOpenTasks = ws.tasks.filter(t => !t.done && t.ownerId === s.currentUserId).length;
  const unreadChats = ws.chats.reduce((n, c) => n + c.unread, 0);

  const NavBtn = ({ page, icon, label, badge }: { page: "myday" | "dashboard" | "automations" | "inbox"; icon: React.ReactNode; label: string; badge?: number }) => (
    <button
      onClick={() => { A.go(page); setMobileNav(false); }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors",
        s.nav.page === page ? "bg-foreground/[0.07] font-medium" : "text-ink-2 hover:bg-foreground/[0.045]"
      )}
      style={s.nav.page !== page ? { color: "hsl(40 10% 34%)" } : undefined}
    >
      {icon}<span className="flex-1 text-left">{label}</span>
      {badge ? <span className="rounded-full px-1.5 text-[11px] font-semibold tnum" style={{ background: "hsl(42 42% 55% / 0.22)", color: "var(--brass-ink)" }}>{badge}</span> : null}
    </button>
  );

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r" style={{ background: "hsl(var(--sidebar))" }}>
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <Logo />
        <button className="md:hidden" onClick={() => setMobileNav(false)}><X className="size-4" /></button>
      </div>
      <div className="px-3 pb-2">
        <div className="truncate rounded-md border bg-card px-2.5 py-1.5 text-[13px] font-medium">{ws.name}</div>
      </div>
      <nav className="flex flex-col gap-0.5 px-3 py-2">
        <NavBtn page="myday" icon={<SunMedium className="size-4" />} label="Мой день" badge={myOpenTasks} />
        <NavBtn page="inbox" icon={<InboxIcon className="size-4" />} label="Входящие" badge={unreadChats} />
        <NavBtn page="dashboard" icon={<LayoutDashboard className="size-4" />} label="Дашборд" />
        <NavBtn page="automations" icon={<Zap className="size-4" />} label="Автоматизации" />
      </nav>
      <div className="mt-2 flex items-center justify-between pr-2">
        <SectionLabel className="px-5">Разделы</SectionLabel>
        <button title="Новый раздел" onClick={() => setNewEntityOpen(true)} className="rounded p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-2 pt-1">
        {ws.entities.map(e => {
          const n = ws.records.filter(r => r.entityId === e.id).length;
          const active = s.nav.page === "entity" && s.nav.entityId === e.id;
          return (
            <button
              key={e.id}
              onClick={() => { A.go("entity", e.id); setMobileNav(false); }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors",
                active ? "bg-foreground/[0.07] font-medium" : "hover:bg-foreground/[0.045]"
              )}
              style={!active ? { color: "hsl(40 10% 34%)" } : undefined}
            >
              <span className="text-[15px] leading-none">{e.icon}</span>
              <span className="flex-1 truncate text-left">{e.namePlural}</span>
              <span className="text-[11.5px] text-muted-foreground/70 tnum">{n}</span>
            </button>
          );
        })}
        <button onClick={() => setNewEntityOpen(true)}
          className="mt-1 flex w-full items-center gap-2.5 rounded-md border border-dashed px-2.5 py-[7px] text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
          <Plus className="size-3.5" /> Новый раздел
        </button>
      </div>
      <div className="border-t px-3 py-2.5">
        <button
          onClick={() => { A.go("settings"); setMobileNav(false); }}
          className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px]", s.nav.page === "settings" ? "bg-foreground/[0.07] font-medium" : "hover:bg-foreground/[0.045]")}
          style={s.nav.page !== "settings" ? { color: "hsl(40 10% 34%)" } : undefined}
        >
          <Settings className="size-4" /> Настройки
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:block">{sidebar}</div>
      {mobileNav && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-foreground/20" onClick={() => setMobileNav(false)} />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b px-3 md:px-4" style={{ background: "hsl(var(--topbar))" }}>
          <button className="rounded-md p-1.5 hover:bg-muted md:hidden" onClick={() => setMobileNav(true)}><Menu className="size-4.5 h-[18px] w-[18px]" /></button>
          <GlobalSearch />
          <div className="flex-1" />
          <button
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={s.theme === "light" ? "Тёмная тема" : "Светлая тема"}
            onClick={() => A.setTheme(s.theme === "light" ? "dark" : "light")}
          >
            {s.theme === "light" ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
          </button>
          <Notifications />
          <UserSwitcher />
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          {s.nav.page === "myday" && <MyDay />}
          {s.nav.page === "inbox" && <Inbox />}
          {s.nav.page === "dashboard" && <Dashboard />}
          {s.nav.page === "automations" && <Automations />}
          {s.nav.page === "settings" && <SettingsScreen />}
          {s.nav.page === "entity" && s.nav.entityId && <EntityScreen key={s.nav.entityId} entityId={s.nav.entityId} />}
        </main>
      </div>

      {s.drawerRecordId && <RecordDrawer recordId={s.drawerRecordId} />}
      <Checklist />
      <NewEntityDialog open={newEntityOpen} onOpenChange={setNewEntityOpen} />
    </div>
  );
}

function GlobalSearch() {
  const s = useApp();
  const ws = s.ws!;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) { e.preventDefault(); ref.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const results = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (qq.length < 2) return [];
    return ws.records
      .map(r => {
        const e = entityById(r.entityId)!;
        const title = recTitle(r.id);
        const hay = [title, ...e.fields.filter(f => ["text", "phone", "email"].includes(f.type)).map(f => String(r.values[f.id] ?? ""))].join(" ").toLowerCase();
        return hay.includes(qq) ? { r, e, title } : null;
      })
      .filter(Boolean)
      .slice(0, 8) as { r: (typeof ws.records)[0]; e: NonNullable<ReturnType<typeof entityById>>; title: string }[];
  }, [q, ws.records]);

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref} value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Поиск по всем разделам…   /"
        className="h-9 border-transparent bg-muted/70 pl-8.5 pl-9 focus-visible:border-input focus-visible:bg-card"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-10 z-50 overflow-hidden rounded-lg border bg-popover shadow-lg fade-in">
          {results.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">Ничего не найдено</div>}
          {results.map(({ r, e, title }) => (
            <button key={r.id} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted"
              onMouseDown={() => { A.go("entity", e.id); A.openRecord(r.id); setQ(""); }}>
              <span>{e.icon}</span>
              <span className="flex-1 truncate">{title}</span>
              <span className="text-xs text-muted-foreground">{e.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const s = useApp();
  const ws = s.ws!;
  const [seen, setSeen] = useState(0);
  const unread = ws.notices.length - seen;
  return (
    <Popover onOpenChange={o => { if (o) setSeen(ws.notices.length); }}>
      <PopoverTrigger asChild>
        <button className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Bell className="size-[18px]" />
          {unread > 0 && <span className="absolute right-1 top-1 size-2 rounded-full" style={{ background: "hsl(41 46% 45%)" }} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2.5 text-sm font-semibold">Уведомления</div>
        <div className="max-h-80 overflow-y-auto">
          {ws.notices.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">Пока пусто</div>}
          {ws.notices.map(n => (
            <div key={n.id} className="flex gap-2.5 border-b px-3 py-2.5 text-[13px] last:border-0">
              <span>{n.icon ?? "⚡"}</span>
              <div>
                <div className="leading-snug">{n.text}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">{relTime(n.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserSwitcher() {
  const s = useApp();
  const ws = s.ws!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
          <UserChip id={s.currentUserId} size={26} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Смотреть от лица (демо ролей)</DropdownMenuLabel>
        {ws.users.map(u => (
          <DropdownMenuItem key={u.id} onClick={() => A.setUser(u.id)} className="gap-2.5">
            <UserChip id={u.id} size={22} withName />
            <span className="ml-auto text-xs text-muted-foreground">{u.role}</span>
            {u.id === s.currentUserId && <span className="text-xs" style={{ color: "var(--brass-ink)" }}>●</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11.5px] leading-snug text-muted-foreground">
          {ws.users.length} {plural(ws.users.length, "сотрудник", "сотрудника", "сотрудников")} · роли и права — в настройках
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import type { ReactNode } from "react";
import type { Option, Stage } from "@/lib/model";
import { fmtDate } from "@/lib/model";
import { userById } from "@/lib/store";
import { cn } from "@/lib/utils";

export const hexA = (hex: string, a: number) => hex + Math.round(a * 255).toString(16).padStart(2, "0");

export function OptionBadge({ o, small }: { o?: Option; small?: boolean }) {
  if (!o) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border font-medium", small ? "px-2 py-px text-[11.5px]" : "px-2.5 py-0.5 text-xs")}
      style={{ background: hexA(o.color, 0.10), borderColor: hexA(o.color, 0.35), color: "hsl(var(--foreground) / 0.88)" }}
    >
      <span className="size-1.5 rounded-full" style={{ background: o.color }} />
      {o.label}
    </span>
  );
}

export function StageBadge({ s, small }: { s?: Stage; small?: boolean }) {
  if (!s) return null;
  return <OptionBadge o={{ id: s.id, label: s.label, color: s.color }} small={small} />;
}

export function UserChip({ id, size = 22, withName }: { id?: string; size?: number; withName?: boolean }) {
  const u = userById(id);
  if (!u) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        className="grid place-items-center rounded-full font-semibold text-[10.5px] shrink-0"
        style={{ width: size, height: size, background: `hsl(${u.hue} 32% 88%)`, color: `hsl(${u.hue} 45% 26%)` }}
        title={u.name}
      >
        {u.name[0]}
      </span>
      {withName && <span className="truncate text-sm">{u.name}</span>}
    </span>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/80", className)}>{children}</div>;
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="fade-in flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-3xl opacity-70">{icon}</div>
      <div className="font-medium">{title}</div>
      {hint && <div className="max-w-sm text-sm text-muted-foreground">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function DueLabel({ due, done }: { due: number; done?: boolean }) {
  const overdue = !done && due < Date.now();
  const today = new Date(due).toDateString() === new Date().toDateString();
  return (
    <span className={cn("tnum text-xs", done ? "text-muted-foreground line-through" : overdue ? "text-destructive font-medium" : today ? "text-foreground" : "text-muted-foreground")}>
      {overdue ? "просрочено · " : ""}
      {today
        ? new Date(due).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        : fmtDate(due)}
    </span>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex select-none items-center gap-2">
      <span className="mark-frame grid h-6 w-6 place-items-center rounded-[5px] bg-transparent text-[10px] font-bold tracking-tight" style={{ color: "var(--brass-ink)" }}>
        XXL
      </span>
      {!compact && <span className="text-[15px] font-semibold tracking-tight">XXLcrm</span>}
    </span>
  );
}

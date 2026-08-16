import type { Option, Stage } from "@/lib/model";
import { userById } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Money = ({ v, className }: { v: string; className?: string }) => (
  <span className={cn("font-mono2 tnum", className)}>{v}</span>
);

export function Pill({ o, small }: { o?: { label: string; color: string } | Option | Stage; small?: boolean }) {
  if (!o) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border font-medium", small ? "px-2 py-px text-[11px]" : "px-2.5 py-0.5 text-[11.5px]")}
      style={{ background: o.color + "18", borderColor: o.color + "50", color: "hsl(var(--foreground) / 0.9)" }}>
      <span className="size-1.5 rounded-full" style={{ background: o.color }} />
      {o.label}
    </span>
  );
}

export function UserChip({ id, size = 20, withName }: { id?: string; size?: number; withName?: boolean }) {
  const u = userById(id);
  if (!u) return <span className="text-[12px] text-muted-foreground">—</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="grid shrink-0 place-items-center rounded-full text-[10px] font-semibold"
        style={{ width: size, height: size, background: `hsl(${u.hue} 30% 87%)`, color: `hsl(${u.hue} 42% 27%)` }} title={u.name}>
        {u.name[0]}
      </span>
      {withName && <span className="truncate text-[12.5px]">{u.name}</span>}
    </span>
  );
}

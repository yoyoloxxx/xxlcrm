// Представление «Карточки»: плитка записей с ключевыми полями
import type { Entity, Rec } from "@/lib/model";
import { displayValue } from "@/lib/model";
import { A, dispCtx, recTitle } from "@/lib/store";
import { StageBadge, UserChip } from "./bits";

export function CardsView({ entity: e, records }: { entity: Entity; records: Rec[] }) {
  const shown = e.fields.filter(f => f.id !== e.titleFieldId && f.inTable !== false).slice(0, 4);
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:p-5 lg:grid-cols-3 xl:grid-cols-4">
      {records.sort((a, b) => b.createdAt - a.createdAt).map(r => (
        <button
          key={r.id}
          onClick={() => A.openRecord(r.id)}
          className="fade-in rounded-lg border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(50,42,25,0.3)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium leading-snug">{recTitle(r.id)}</div>
            <UserChip id={r.ownerId} size={20} />
          </div>
          {e.pipeline && <div className="mt-2"><StageBadge s={e.pipeline.stages.find(s => s.id === r.stageId)} small /></div>}
          <div className="mt-2.5 flex flex-col gap-1">
            {shown.map(f => {
              const v = displayValue(f, r.values[f.id], dispCtx());
              if (!v) return null;
              return (
                <div key={f.id} className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="w-24 shrink-0 truncate text-muted-foreground">{f.label}</span>
                  <span className="truncate">{v}</span>
                </div>
              );
            })}
          </div>
        </button>
      ))}
    </div>
  );
}

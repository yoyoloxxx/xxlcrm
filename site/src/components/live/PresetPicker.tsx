// Быстрый старт: выбор пресета ниши. Один клик — готовые разделы, воронка, автоматизации и примеры.
import { useState } from "react";
import { A } from "@/lib/store";
import { PRESETS, type Preset } from "@/lib/presets";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowLeft, Check } from "lucide-react";

export function PresetPicker({ open, onOpenChange, hasData, onApplied }: {
  open: boolean; onOpenChange: (o: boolean) => void; hasData: boolean; onApplied: () => void;
}) {
  const [confirm, setConfirm] = useState<Preset | null>(null);
  const apply = (p: Preset) => { A.applyPreset(p.id); setConfirm(null); onOpenChange(false); onApplied(); };
  const pick = (p: Preset) => (hasData ? setConfirm(p) : apply(p));
  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setConfirm(null); }}>
      <DialogContent className="sm:max-w-lg">
        {confirm ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[15px]">Применить «{confirm.label}»?</DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                Это заменит текущие разделы, воронку и записи демонстрационными примерами ниши.
                Действие можно отменить сразу через Ctrl+Z.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 flex-1" onClick={() => setConfirm(null)}><ArrowLeft className="size-3.5" /> Назад</Button>
              <Button className="h-10 flex-1" onClick={() => apply(confirm)}>Применить шаблон</Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[15px]">
                <Sparkles className="size-4" style={{ color: "var(--brass-ink)" }} /> Быстрый старт: выберите нишу
              </DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                Готовая настройка под ваш бизнес — разделы, воронка, автоматизации и примеры для наглядности.
                Всё потом свободно меняется под себя.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              {PRESETS.map(p => {
                const stages = p.entities.find(e => (e.stages?.length ?? 0) > 0)?.stages?.length ?? 0;
                return (
                  <button key={p.id} onClick={() => pick(p)}
                    className="press group flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-foreground/30">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg text-[20px]" style={{ background: p.accent + "1f" }}>{p.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium">{p.label}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{p.tagline}</span>
                      <span className="font-mono2 mt-0.5 block text-[10px] text-muted-foreground/70">{stages} стадий · {p.rules.length} автоматизаций · примеры</span>
                    </span>
                    <Check className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70" />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

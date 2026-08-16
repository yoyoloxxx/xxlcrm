// Создание нового раздела (сущности) — главный «вау-момент» конструктора
import { useState } from "react";
import { A } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const PRESETS = [
  { name: "Заявка", plural: "Заявки", icon: "📨", pipeline: true },
  { name: "Заказ", plural: "Заказы", icon: "📦", pipeline: true },
  { name: "Объект", plural: "Объекты", icon: "🏠", pipeline: false },
  { name: "Ученик", plural: "Ученики", icon: "🎓", pipeline: false },
  { name: "Договор", plural: "Договоры", icon: "🧾", pipeline: true },
  { name: "Партнёр", plural: "Партнёры", icon: "🤝", pipeline: false },
];
const EMOJI = ["📁", "📨", "📦", "🏠", "🎓", "🧾", "🤝", "🚗", "🛠️", "⭐", "🎟️", "❤️"];

export function NewEntityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState("");
  const [plural, setPlural] = useState("");
  const [icon, setIcon] = useState("📁");
  const [pipeline, setPipeline] = useState(true);

  const create = () => {
    if (!name.trim()) return;
    A.addEntity(name.trim(), (plural.trim() || name.trim()), icon, pipeline);
    onOpenChange(false);
    setName(""); setPlural(""); setIcon("📁"); setPipeline(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Новый раздел</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-[13px] leading-snug text-muted-foreground">
          Раздел — это ваша сущность: заявки, объекты, ученики, договоры. Своя таблица, свои поля, при желании — своя воронка.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button key={p.name}
              onClick={() => { setName(p.name); setPlural(p.plural); setIcon(p.icon); setPipeline(p.pipeline); }}
              className="rounded-full border px-2.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
              {p.icon} {p.plural}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Ед. число</label>
            <Input autoFocus className="mt-1 h-9" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} placeholder="Заявка" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Мн. число</label>
            <Input className="mt-1 h-9" value={plural} onChange={e => setPlural(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} placeholder="Заявки" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Иконка</label>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {EMOJI.map(em => (
              <button key={em} onClick={() => setIcon(em)}
                className={cn("grid h-8 w-8 place-items-center rounded-md border transition-colors hover:bg-muted", icon === em && "border-transparent")}
                style={icon === em ? { background: "hsl(42 42% 55% / 0.25)" } : undefined}>
                {em}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Сразу с воронкой</div>
            <div className="text-xs text-muted-foreground">Стадии «Новая → В работе → Готово», канбан</div>
          </div>
          <Switch checked={pipeline} onCheckedChange={setPipeline} />
        </div>
        <Button onClick={create} disabled={!name.trim()}>Создать раздел</Button>
      </DialogContent>
    </Dialog>
  );
}

// Быстрый старт: пресеты ниш + «Мои шаблоны». Один клик — готовые разделы, воронка, автоматизации и примеры.
// Онбординг-режим: показывается сам на пустом пространстве, с кнопкой «Позже».
import { useState } from "react";
import { A, useApp, getState } from "@/lib/store";
import { plural } from "@/lib/model";
import { PRESETS, loadCustomPresets, type Preset } from "@/lib/presets";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, ArrowLeft, Check, Trash2, Save } from "lucide-react";

function PresetCard({ p, onPick, onDelete }: { p: Preset; onPick: () => void; onDelete?: () => void }) {
  const stages = p.entities.find(e => (e.stages?.length ?? 0) > 0)?.stages?.length ?? 0;
  return (
    <div className="group relative">
      <button onClick={onPick}
        className="press flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-foreground/30">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg text-[20px]" style={{ background: p.accent + "1f" }}>{p.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">{p.label}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{p.tagline}</span>
          <span className="font-mono2 mt-0.5 block text-[10px] text-muted-foreground">{stages} стадий · {p.rules.length} автоматизаций{p.custom ? "" : " · примеры"}</span>
        </span>
        {!onDelete && <Check className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70" />}
      </button>
      {onDelete && (
        <button onClick={onDelete} title="Удалить шаблон" aria-label="Удалить шаблон"
          className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100">
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function PresetPicker({ open, onOpenChange, hasData, onboarding, onApplied }: {
  open: boolean; onOpenChange: (o: boolean) => void; hasData: boolean; onboarding?: boolean; onApplied: () => void;
}) {
  useApp(); // подписка: «Мои шаблоны» перечитываются после сохранения/удаления
  const [confirm, setConfirm] = useState<Preset | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const custom = loadCustomPresets();

  const s0 = getState();
  const counts = {
    records: s0.records.length, chats: s0.chats.length, tasks: s0.tasks.length,
    mine: s0.records.filter(r => !r.demo).length + s0.chats.filter(c => !c.demo).length + s0.tasks.filter(t => !t.demo).length,
  };
  const apply = (p: Preset) => { A.applyPreset(p.id); onApplied(); close(false); };
  const pick = (p: Preset) => (hasData ? setConfirm(p) : apply(p));
  const doSave = () => { if (!name.trim()) return; A.savePresetFromCurrent(name.trim()); setName(""); setSaving(false); };
  const close = (o: boolean) => { onOpenChange(o); if (!o) { setConfirm(null); setSaving(false); setName(""); } };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {confirm ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[15px]">Применить «{confirm.label}»?</DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                {counts.mine === 0 ? (
                  // На экране одни примеры: пугать новичка «уйдут 13 записей» нечестно — своего у него ещё ничего нет
                  <>Это настроит разделы и воронку{confirm.custom ? "" : " и заменит примеры на примеры этой ниши"}. Ваших данных здесь ещё нет — терять нечего. Передумаете — Ctrl+Z вернёт как было.</>
                ) : (
                  <>Это заменит разделы и воронку{confirm.custom ? "" : ", а записи — примерами ниши"}. Уйдут <b className="font-medium text-foreground">
                  {counts.records} {plural(counts.records, "запись", "записи", "записей")},
                  {" "}{counts.chats} {plural(counts.chats, "диалог", "диалога", "диалогов")},
                  {" "}{counts.tasks} {plural(counts.tasks, "задача", "задачи", "задач")}
                  </b> — из них <b className="font-medium text-foreground">{counts.mine} {plural(counts.mine, "ваша", "ваши", "ваших")}, не из примеров</b>.
                  {" "}Вернуть — кнопкой «Отменить» сразу после применения (или Ctrl+Z). Свою базу лучше сначала выгрузить в CSV.</>
                )}
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
                <Sparkles className="size-4" style={{ color: "var(--brass-ink)" }} /> {onboarding ? "С чего начнём?" : "Быстрый старт: выберите нишу"}
              </DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                Выберите профиль бизнеса — соберём разделы, воронку, автоматизации и примеры за один клик.
                Всё потом свободно меняется под себя.
              </DialogDescription>
            </DialogHeader>

            <div className="-mr-1 flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
              {custom.length > 0 && (
                <>
                  <div className="eyebrow">Мои шаблоны</div>
                  {custom.map(p => <PresetCard key={p.id} p={p} onPick={() => pick(p)} onDelete={() => A.removeCustomPreset(p.id)} />)}
                  <div className="eyebrow mt-2">Готовые ниши</div>
                </>
              )}
              {PRESETS.map(p => <PresetCard key={p.id} p={p} onPick={() => pick(p)} />)}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              {saving ? (
                <div className="flex flex-1 gap-2">
                  <Input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && doSave()}
                    placeholder="Название шаблона…" className="h-9 text-[13px]" />
                  <Button className="h-9" disabled={!name.trim()} onClick={doSave}>Сохранить</Button>
                </div>
              ) : (
                <button onClick={() => setSaving(true)}
                  className="press inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
                  <Save className="size-3.5" /> Сохранить текущую настройку как шаблон
                </button>
              )}
              {onboarding && !saving && (
                <button onClick={() => close(false)} className="press text-[12px] text-muted-foreground transition-colors hover:text-foreground">
                  Позже — настрою сам
                </button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

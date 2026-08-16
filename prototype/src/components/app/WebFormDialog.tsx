// Веб-форма: конструктор + живое превью «как на сайте» — заявка падает в воронку
import { useState } from "react";
import { A, entityById } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Check } from "lucide-react";

export function WebFormDialog({ entityId, open, onOpenChange }: { entityId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const e = entityById(entityId)!;
  const candidates = e.fields.filter(f => ["text", "phone", "email", "textarea", "money", "number"].includes(f.type));
  const [selected, setSelected] = useState<string[]>(() =>
    [e.titleFieldId, e.fields.find(f => f.type === "phone")?.id].filter(Boolean) as string[]);
  const [preview, setPreview] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const fields = candidates.filter(f => selected.includes(f.id));

  const submit = () => {
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (vals[f.id] ?? "").trim();
      if (!raw) continue;
      values[f.id] = ["money", "number"].includes(f.type) ? Number(raw.replace(/\s/g, "")) || undefined : raw;
    }
    const srcF = e.fields.find(f => f.type === "select" && f.options?.some(o => /сайт/i.test(o.label)));
    const srcO = srcF?.options?.find(o => /сайт/i.test(o.label));
    if (srcF && srcO) values[srcF.id] = srcO.id;
    A.createRecord(e.id, values, undefined, { source: "веб-форма" });
    setSent(true);
    toast.success(`Заявка упала в «${e.namePlural}» — смотрите воронку`);
    setTimeout(() => { setSent(false); setPreview(false); setVals({}); onOpenChange(false); }, 1400);
  };

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); setPreview(false); setSent(false); }}>
      <DialogContent className="sm:max-w-md">
        {!preview ? (
          <>
            <DialogHeader><DialogTitle className="text-[15px]">Веб-форма для «{e.namePlural}»</DialogTitle></DialogHeader>
            <p className="-mt-1 text-[12.5px] leading-snug text-muted-foreground">
              Такая форма встраивается на сайт, заявки сами создаются в воронке и запускают автоматизации. Выберите поля и посмотрите превью.
            </p>
            <div className="flex flex-col gap-1">
              {candidates.map(f => (
                <label key={f.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox
                    checked={selected.includes(f.id)}
                    onCheckedChange={c => setSelected(s => c ? [...s, f.id] : s.filter(x => x !== f.id))}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <Button onClick={() => setPreview(true)} disabled={!fields.length}>Открыть превью формы</Button>
          </>
        ) : (
          <div className="-m-6 rounded-lg p-6 wizard-bg">
            <div className="mx-auto max-w-sm rounded-xl border bg-card p-5 shadow-lg">
              {sent ? (
                <div className="fade-in py-8 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-full" style={{ background: "hsl(42 42% 55% / 0.25)" }}>
                    <Check className="size-5" style={{ color: "var(--brass-ink)" }} />
                  </div>
                  <div className="mt-3 font-semibold">Заявка отправлена!</div>
                  <div className="mt-1 text-[12.5px] text-muted-foreground">Она уже в вашей воронке — и автоматизация поставила задачу менеджеру.</div>
                </div>
              ) : (
                <>
                  <div className="text-[15px] font-semibold">Оставьте заявку</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">Ответим в течение 15 минут (превью формы с вашего сайта)</div>
                  <div className="mt-4 flex flex-col gap-2.5">
                    {fields.map(f => (
                      <div key={f.id}>
                        <label className="text-[11.5px] font-medium text-muted-foreground">{f.label}</label>
                        {f.type === "textarea" ? (
                          <textarea rows={2} value={vals[f.id] ?? ""} onChange={ev => setVals(v => ({ ...v, [f.id]: ev.target.value }))}
                            className="mt-1 w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring" />
                        ) : (
                          <input value={vals[f.id] ?? ""} onChange={ev => setVals(v => ({ ...v, [f.id]: ev.target.value }))}
                            placeholder={f.type === "phone" ? "+7 ___ ___-__-__" : ""}
                            className="mt-1 h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:border-ring" />
                        )}
                      </div>
                    ))}
                  </div>
                  <Button className="mt-4 w-full" onClick={submit}>Отправить</Button>
                  <button className="mt-2 w-full text-center text-[11.5px] text-muted-foreground hover:text-foreground" onClick={() => setPreview(false)}>← назад к настройке</button>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

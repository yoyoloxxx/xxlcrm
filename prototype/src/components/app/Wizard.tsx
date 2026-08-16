// Мастер первого запуска: ниша → имя → сборка. Единственный «латунный» экран прототипа.
import { useEffect, useRef, useState } from "react";
import { TEMPLATE_META } from "@/lib/templates";
import { A } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "./bits";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const BUILD_STEPS = ["Создаём разделы и поля", "Настраиваем воронку и стадии", "Включаем автоматизации", "Наполняем демо-данными", "Собираем дашборд"];

export function Wizard() {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [tpl, setTpl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [buildIdx, setBuildIdx] = useState(0);
  const timer = useRef<number[]>([]);

  const meta = TEMPLATE_META.find(t => t.key === tpl);

  useEffect(() => () => timer.current.forEach(clearTimeout), []);

  const startBuild = () => {
    setStep(2);
    BUILD_STEPS.forEach((_, i) => timer.current.push(window.setTimeout(() => setBuildIdx(i + 1), 260 * (i + 1))));
    timer.current.push(window.setTimeout(() => A.start(tpl!, name.trim()), 260 * BUILD_STEPS.length + 420));
  };

  return (
    <div className="wizard-bg flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <Logo />
        <span className="rounded-full border border-foreground/15 px-3 py-1 text-xs text-muted-foreground">интерактивный прототип · демо-данные</span>
      </header>

      {step === 0 && (
        <main className="fade-in mx-auto grid w-full max-w-5xl flex-1 content-start gap-10 px-6 pb-16 pt-6 md:grid-cols-[1fr_1.25fr] md:gap-14 md:px-10 md:pt-14">
          <div>
            <h1 className="font-display text-[44px] leading-[1.04] tracking-[-0.01em] md:text-[56px]">
              CRM, которую вы<br />собираете <em className="not-italic" style={{ color: "var(--brass-ink)" }}>под себя</em>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink" style={{ color: "hsl(40 10% 34%)" }}>
              Свои разделы, поля, воронки и отчёты, без программиста и интегратора.
              Выберите нишу: соберём готовую систему за минуту, дальше перестроите её как угодно.
            </p>
            <div className="mt-8 flex flex-col gap-2.5 text-sm" style={{ color: "hsl(40 10% 34%)" }}>
              {["Готовый шаблон вместо пустого экрана", "Канбан, таблицы, календарь и дашборды", "Автоматизации: система работает за вас"].map(t => (
                <div key={t} className="flex items-center gap-2.5">
                  <span className="grid size-4.5 h-[18px] w-[18px] place-items-center rounded-full" style={{ background: "hsl(42 42% 55% / 0.18)" }}>
                    <Check className="size-3" style={{ color: "var(--brass-ink)" }} />
                  </span>
                  {t}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-medium text-muted-foreground">Какой у вас бизнес?</div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {TEMPLATE_META.map(t => (
                <button
                  key={t.key}
                  onClick={() => { setTpl(t.key); setStep(1); }}
                  className={cn(
                    "group rounded-lg border bg-card/80 p-4 text-left transition-all duration-150 ease-swift",
                    "hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-[0_10px_28px_-16px_rgba(60,50,30,0.35)]",
                    t.key === "blank" && "sm:col-span-2"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-[22px]">{t.icon}</span>
                    <ArrowRight className="mt-1 size-4 text-muted-foreground/0 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground/70" />
                  </div>
                  <div className="mt-2.5 font-semibold leading-tight">{t.title}</div>
                  <div className="mt-1 text-[13px] leading-snug text-muted-foreground">{t.desc}</div>
                  <div className="mt-2.5 text-[11.5px] font-medium tracking-wide text-muted-foreground/70">{t.entitiesHint}</div>
                </button>
              ))}
            </div>
          </div>
        </main>
      )}

      {step === 1 && meta && (
        <main className="fade-in mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-24">
          <button onClick={() => setStep(0)} className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Другая ниша
          </button>
          <div className="text-[22px]">{meta.icon}</div>
          <h2 className="font-display mt-2 text-[34px] leading-tight">{meta.title}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">Соберём: {meta.entitiesHint.toLowerCase()} + задачи, автоматизации и дашборд.</p>
          <label className="mt-8 text-sm font-medium">Название компании</label>
          <Input
            autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && startBuild()}
            placeholder={meta.key === "salon" ? "Студия «Лика»" : meta.key === "shop" ? "Магазин «Норд»" : "Моя компания"}
            className="mt-2 h-11 bg-card text-[15px]"
          />
          <Button onClick={startBuild} className="mt-4 h-11 text-[15px]">
            Собрать мою CRM <ArrowRight className="ml-1.5 size-4" />
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">Всё можно переименовать и перестроить позже — это и есть суть конструктора.</p>
        </main>
      )}

      {step === 2 && (
        <main className="fade-in mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 pb-24">
          <div className="mx-auto mb-6 grid h-12 w-12 place-items-center rounded-[10px] mark-frame text-xs font-bold" style={{ color: "var(--brass-ink)" }}>XXL</div>
          <div className="flex flex-col gap-3">
            {BUILD_STEPS.map((s, i) => (
              <div key={s} className={cn("flex items-center gap-3 text-sm transition-opacity duration-200", i < buildIdx ? "opacity-100" : "opacity-30")}>
                <span className={cn("grid h-5 w-5 place-items-center rounded-full border transition-colors", i < buildIdx ? "border-transparent" : "border-border")}
                  style={i < buildIdx ? { background: "hsl(42 42% 55% / 0.25)" } : undefined}>
                  {i < buildIdx && <Check className="size-3" style={{ color: "var(--brass-ink)" }} />}
                </span>
                {s}…
              </div>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}

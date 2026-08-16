// Плавающий чек-лист первых шагов: активация через «сделай сам», принцип Time-to-Value
import { A, useApp } from "@/lib/store";
import { Check, ChevronDown, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS: { key: keyof ReturnType<typeof stepsOf>; label: string; hint: string }[] = [
  { key: "openedRecord", label: "Открыть карточку записи", hint: "клик по названию в таблице или карточке канбана" },
  { key: "movedKanban", label: "Перетащить карточку в канбане", hint: "зажмите и перенесите в другую стадию" },
  { key: "addedField", label: "Добавить своё поле", hint: "кнопка «+ Поле» в таблице или «Настроить раздел»" },
  { key: "createdEntity", label: "Создать свой раздел", hint: "«+ Новый раздел» в меню слева" },
  { key: "openedDashboard", label: "Заглянуть в дашборд", hint: "пункт «Дашборд» в меню" },
];
function stepsOf(c: { openedRecord: boolean; movedKanban: boolean; addedField: boolean; createdEntity: boolean; openedDashboard: boolean }) { return c; }

export function Checklist() {
  const s = useApp();
  const c = s.checklist;
  const done = STEPS.filter(st => c[st.key]).length;
  const all = done === STEPS.length;

  if (!s.checklistOpen) {
    return (
      <button
        onClick={A.toggleChecklist}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-[13px] font-medium shadow-lg transition-transform hover:scale-[1.03]"
      >
        <Rocket className="size-4" style={{ color: "var(--brass-ink)" }} />
        Первые шаги · {done}/{STEPS.length}
      </button>
    );
  }

  return (
    <div className="fade-in fixed bottom-4 right-4 z-30 w-[300px] overflow-hidden rounded-xl border bg-card shadow-xl">
      <button onClick={A.toggleChecklist} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left">
        <Rocket className="size-4" style={{ color: "var(--brass-ink)" }} />
        <span className="flex-1 text-[13.5px] font-semibold">{all ? "Вы освоили конструктор!" : "Первые шаги"}</span>
        <span className="text-[12px] text-muted-foreground tnum">{done}/{STEPS.length}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      <div className="h-1 w-full bg-muted">
        <div className="h-full transition-all duration-300" style={{ width: `${(done / STEPS.length) * 100}%`, background: "hsl(41 46% 45%)" }} />
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        {STEPS.map(st => (
          <div key={st.key} className={cn("rounded-lg px-2 py-1.5", !c[st.key] && "hover:bg-muted/60")}>
            <div className="flex items-center gap-2.5">
              <span className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors", c[st.key] && "border-transparent")}
                style={c[st.key] ? { background: "hsl(42 42% 55% / 0.3)" } : undefined}>
                {c[st.key] && <Check className="size-3" style={{ color: "var(--brass-ink)" }} />}
              </span>
              <span className={cn("text-[13px] leading-tight", c[st.key] && "text-muted-foreground line-through")}>{st.label}</span>
            </div>
            {!c[st.key] && <div className="ml-[30px] mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{st.hint}</div>}
          </div>
        ))}
      </div>
      {all && (
        <div className="border-t px-3.5 py-2.5 text-[12px] leading-snug text-muted-foreground">
          В реальном продукте здесь начинается ваша CRM. В прототипе можно сбросить всё и попробовать другую нишу — в «Настройках».
        </div>
      )}
    </div>
  );
}

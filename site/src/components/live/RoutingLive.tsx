// «Куда падают заявки»: у каждого источника свой маршрут — раздел, стадия, ответственный, карточка клиента.
// Это ответ на вопрос «как клиент из Telegram оказывается в разделе Новые» — и место, где это меняется.
import type { InboundSource } from "@/lib/model";
import { SOURCES, sourceName, OWNER_ROUND } from "@/lib/model";
import { useApp, A, routeOf, resolveRoute, allEntities } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Route as RouteIcon } from "lucide-react";
import { focusChannel, channelCard } from "@/lib/focus";
import { cn } from "@/lib/utils";

const NO_STAGE = "__first";
const NO_OWNER = "__taker";

function connected(s: ReturnType<typeof useApp>, src: InboundSource): boolean {
  const i = s.integrations;
  if (src === "tg") return i.tg.status === "ok" || i.tgUser.status === "ok";
  if (src === "wa") return i.wa.status === "ok";
  if (src === "max") return i.max.status === "ok";
  if (src === "tilda") return i.tilda.status === "ok";
  return i.ig.status === "ok"; // Instagram: создан серверный приёмник
}

export function RoutingLive({ goSettings }: { goSettings?: () => void }) {
  const s = useApp();
  const entities = allEntities();

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <RouteIcon className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Куда падают заявки
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Написал новый человек — CRM сама заводит запись. Здесь видно и меняется, <b>в какой раздел</b>, <b>в какую стадию</b> и <b>на кого</b>.
      </p>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {SOURCES.map(src => {
          const r = routeOf(src);
          const { entity, stage, ownerId } = resolveRoute(src);
          const on = connected(s, src);
          return (
            <div key={src} data-route={src} className={cn("rounded-md border p-2.5", !r.auto && "bg-muted/30")}>
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium">{sourceName(src)}</span>
                {on ? (
                  <span className="font-mono2 rounded-full px-1.5 py-px text-[9.5px] text-[var(--brass-ink)]" style={{ background: "hsl(var(--brass) / 0.18)" }}>
                    подключён
                  </span>
                ) : (
                  // не подключён — это не приговор, а кнопка: ведём ровно к карточке этого канала
                  <button onClick={() => { goSettings?.(); focusChannel(channelCard(src)); }}
                    title={`Открыть настройку канала «${sourceName(src)}»`}
                    className="press font-mono2 rounded-full px-1.5 py-px text-[9.5px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                    style={{ background: "hsl(var(--muted))" }}>
                    не подключён · подключить
                  </button>
                )}
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-[11.5px] text-muted-foreground">
                  {r.auto ? "заявка сразу" : "только диалог"}
                  <Switch checked={r.auto} onCheckedChange={v => A.routeUpdate(src, { auto: v })} />
                </label>
              </div>

              {r.auto && (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                    <Select value={entity?.id ?? ""} onValueChange={v => A.routeUpdate(src, { entityId: v, stageId: undefined })}>
                      <SelectTrigger aria-label={`${sourceName(src)}: в какой раздел`} className="h-8 w-[150px] text-[12px]"><SelectValue placeholder="раздел" /></SelectTrigger>
                      <SelectContent>
                        {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.namePlural}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={r.stageId ?? NO_STAGE} onValueChange={v => A.routeUpdate(src, { stageId: v === NO_STAGE ? undefined : v })}>
                      <SelectTrigger aria-label={`${sourceName(src)}: в какую стадию`} className="h-8 w-[168px] text-[12px]" disabled={!entity?.stages?.length}>
                        <SelectValue placeholder={entity?.stages?.length ? "стадия" : "без стадий"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_STAGE}>{stage ? `Первая — ${stage.label}` : "Первая стадия"}</SelectItem>
                        {(entity?.stages ?? []).map(st => <SelectItem key={st.id} value={st.id}>{st.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={r.ownerId ?? NO_OWNER} onValueChange={v => A.routeUpdate(src, { ownerId: v === NO_OWNER ? undefined : v })}>
                      <SelectTrigger aria-label={`${sourceName(src)}: кто ответственный`} className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_OWNER}>Кто принял</SelectItem>
                        <SelectItem value={OWNER_ROUND}>По очереди{ownerId && r.ownerId === OWNER_ROUND ? ` (сейчас ${s.users.find(u => u.id === ownerId)?.name ?? ""})` : ""}</SelectItem>
                        {s.users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[11.5px] text-muted-foreground">
                    <Switch checked={r.createClient} onCheckedChange={v => A.routeUpdate(src, { createClient: v })} />
                    Заводить карточку клиента и связывать с записью
                  </label>
                </>
              )}
              {!r.auto && (
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                  Диалог просто ложится во Входящие. Кнопка «Создать» в диалоге сработает по этому же маршруту.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={() => { goSettings?.(); focusChannel("tg"); }}
        className="press mt-2 text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Где взять доступ к каналам — список со ссылками в «Интеграциях»
      </button>
    </div>
  );
}

// Однострочная подсказка «куда упадёт» — для шапки Входящих
export function RouteHint({ source, onEdit }: { source: InboundSource; onEdit: () => void }) {
  useApp();
  const { entity, stage, route } = resolveRoute(source);
  return (
    <button onClick={onEdit} title="Изменить маршрут приёма"
      className="press inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed px-2 text-[11.5px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
      <RouteIcon className="size-3" />
      {route.auto ? <>новые → <b className="font-medium">{entity?.namePlural ?? "—"}</b>{stage ? ` · ${stage.label}` : ""}</> : <>новые → только диалог</>}
    </button>
  );
}

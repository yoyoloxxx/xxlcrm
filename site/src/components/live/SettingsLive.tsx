// Живые секции настроек: интеграции каналов и шаблоны ответов
import { useEffect, useState } from "react";
import { plural, relTime, type InboundSource, type IntStatus } from "@/lib/model";
import { useApp, A, storageState, routeSummary, setAuthStage } from "@/lib/store";
import { tgConnect, waConnect, maxConnect, tildaCreateHook, tildaHookUrl } from "@/lib/integrations";
import { tgUseServer, tgUsePolling, waUseServer, waUsePolling, maxUseServer, maxUsePolling, ensureHookSecret, getHookSecret, rotateHookSecret, hookUrl, notifyLink, notifyTargets, notifyRemove, channelCheck, igEnsureReceiver, igReceiver, igDisableReceiver, ensureNotifySecret, rotateNotifySecret } from "@/lib/inbound";
import { Switch } from "@/components/ui/switch";
import { tguStartLogin, tguSubmitCode, tguSubmitPassword, tguCancelLogin, tguDisconnect, tguResync, TG_APP } from "@/lib/tg-user-lazy";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cloudPrivateWeight, purgePrivateFromCloud } from "@/lib/cloud";
import { supa, SUPA_URL } from "@/lib/supa";
import { InstaIcon } from "./icons";
import { focusChannel } from "@/lib/focus";

import { Bell, Check, Copy, ExternalLink, MessageCircle, MessageSquare, Pencil, Plug, Plus, RefreshCw, Send, Trash2, User, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SOFT = "text-[11.5px] leading-snug text-muted-foreground";

// прокрутить к маршруту канала в блоке «Куда падают заявки» ниже и подсветить его
function showRoute(src: InboundSource) {
  const el = document.querySelector(`[data-route="${src}"]`) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.boxShadow = "0 0 0 2px hsl(var(--brass))";
  window.setTimeout(() => { el.style.boxShadow = ""; }, 1600);
}

// «→ Сделка · Новая»: куда падают заявки из канала; клик ведёт к настройке маршрута
function RouteChip({ src }: { src: InboundSource }) {
  useApp();
  return (
    <button onClick={() => showRoute(src)} title="Куда падают заявки из этого канала — показать и настроить"
      className="press ml-auto hidden shrink-0 items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-[10.5px] font-normal text-muted-foreground hover:border-foreground/25 hover:text-foreground sm:inline-flex">
      → {routeSummary(src)}
    </button>
  );
}

// нумерованные шаги подключения: человек делает 1-2-3 и не читает документацию
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mt-2 flex flex-col gap-1">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[11.5px] leading-snug text-muted-foreground">
          <span className="font-mono2 mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold" style={{ background: "hsl(var(--brass) / 0.18)", color: "var(--brass-ink)" }}>{i + 1}</span>
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ol>
  );
}

const aCls = "underline underline-offset-2 hover:text-foreground";

// ГЛАВНАЯ КНОПКА КАЖДОГО КАНАЛА: «куда идти, чтобы это заработало».
// Человек не должен искать сервис в поиске — ссылка открывает нужную страницу сразу.
function Go({ href, children, dim }: { href: string; children: React.ReactNode; dim?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className={cn("press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-opacity hover:opacity-85",
        dim && "border text-muted-foreground hover:text-foreground")}
      style={dim ? undefined : { background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" }}>
      {children} <ExternalLink className="size-3" />
    </a>
  );
}

// Куда идти за каждым каналом — одно место на весь файл, чтобы ссылки не разъезжались
const WHERE: Record<string, { name: string; url: string; go: string; hint: string }> = {
  tg:   { name: "Telegram-бот", url: "https://t.me/BotFather", go: "Открыть @BotFather", hint: "команда /newbot → токен" },
  tgu:  { name: "Telegram: личный номер", url: "https://my.telegram.org/apps", go: "Открыть my.telegram.org", hint: "нужен только если нет вшитых ключей" },
  wa:   { name: "WhatsApp", url: "https://console.green-api.com/", go: "Открыть кабинет Green API", hint: "инстанс → QR → idInstance и токен" },
  max:  { name: "MAX", url: "https://max.ru/masterbot", go: "Открыть @MasterBot в MAX", hint: "команда /create → токен" },
  ig:   { name: "Instagram", url: "https://developers.facebook.com/apps/", go: "Открыть кабинет Meta", hint: "приложение → Instagram → Webhooks" },
  site: { name: "Сайт (форма)", url: "https://tilda.cc/projects/", go: "Открыть Тильду", hint: "Настройки сайта → Формы → Webhook" },
};

// «Что нужно сделать, чтобы заявки приходили» — один список со ссылками, вместо поиска по странице.
// Отвечает на жалобу «сложно найти, как подключить каждый сервис».
function SetupList() {
  const s = useApp();
  const i = s.integrations;
  const done: Record<string, boolean> = {
    tg: i.tg.status === "ok",
    wa: i.wa.status === "ok",
    max: i.max.status === "ok",
    ig: i.ig.status === "ok",
    site: i.tilda.status === "ok",
  };
  const rows = ["tg", "wa", "max", "ig", "site"];
  const left = rows.filter(r => !done[r]).length;
  return (
    <div className="mt-2.5 rounded-md border p-3" style={{ borderColor: "hsl(var(--brass) / 0.45)" }}>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">
        Что нужно сделать, чтобы заявки приходили
        <span className="font-mono2 rounded-full px-1.5 py-px text-[9.5px] font-medium"
          style={{ background: "hsl(var(--brass) / 0.18)", color: "var(--brass-ink)" }}>
          {left ? `осталось ${left} из ${rows.length}` : "все каналы подключены"}
        </span>
      </div>
      <p className={cn("mt-1", SOFT)}>
        Слева — где взять доступ (ссылка открывает нужную страницу сервиса), справа — куда вставить в CRM.
      </p>
      {s.mode !== "cloud" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2.5 py-2">
          <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-muted-foreground">
            <b className="font-medium text-foreground">Сначала войдите в аккаунт</b> — без него приём работает только при открытой вкладке,
            а Instagram и постоянный приёмник с сайта недоступны совсем.
          </span>
          <Button className="h-8 shrink-0 text-[12px]" onClick={() => setAuthStage("auth")}>Войти</Button>
        </div>
      )}
      <div className="mt-2 flex flex-col gap-1">
        {rows.map(id => {
          const w = WHERE[id];
          return (
            <div key={id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5">
              <span className={cn("grid size-4 shrink-0 place-items-center rounded-full text-[9px]", done[id] ? "" : "border border-dashed")}
                style={done[id] ? { background: "hsl(var(--brass) / 0.22)", color: "var(--brass-ink)" } : undefined}>
                {done[id] ? <Check className="size-2.5" /> : ""}
              </span>
              <span className="text-[12px] font-medium">{w.name}</span>
              <span className="hidden text-[10.5px] text-muted-foreground sm:inline">{done[id] ? "подключён" : w.hint}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <Go href={w.url} dim={done[id]}>{w.go}</Go>
                <button onClick={() => focusChannel(id)} title="Показать карточку канала ниже"
                  className="press inline-flex h-8 items-center rounded-md border px-2 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
                  {done[id] ? "проверить" : "вставить сюда"}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// когда в канале была последняя настоящая заявка/сообщение: из диалогов и из серверного журнала
function LastLead({ src }: { src: InboundSource }) {
  const s = useApp();
  const [srvTs, setSrvTs] = useState<number>(0);
  let chTs = 0;
  for (const c of s.chats) if (c.channel === src && c.ext) for (const m of c.msgs) if (!m.out && m.ts > chTs) chTs = m.ts;
  useEffect(() => {
    if (s.mode !== "cloud" || !s.wsId) return;
    let live = true;
    void supa.from("inbound").select("ts").eq("workspace_id", s.wsId).eq("source", src)
      .order("ts", { ascending: false }).limit(1)
      .then(({ data }) => { if (live && data?.[0]?.ts) setSrvTs(Number(data[0].ts)); });
    return () => { live = false; };
  }, [s.mode, s.wsId, src, s.chats.length]);
  const ts = Math.max(chTs, srvTs);
  return <span className="font-mono2 text-[10.5px] text-muted-foreground">{ts ? `последняя заявка: ${relTime(ts)}` : "заявок ещё не было"}</span>;
}

// «Проверить связь»: прогоняет диагностику канала и говорит, работает ли приём и почему нет
function CheckLine({ src }: { src: "tg" | "wa" | "max" }) {
  const [note, setNote] = useState<{ ok: boolean; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button variant="outline" className="h-8 gap-1.5 text-[12px]" disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await channelCheck(src);
          setBusy(false); setNote(r);
          if (r.ok) toast.success("Канал работает", { description: r.note });
          else toast.error("Канал не работает", { description: r.note });
        }}>
        <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Проверить связь
      </Button>
      <LastLead src={src} />
      {note && <span className={cn("basis-full text-[11px] leading-snug", note.ok ? "text-muted-foreground" : "text-destructive")}>{note.ok ? "✓ " : "✗ "}{note.note}</span>}
    </div>
  );
}

function Status({ st, okText = "подключено" }: { st: IntStatus; okText?: string }) {
  if (st === "off") return null;
  const map: Record<IntStatus, { t: string; cls: string }> = {
    off: { t: "", cls: "" },
    connecting: { t: "подключаю…", cls: "bg-muted text-muted-foreground" },
    ok: { t: okText, cls: "" },
    error: { t: "ошибка", cls: "bg-destructive/10 text-destructive" },
  };
  return (
    <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[9.5px] font-medium", map[st].cls)}
      style={st === "ok" ? { background: "hsl(var(--brass) / 0.2)", color: "var(--brass-ink)" } : undefined}>
      {map[st].t}
    </span>
  );
}

// Карточка ЛИЧНОГО Telegram-аккаунта: вход по номеру, как в приложении (MTProto из браузера)
function TgUserCard() {
  const s = useApp();
  const t = s.integrations.tgUser;
  const [apiId, setApiId] = useState(t.apiId);
  const [apiHash, setApiHash] = useState(t.apiHash);
  const [phone, setPhone] = useState(t.phone || "+7");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const busy = t.status === "connecting";
  const hasAppKeys = !!TG_APP.apiId; // ключи приложения вшиты — пользователю нужен только номер

  return (
    <div data-ch="tgu" className="mt-2.5 rounded-md border p-3" style={{ borderColor: "hsl(var(--brass) / 0.45)" }}>
      <div className="flex items-center gap-2 text-[12.5px] font-semibold">
        <User className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Telegram: личный аккаунт
        <span className="rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: "hsl(var(--brass) / 0.18)", color: "var(--brass-ink)" }}>рабочий номер</span>
        <Status st={t.status} okText={t.name ?? "подключено"} />
      </div>

      {t.status !== "ok" && !t.stage && (
        <>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            Ваш обычный Telegram — вход как в приложении: диалоги рабочего номера появятся во «Входящих», ответы уходят от вашего имени.
            {!hasAppKeys && <> Один раз возьмите <b>api_id</b> и <b>api_hash</b> — кнопка ниже открывает нужную страницу.</>}
          </p>
          {!hasAppKeys && <div className="mt-2"><Go href={WHERE.tgu.url}>{WHERE.tgu.go}</Go></div>}
          <p className="mt-1.5 rounded-md border border-dashed px-2.5 py-2 text-[11px] leading-snug" style={{ color: "var(--brass-ink)" }}>
            Сюда приедет <b>вся</b> личная переписка номера, включая ту, что к работе отношения не имеет.
            Она остаётся <b>на этом устройстве</b> и в общее пространство не уходит{s.mode === "cloud" ? "" : ""} — команда её не увидит.
            В CRM диалог попадает только кнопкой «Это клиент» в самом диалоге.
          </p>
          {t.error && <p className="mt-1 text-[11.5px] text-destructive">{t.error}</p>}
          {hasAppKeys ? (
            <div className="mt-2 flex gap-2">
              <Input className="h-9 w-44 text-[12.5px]" placeholder="+79161234567" value={phone} onChange={e => setPhone(e.target.value)} disabled={busy} />
              <Button className="h-9" disabled={busy || phone.trim().length < 10}
                onClick={() => tguStartLogin("", "", phone)}>{busy ? "Подключаю…" : "Получить код"}</Button>
            </div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-[96px_1fr_150px_auto]">
              <Input className="h-9 text-[12.5px]" placeholder="api_id" value={apiId} onChange={e => setApiId(e.target.value)} disabled={busy} />
              <Input className="h-9 text-[12.5px]" type="password" placeholder="api_hash" value={apiHash} onChange={e => setApiHash(e.target.value)} disabled={busy} />
              <Input className="h-9 text-[12.5px]" placeholder="+79161234567" value={phone} onChange={e => setPhone(e.target.value)} disabled={busy} />
              <Button className="h-9" disabled={busy || !apiId.trim() || !apiHash.trim() || phone.trim().length < 10}
                onClick={() => tguStartLogin(apiId, apiHash, phone)}>{busy ? "Подключаю…" : "Получить код"}</Button>
            </div>
          )}
          <p className="mt-1.5 text-[10.5px] text-muted-foreground">Сессия хранится только в этом браузере — подключайте на своём компьютере.</p>
        </>
      )}

      {t.stage === "code" && (
        <>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            Telegram прислал код входа на {t.phone} — в приложение Telegram (или по SMS).
          </p>
          {t.error && <p className="mt-1 text-[11.5px] text-destructive">{t.error}</p>}
          <div className="mt-2 flex gap-2">
            <Input className="h-9 w-36 text-center font-mono2 text-[14px] tracking-[0.3em]" placeholder="•••••" autoFocus
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={e => e.key === "Enter" && code.trim() && (tguSubmitCode(code), setCode(""))} />
            <Button className="h-9" disabled={!code.trim()} onClick={() => { tguSubmitCode(code); setCode(""); }}>Войти</Button>
            <Button variant="outline" className="h-9" onClick={() => { setCode(""); tguCancelLogin(); }}>Отмена</Button>
          </div>
        </>
      )}

      {t.stage === "password" && (
        <>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">У аккаунта включена двухэтапная проверка — введите облачный пароль.</p>
          {t.error && <p className="mt-1 text-[11.5px] text-destructive">{t.error}</p>}
          <div className="mt-2 flex gap-2">
            <Input className="h-9 w-56 text-[12.5px]" type="password" placeholder="облачный пароль" autoFocus
              value={pw} onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && pw && (tguSubmitPassword(pw), setPw(""))} />
            <Button className="h-9" disabled={!pw} onClick={() => { tguSubmitPassword(pw); setPw(""); }}>Войти</Button>
            <Button variant="outline" className="h-9" onClick={() => { setPw(""); tguCancelLogin(); }}>Отмена</Button>
          </div>
          <p className="mt-2 text-[10.5px] leading-snug text-muted-foreground">
            Не проходит? Это ограничение Telegram на вход с паролём из браузера. Обход за минуту: в Telegram → Настройки → Конфиденциальность → Облачный пароль — снимите его, войдите здесь по коду, затем включите обратно. Ваша сессия сохранится.
          </p>
        </>
      )}

      {t.status === "ok" && (
        <>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            Диалоги синхронизируются во «Входящие» (личные чаты, без ботов и групп). Сообщения, отправленные с телефона, тоже видны в CRM.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" className="h-9 gap-1.5" onClick={() => { tguResync(); toast("Обновляю диалоги…"); }}><RefreshCw className="size-3.5" /> Обновить диалоги</Button>
            <Button variant="outline" className="h-9" onClick={tguDisconnect}>Выйти из аккаунта</Button>
          </div>
        </>
      )}
    </div>
  );
}

// Личная переписка, уехавшая в облако до того, как появился запрет. Убрать её должен
// человек — своей рукой и с ясным пониманием, что именно исчезает.
function PrivateInCloud() {
  const s = useApp();
  const [w, setW] = useState<{ chats: number; acts: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s.mode === "cloud") void cloudPrivateWeight().then(setW); }, [s.mode, s.wsId]);
  if (s.mode !== "cloud" || !w || (!w.chats && !w.acts)) return null;
  return (
    <div className="mt-2.5 rounded-md border p-3" style={{ borderColor: "hsl(var(--destructive) / 0.4)" }}>
      <div className="text-[12.5px] font-semibold text-destructive">В облаке лежит личная переписка</div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
        {w.chats} {plural(w.chats, "диалог", "диалога", "диалогов")}
        {w.acts ? ` и ${w.acts} ${plural(w.acts, "событие", "события", "событий")} с цитатами сообщений` : ""} —
        это видит каждый, кого вы позовёте в пространство. Копия останется на вашем устройстве, из облака уберу совсем.
      </p>
      <div className="mt-2 flex items-center gap-2">
        {!armed ? (
          <Button variant="outline" size="sm" className="h-8 text-destructive" onClick={() => setArmed(true)}>Убрать из облака</Button>
        ) : (
          <>
            <span className="text-[11.5px] text-destructive">Удалить из общей базы?</span>
            <Button size="sm" className="h-7 text-[11.5px]" disabled={busy} onClick={async () => {
              setBusy(true);
              const r = await purgePrivateFromCloud();
              setBusy(false); setArmed(false);
              if (typeof r === "string") { toast.error("Не убрал: " + r); return; }
              toast.success(`Убрано из облака: ${r.chats} ${plural(r.chats, "диалог", "диалога", "диалогов")}`, { description: r.acts ? `и ${r.acts} событий с цитатами` : undefined });
              void cloudPrivateWeight().then(setW);
            }}>{busy ? "Убираю…" : "да, убрать"}</Button>
            <Button variant="outline" size="sm" className="h-7 text-[11.5px]" disabled={busy} onClick={() => setArmed(false)}>отмена</Button>
          </>
        )}
      </div>
    </div>
  );
}

// Общий переключатель «приём на сервере»: браузер перестаёт быть транспортом канала
function ServerIntake({ on, cloud, onChange }: { on: boolean; cloud: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("mt-2 flex items-center justify-between gap-3 rounded-md border border-dashed p-2.5", cloud ? "cursor-pointer" : "opacity-60")}>
      <span>
        <span className="block text-[12px] font-medium">Приём на сервере{on ? " — включён" : ""}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">
          {!cloud ? "Нужно общее пространство: войдите в аккаунт, тогда заявки будут приходить и при закрытом браузере"
            : on ? "Сообщения идут на сервер и становятся заявками, даже когда браузер закрыт. Токен канала при этом лежит в базе пространства — его видят участники"
            : "Сейчас канал читается из этой вкладки: закрыли браузер — сообщения ждут. При включении токен уедет в общую базу пространства"}
        </span>
      </span>
      <Switch checked={on} disabled={!cloud} onCheckedChange={onChange} />
    </label>
  );
}

// Кому писать о новой заявке: подписка через «/start» у своего же бота
function NotifyCard() {
  const s = useApp();
  const [list, setList] = useState<{ chat_id: string; name: string | null }[]>([]);
  const bot = s.integrations.tg.botName ?? "";
  const [secret, setSecret] = useState<string | null>(null);
  const [srvNew, setSrvNew] = useState<boolean | null>(null); // умеет ли развёрнутая функция секретную ссылку (v0.22+)
  const owner = s.users.find(u => u.id === s.currentUserId)?.role === "Владелец";
  const refresh = () => { void notifyTargets().then(setList); };
  // ссылка подписки содержит СЕКРЕТ пространства (не id) — создаёт/читает его только владелец.
  // Пока на сервере старая функция, ссылка строится по-старому — иначе подписка не сработает.
  useEffect(() => {
    if (s.mode !== "cloud") return;
    refresh();
    if (owner) void ensureNotifySecret().then(setSecret);
    void fetch(`${SUPA_URL}/functions/v1/hook`).then(r => r.json())
      .then(d => setSrvNew(Number(String(d?.version ?? "0").replace(/[^\d.]/g, "")) >= 0.22))
      .catch(() => setSrvNew(false));
  }, [s.mode, s.wsId, owner]);
  if (s.mode !== "cloud" || s.integrations.tg.status !== "ok" || !bot) return null;
  if (!owner) return null;
  const link = srvNew === false ? notifyLink(bot, (s.wsId ?? "").slice(0, 8)) : secret ? notifyLink(bot, secret) : "";
  return (
    <div data-ch="notify" className="mt-2 rounded-md border p-3">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold">
        <Bell className="size-3.5 text-muted-foreground" /> Уведомления о заявках
        <button onClick={refresh} className="press ml-auto text-[11px] font-normal text-muted-foreground hover:text-foreground">обновить</button>
      </div>
      <p className={cn("mt-1", SOFT)}>
        Сервер напишет вам в Telegram о каждой новой заявке — CRM для этого открывать не нужно.
        Откройте ссылку и нажмите «Start» у своего бота {bot}.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a href={link} target="_blank" rel="noreferrer"
          className="press inline-flex h-9 items-center rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:opacity-90">
          Подключить уведомления
        </a>
        <Button variant="outline" className="h-9 gap-1.5" disabled={!link} onClick={() => { navigator.clipboard?.writeText(link).then(() => toast("Ссылка скопирована — откройте её на телефоне")); }}>
          <Copy className="size-3.5" />
        </Button>
        <Button variant="outline" className="h-9 text-[12px]" title="Ссылка разошлась или ушёл сотрудник: старая ссылка перестанет подписывать, уже подписанных уберите ниже"
          onClick={async () => {
            if (!window.confirm("Перевыпустить ссылку уведомлений? Старая перестанет работать. Уже подписанных при необходимости уберите вручную в списке ниже.")) return;
            const sec = await rotateNotifySecret();
            if (sec) { setSecret(sec); toast.success("Ссылка уведомлений перевыпущена"); }
          }}>Перевыпустить ссылку</Button>
      </div>
      {list.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {list.map(t => (
            <div key={t.chat_id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px]">
              <span className="min-w-0 flex-1 truncate">{t.name || "получатель"}</span>
              <button onClick={() => { void notifyRemove(t.chat_id).then(refresh); }} className="press text-[11px] text-muted-foreground hover:text-destructive">убрать</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Instagram Direct: принимает СЕРВЕР — в браузере ни токенов, ни VPN не нужно.
// Уже сейчас приёмник ест POST JSON от любого пересыльщика; прямой вебхук Meta включается,
// когда развёрнутая функция hook умеет источник «ig» (проверяем её версию честно).
function IgCard() {
  const s = useApp();
  const ig = s.integrations.ig;
  const [rec, setRec] = useState<{ url: string; secret: string } | null>(null);
  const [srvIg, setSrvIg] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.mode !== "cloud" || !s.wsId) { setRec(null); return; }
    let live = true;
    void igReceiver().then(r => { if (live) setRec(r); });
    void fetch(`${SUPA_URL}/functions/v1/hook`).then(r => r.json())
      .then(d => { if (live) setSrvIg(Array.isArray(d?.sources) && d.sources.includes("ig")); })
      .catch(() => { /* сети нет — считаем, что рано */ });
    return () => { live = false; };
  }, [s.mode, s.wsId]);
  return (
    <div data-ch="ig" className="mt-2 rounded-md border p-3">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold">
        <InstaIcon className="size-3.5 text-muted-foreground" /> Instagram Direct
        <Status st={rec ? "ok" : ig.status === "ok" ? "connecting" : ig.status} okText="приёмник работает" />
        <RouteChip src="ig" />
      </div>
      {s.mode !== "cloud" ? (
        <>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            Instagram принимает сервер — сообщения становятся заявками даже при закрытом браузере и без VPN
            (сервер стоит в Европе). Нужно общее пространство: <button className={aCls} onClick={() => setAuthStage("auth")}>войдите в аккаунт</button>.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button className="h-8 text-[12px]" onClick={() => setAuthStage("auth")}>Войти в аккаунт</Button>
            <Go href={WHERE.ig.url} dim>{WHERE.ig.go}</Go>
          </div>
        </>
      ) : !rec ? (
        <>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            Создам постоянный адрес-приёмник: на него шлют сообщения Meta или сервис-пересыльщик,
            и они становятся заявками с источником Instagram. Без VPN на вашей стороне — принимает сервер.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button className="h-9" disabled={busy} onClick={async () => { setBusy(true); const r = await igEnsureReceiver(); setBusy(false); if (r) { setRec(r); toast.success("Приёмник Instagram создан", { description: "Адрес ниже — можно слать сообщения" }); } }}>
              Создать приёмник Instagram
            </Button>
            <Go href={WHERE.ig.url} dim>{WHERE.ig.go}</Go>
          </div>
        </>
      ) : (
        <>
          <code className="font-mono2 mt-2 block break-all rounded-md bg-muted px-2.5 py-2 text-[11px]">{rec.url}</code>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-8 gap-1.5 text-[12px]"
              onClick={() => navigator.clipboard?.writeText(rec.url).then(() => toast.success("Адрес скопирован"))}>
              <Copy className="size-3.5" /> Скопировать
            </Button>
            <Button variant="outline" className="h-8 text-[12px]" onClick={async () => {
              try {
                const r = await fetch(rec.url, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: "Проверка Instagram", text: "Тестовое сообщение из настроек CRM — можно удалить" }),
                });
                const d = await r.json().catch(() => null);
                if (r.ok && d?.ok) toast.success("Тест принят сервером", { description: "Заявка с источником Instagram сейчас появится в разделе" });
                else toast.error("Приёмник ответил ошибкой", { description: String(d?.error ?? "HTTP " + r.status).slice(0, 100) });
              } catch (e) { toast.error("Не достучался до приёмника", { description: String(e).slice(0, 80) }); }
            }}>Прислать тест</Button>
            <LastLead src="ig" />
          </div>
          <Steps items={[
            <>Приёмник уже принимает: любой сервис-пересыльщик или ваша интеграция шлёт сюда <b>POST JSON</b> вида {"{"}"name","phone","text"{"}"} — заявка появляется сама.</>,
            srvIg ? (
              <>Прямой приём от Meta — кнопка «{WHERE.ig.go}» ниже: создать приложение → продукт <b>Instagram</b> → Webhooks →
              Callback URL = адрес выше, Verify token = <code className="font-mono2 text-[10.5px]">{rec.secret}</code> → подписка на <b>messages</b>. Настройка Meta делается один раз (в РФ — через VPN); дальше приём идёт без VPN.</>
            ) : (
              <>Прямой приём от Meta (без пересыльщика) включится после ближайшего обновления серверной функции — код уже в проекте, шаги появятся здесь сами. Пока работает путь из шага 1.</>
            ),
            <>Ответы в Instagram пока пишите из самого приложения — в CRM приходит приём; отправку через Meta добавлю следом.</>,
          ]} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Go href={WHERE.ig.url}>{WHERE.ig.go}</Go>
            <Go href="https://developers.facebook.com/docs/messenger-platform/instagram/get-started" dim>Инструкция Meta</Go>
            <Button variant="outline" className="h-8 text-[12px]" onClick={async () => {
              if (!window.confirm("Выключить приёмник Instagram? Адрес перестанет принимать сообщения.")) return;
              if (await igDisableReceiver()) setRec(null);
            }}>Отключить</Button>
          </div>
        </>
      )}
    </div>
  );
}

export function IntegrationsLive() {
  const s = useApp();
  const ints = s.integrations;
  const [tgToken, setTgToken] = useState(ints.tg.token);
  const [waUrl, setWaUrl] = useState(ints.wa.apiUrl);
  const [waId, setWaId] = useState(ints.wa.idInstance);
  const [waToken, setWaToken] = useState(ints.wa.apiToken);
  const [maxToken, setMaxToken] = useState(ints.max.token);
  const [ownHook, setOwnHook] = useState("");
  // свой приёмник форм: URL функции с секретом пространства — заявки с сайта падают в CRM без браузера
  const makeOwnHook = async () => {
    const secret = await ensureHookSecret("tilda");
    const ws = s.wsId;
    if (!secret || !ws) return;
    const url = hookUrl(ws, "tilda", secret);
    setOwnHook(url);
    navigator.clipboard?.writeText(url).then(() => toast.success("URL приёмника скопирован", { description: "Вставьте в Тильде: Формы → Webhook" }));
  };
  // Адрес приёмника жил только в состоянии этого экрана: ушёл в другой раздел — и он пропал,
  // хотя на сервере всё настроено. Человек оставался без адреса, который уже вставил на сайт,
  // и не мог проверить, тот ли он. Поэтому при открытии настроек читаем уже созданный.
  useEffect(() => {
    if (s.mode !== "cloud" || !s.wsId || ownHook) return;
    let живо = true;
    void getHookSecret("tilda").then(secret => {
      if (живо && secret && s.wsId) setOwnHook(hookUrl(s.wsId, "tilda", secret));
    });
    return () => { живо = false; };
  }, [s.mode, s.wsId, ownHook]);

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Plug className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Интеграции: реальные каналы
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Подключите канал по шагам — новые сообщения сами станут заявками. В каждой карточке есть кнопка,
        которая открывает нужную страницу сервиса, «Проверить связь» (работает или нет — и почему) и метка «→ куда падают заявки». Токены хранятся в этом браузере;
        при «Приёме на сервере» токен бота уезжает в общую базу пространства — его увидят участники, зато заявки
        приходят даже при закрытом браузере.
      </p>

      <SetupList />

      <TgUserCard />
      <PrivateInCloud />

      <div data-ch="tg" className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <Send className="size-3.5 text-muted-foreground" /> Telegram-бот <Status st={ints.tg.status} okText={ints.tg.botName ?? "подключено"} />
          <RouteChip src="tg" />
        </div>
        <div className="mt-2"><Go href={WHERE.tg.url} dim={ints.tg.status === "ok"}>{WHERE.tg.go}</Go></div>
        {ints.tg.status !== "ok" ? (
          <Steps items={[
            <>Нажмите кнопку выше — откроется <b>@BotFather</b> в Telegram. Отправьте ему команду <b>/newbot</b>.</>,
            <>Назовите бота (например, «Заявки {"{вашей компании}"}») — BotFather пришлёт <b>токен</b>.</>,
            <>Вставьте токен сюда и нажмите «Подключить». Клиенты пишут боту — вы отвечаете из CRM.</>,
          ]} />
        ) : (
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Клиенты пишут боту — диалог падает во «Входящие» и по маршруту становится заявкой.</p>
        )}
        {ints.tg.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.tg.error}</p>}
        <div className="mt-2 flex gap-2">
          <Input className="h-9 flex-1 text-[12.5px]" type="password" placeholder="123456789:AA…" value={tgToken} onChange={e => setTgToken(e.target.value)} />
          <Button className="h-9" disabled={!tgToken.trim() || ints.tg.status === "connecting"} onClick={() => tgConnect(tgToken)}>Подключить</Button>
        </div>
        {ints.tg.status === "ok" && (
          <ServerIntake on={ints.tg.mode === "hook"} cloud={s.mode === "cloud"} onChange={v => { if (v) void tgUseServer(ints.tg.token); else void tgUsePolling(ints.tg.token); }} />
        )}
        {ints.tg.status === "ok" && <CheckLine src="tg" />}
        {ints.tg.status === "ok" && (
          <Button variant="outline" className="mt-2 h-8 text-[12px]"
            onClick={() => { if (ints.tg.mode === "hook") void tgUsePolling(ints.tg.token); A.intPatch(i => { i.tg = { token: "", status: "off" }; }); setTgToken(""); }}>
            Отключить бота
          </Button>
        )}
      </div>

      <div data-ch="wa" className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <MessageCircle className="size-3.5 text-muted-foreground" /> WhatsApp <span className="text-[10.5px] font-normal text-muted-foreground">Green API</span> <Status st={ints.wa.status} />
          <RouteChip src="wa" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Go href={WHERE.wa.url} dim={ints.wa.status === "ok"}>{WHERE.wa.go}</Go>
          <Go href="https://green-api.com/docs/before-start/" dim>Инструкция Green API</Go>
        </div>
        {ints.wa.status !== "ok" ? (
          <Steps items={[
            <>Кнопка выше открывает кабинет Green API — зарегистрируйтесь и создайте <b>инстанс</b> (бесплатного тарифа для одного номера хватает).</>,
            <>В кабинете инстанса отсканируйте QR рабочим WhatsApp — так же, как входите в WhatsApp Web.</>,
            <>Скопируйте оттуда <b>idInstance</b> и <b>apiTokenInstance</b> в поля ниже → «Подключить». API URL менять не нужно, если кабинет не показывает свой.</>,
          ]} />
        ) : (
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Ваш WhatsApp на рабочем номере: входящие падают во «Входящие», ответы уходят от вашего имени.</p>
        )}
        {ints.wa.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.wa.error}</p>}
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_110px_1fr_auto]">
          <Input className="h-9 text-[12.5px]" placeholder="API URL" value={waUrl} onChange={e => setWaUrl(e.target.value)} />
          <Input className="h-9 text-[12.5px]" placeholder="idInstance" value={waId} onChange={e => setWaId(e.target.value)} />
          <Input className="h-9 text-[12.5px]" type="password" placeholder="apiTokenInstance" value={waToken} onChange={e => setWaToken(e.target.value)} />
          <Button className="h-9" disabled={!waId.trim() || !waToken.trim() || ints.wa.status === "connecting"} onClick={() => waConnect(waUrl, waId, waToken)}>Подключить</Button>
        </div>
        {ints.wa.status === "ok" && (
          <ServerIntake on={ints.wa.mode === "hook"} cloud={s.mode === "cloud"} onChange={v => { if (v) void waUseServer(); else void waUsePolling(); }} />
        )}
        {ints.wa.status === "ok" && <CheckLine src="wa" />}
        {ints.wa.status === "ok" && (
          <Button variant="outline" className="mt-2 h-8 text-[12px]"
            onClick={() => { if (ints.wa.mode === "hook") void waUsePolling(); A.intPatch(i => { i.wa = { apiUrl: "https://api.green-api.com", idInstance: "", apiToken: "", status: "off" }; }); setWaId(""); setWaToken(""); }}>
            Отключить
          </Button>
        )}
      </div>

      <div data-ch="max" className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <MessageSquare className="size-3.5 text-muted-foreground" /> MAX <span className="text-[10.5px] font-normal text-muted-foreground">Bot API</span> <Status st={ints.max.status} okText={ints.max.botName ?? "подключено"} />
          <RouteChip src="max" />
        </div>
        <div className="mt-2"><Go href={WHERE.max.url} dim={ints.max.status === "ok"}>{WHERE.max.go}</Go></div>
        {ints.max.status !== "ok" ? (
          <Steps items={[
            <>Кнопка выше открывает <b>@MasterBot</b> — официальный мастер создания ботов MAX (в приложении или в вебе).</>,
            <>Отправьте ему <b>/create</b>, придумайте имя и адрес бота (заканчивается на <b>bot</b>) — MasterBot выдаст <b>токен</b>.</>,
            <>Вставьте токен сюда → «Подключить». Личные аккаунты MAX пока не открывает через API — как откроет, добавлю вход по номеру.</>,
          ]} />
        ) : (
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Клиенты пишут боту MAX — входящие падают во «Входящие» и становятся заявками.</p>
        )}
        {ints.max.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.max.error}</p>}
        <div className="mt-2 flex gap-2">
          <Input className="h-9 flex-1 text-[12.5px]" type="password" placeholder="токен бота MAX" value={maxToken} onChange={e => setMaxToken(e.target.value)} />
          <Button className="h-9" disabled={!maxToken.trim() || ints.max.status === "connecting"} onClick={() => maxConnect(maxToken)}>Подключить</Button>
          {ints.max.status === "ok" && <Button variant="outline" className="h-9" onClick={() => { if (ints.max.mode === "hook") void maxUsePolling(ints.max.token); A.intPatch(i => { i.max = { token: "", status: "off" }; }); setMaxToken(""); }}>Откл.</Button>}
        </div>
        {ints.max.status === "ok" && (
          <ServerIntake on={ints.max.mode === "hook"} cloud={s.mode === "cloud"} onChange={v => { if (v) void maxUseServer(ints.max.token); else void maxUsePolling(ints.max.token); }} />
        )}
        {ints.max.status === "ok" && <CheckLine src="max" />}
      </div>

      <IgCard />

      <NotifyCard />

      <div data-ch="site" className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          Сайт: заявки с формы <span className="text-[10.5px] font-normal text-muted-foreground">Tilda и любая другая</span>
          <Status st={ownHook ? "ok" : ints.tilda.status} okText={ownHook ? "приёмник работает" : "мост активен"} />
          <RouteChip src="tilda" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Go href={WHERE.site.url} dim={!ownHook}>Открыть Тильду · Мои сайты</Go>
          <Go href="https://help-ru.tilda.cc/forms/webhook" dim>Инструкция Тильды по Webhook</Go>
        </div>

        {/* Основной путь — постоянный серверный приёмник: работает всегда, браузер не нужен */}
        {s.mode === "cloud" && !ownHook && (
          <>
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
              Создам постоянный адрес-приёмник: форма на сайте шлёт на него заявки, и они сами становятся записями — даже когда CRM закрыта.
            </p>
            <Button className="mt-2 h-9" onClick={() => void makeOwnHook()}>Создать адрес приёмника</Button>
          </>
        )}
        {!!ownHook && (
          <>
            <code className="font-mono2 mt-2 block break-all rounded-md bg-muted px-2.5 py-2 text-[11px]">{ownHook}</code>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="outline" className="h-8 gap-1.5 text-[12px]"
                onClick={() => navigator.clipboard?.writeText(ownHook).then(() => toast.success("Адрес скопирован"))}>
                <Copy className="size-3.5" /> Скопировать
              </Button>
              <Button variant="outline" className="h-8 text-[12px]" onClick={async () => {
                try {
                  const r = await fetch(ownHook, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "Проверка приёмника", phone: "+7 000 000-00-00", comment: "Тестовая заявка из настроек CRM — можно удалить" }),
                  });
                  const d = await r.json().catch(() => null);
                  if (r.ok && d?.ok) toast.success("Тестовая заявка отправлена и принята", { description: "Сейчас появится в разделе — по маршруту «Сайт (форма Tilda)»" });
                  else toast.error("Приёмник ответил ошибкой", { description: String(d?.error ?? "HTTP " + r.status).slice(0, 100) });
                } catch (e) { toast.error("Не достучался до приёмника", { description: String(e).slice(0, 80) }); }
              }}>Прислать тестовую заявку</Button>
              <Button variant="outline" className="h-8 text-[12px]" onClick={async () => {
                if (!window.confirm("Перевыпустить секрет? Старый адрес перестанет работать, и его нужно будет заменить в форме на сайте.")) return;
                const secret = await rotateHookSecret("tilda");
                if (secret && s.wsId) setOwnHook(hookUrl(s.wsId, "tilda", secret));
              }}>Перевыпустить секрет</Button>
              <LastLead src="tilda" />
            </div>
            <Steps items={[
              <>Кнопка «Открыть Тильду» выше → ваш сайт → <b>Настройки сайта → Формы → Webhook</b> → вставьте адрес выше → «Добавить». Потом переопубликуйте сайт.</>,
              <>В блоке с формой отметьте новый приёмник Webhook в «Приёме данных».</>,
              <>Нажмите «Прислать тестовую заявку» и убедитесь, что запись появилась в разделе.</>,
            ]} />
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Не Тильда? Любой сайт может слать POST (JSON или form-data) на этот адрес — поля name/phone/comment разложатся сами.
              Если адрес утёк (репозиторий, переписка, скриншот) — перевыпустите секрет: по нему можно слать заявки в вашу CRM.
            </p>
          </>
        )}

        {/* Запасной путь ТОЛЬКО без аккаунта: временный мост, честно помеченный как небезопасный.
            В облаке есть настоящий приёмник — чужой публичный сервис там ни к чему. */}
        {!ownHook && s.mode !== "cloud" && (
          <>
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
              Постоянный приём с сайта работает через сервер — <button className={aCls} onClick={() => setAuthStage("auth")}>войдите в общее пространство</button>.
              Пока без входа есть только временный мост для проверки формы.
            </p>
            {ints.tilda.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.tilda.error}</p>}
            {ints.tilda.status !== "ok" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" className="h-9" disabled={ints.tilda.status === "connecting"} onClick={tildaCreateHook}>
                  Временный мост (только для проверки)
                </Button>
                <p className="basis-full text-[11px] leading-snug text-destructive">
                  Временный мост складывает заявки на <b>чужой публичный сервис</b> webhook.site: имя, телефон и текст
                  каждой заявки может прочитать любой, кто знает адрес, и они остаются там навсегда. Он годится
                  проверить, что форма настроена — боевые заявки через него пускать нельзя.
                </p>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <code className="font-mono2 flex-1 truncate rounded-md bg-muted px-2.5 py-2 text-[11.5px]">{tildaHookUrl()}</code>
                <Button variant="outline" className="h-9 gap-1.5" onClick={() => { navigator.clipboard?.writeText(tildaHookUrl()).then(() => toast("URL скопирован")); }}><Copy className="size-3.5" /></Button>
                <Button variant="outline" className="h-9" onClick={() => A.intPatch(i => { i.tilda = { hookId: "", status: "off", seen: [] }; })}>Откл.</Button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-2.5 rounded-md border border-dashed px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
        Что происходит с входящими — ниже, в блоке «Куда падают заявки»: раздел, стадия и ответственный настраиваются отдельно для каждого канала.
      </p>

      <BackupCard />
    </div>
  );
}

// Копия базы одним файлом. В режиме «только это устройство» вся CRM живёт в браузере:
// почищенный кэш, обновление системы, случайное «удалить данные сайта» — и её нет.
function BackupCard() {
  const s = useApp();
  const st = storageState();
  const pct = Math.min(100, Math.round((st.bytes / 4_300_000) * 100));
  const dump = () => {
    // Ключи каналов, токен бота и сессия личного Telegram в файл НЕ попадают: копию базы
    // пересылают и кладут в облака, а это доступ к переписке с клиентами.
    let text = window.localStorage.getItem("xxlcrm-site-v1") ?? "{}";
    try {
      const d = JSON.parse(text) as Record<string, unknown>;
      delete d.integrations;
      text = JSON.stringify(d);
    } catch { /* не разобрали — отдаём как есть */ }
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `xxlcrm-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
    toast.success("Копия базы сохранена");
  };
  const restore = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      if (!window.confirm("Заменить текущую базу содержимым копии? Текущие данные будут потеряны.")) return;
      try {
        const text = await file.text();
        const d = JSON.parse(text) as { records?: unknown; entities?: unknown };
        if (!Array.isArray(d.records) || !Array.isArray(d.entities)) throw new Error("это не копия базы XXLcrm");
        window.localStorage.setItem("xxlcrm-site-v1", text);
        location.reload();
      } catch (e) { toast.error("Не смог прочитать копию", { description: String(e).slice(0, 120) }); }
    };
    inp.click();
  };
  if (s.mode === "cloud") return null;
  return (
    <div className="mt-2 rounded-md border p-3">
      <div className="text-[12.5px] font-semibold">Копия базы</div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
        Пока вы работаете «только на этом устройстве», вся база лежит в браузере. Скачайте копию перед чисткой кэша,
        переустановкой системы или большим импортом — файл потом загружается обратно сюда же.
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        В файле — записи, задачи и переписка. Ключи каналов и вход в личный Telegram в копию не кладу:
        такой файл часто пересылают, а это был бы доступ к вашим клиентам. После загрузки копии каналы подключаются заново.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button className="h-9 gap-1.5" onClick={dump}>Скачать копию</Button>
        <Button variant="outline" className="h-9" onClick={restore}>Загрузить копию</Button>
        {st.bytes > 0 && (
          <span className="font-mono2 text-[11px] text-muted-foreground">
            занято {Math.round(st.bytes / 1e4) / 100} МБ из ~4,3 МБ{pct >= 70 ? ` · ${pct}%, пора в облако` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export function TemplatesLive() {
  const s = useApp();
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  const startEdit = (id: string) => {
    const t = s.replyTemplates.find(x => x.id === id)!;
    setEditId(id); setName(t.name); setText(t.text); setAdding(false);
  };
  const save = () => {
    if (!name.trim() || !text.trim()) return;
    if (editId) A.tplUpdate(editId, { name: name.trim(), text: text.trim() });
    else A.tplAdd(name.trim(), text.trim());
    setEditId(null); setAdding(false); setName(""); setText("");
  };

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <MessageSquare className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Шаблоны ответов
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Переменные подставляются из связанной сделки: <code className="font-mono2 text-[11px]">{"{имя} {клиент} {сумма} {стадия} {трек} {менеджер}"}</code>
      </p>
      <div className="mt-2.5 flex flex-col gap-2">
        {s.replyTemplates.map(t => (
          <div key={t.id} className="flex items-start gap-3 rounded-md border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium">{t.name}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{t.text}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button aria-label={`Изменить шаблон «${t.name}»`} title="Изменить" className="press grid h-7 w-7 place-items-center rounded-md border text-muted-foreground hover:text-foreground" onClick={() => startEdit(t.id)}><Pencil className="size-3" /></button>
              <button aria-label={`Удалить шаблон «${t.name}»`} title="Удалить" className="press grid h-7 w-7 place-items-center rounded-md border text-muted-foreground hover:text-destructive" onClick={() => A.tplDelete(t.id)}><Trash2 className="size-3" /></button>
            </div>
          </div>
        ))}

        {(adding || editId) ? (
          <div className="rounded-md border border-dashed p-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium">{editId ? "Редактирование шаблона" : "Новый шаблон"}</span>
              <button aria-label="Закрыть редактор шаблона" onClick={() => { setEditId(null); setAdding(false); }}><X className="size-3.5 text-muted-foreground" /></button>
            </div>
            <Input className="mt-2 h-9 text-[12.5px]" placeholder="Название" value={name} onChange={e => setName(e.target.value)} />
            <Textarea className="mt-2 text-[12.5px]" rows={3} placeholder="Текст с {переменными}…" value={text} onChange={e => setText(e.target.value)} />
            <Button className="mt-2 h-9" onClick={save} disabled={!name.trim() || !text.trim()}>Сохранить</Button>
          </div>
        ) : (
          <button onClick={() => { setAdding(true); setName(""); setText(""); }}
            className="press flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-[12.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground">
            <Plus className="size-3.5" /> Новый шаблон
          </button>
        )}
      </div>
    </div>
  );
}

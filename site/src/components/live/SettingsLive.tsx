// Живые секции настроек: интеграции каналов и шаблоны ответов
import { useEffect, useState } from "react";
import { plural, type IntStatus } from "@/lib/model";
import { useApp, A, storageState } from "@/lib/store";
import { tgConnect, waConnect, maxConnect, tildaCreateHook, tildaHookUrl } from "@/lib/integrations";
import { tgUseServer, tgUsePolling, waUseServer, waUsePolling, maxUseServer, maxUsePolling, ensureHookSecret, rotateHookSecret, hookUrl, notifyLink, notifyTargets, notifyRemove } from "@/lib/inbound";
import { Switch } from "@/components/ui/switch";
import { tguStartLogin, tguSubmitCode, tguSubmitPassword, tguCancelLogin, tguDisconnect, tguResync, TG_APP } from "@/lib/tg-user-lazy";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cloudPrivateWeight, purgePrivateFromCloud } from "@/lib/cloud";

import { Bell, Copy, MessageCircle, MessageSquare, Pencil, Plug, Plus, RefreshCw, Send, Trash2, User, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SOFT = "text-[11.5px] leading-snug text-muted-foreground";

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
    <div className="mt-2.5 rounded-md border p-3" style={{ borderColor: "hsl(var(--brass) / 0.45)" }}>
      <div className="flex items-center gap-2 text-[12.5px] font-semibold">
        <User className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Telegram: личный аккаунт
        <span className="rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: "hsl(var(--brass) / 0.18)", color: "var(--brass-ink)" }}>рабочий номер</span>
        <Status st={t.status} okText={t.name ?? "подключено"} />
      </div>

      {t.status !== "ok" && !t.stage && (
        <>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            Ваш обычный Telegram — вход как в приложении: диалоги рабочего номера появятся во «Входящих», ответы уходят от вашего имени.
            {!hasAppKeys && <> Один раз возьмите <b>api_id</b> и <b>api_hash</b>: my.telegram.org → API development tools.</>}
          </p>
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
  const refresh = () => { void notifyTargets().then(setList); };
  useEffect(() => { if (s.mode === "cloud") refresh(); }, [s.mode, s.wsId]);
  if (s.mode !== "cloud" || s.integrations.tg.status !== "ok" || !bot) return null;
  const link = notifyLink(bot, s.wsId ?? "");
  return (
    <div className="mt-2 rounded-md border p-3">
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
        <Button variant="outline" className="h-9 gap-1.5" onClick={() => { navigator.clipboard?.writeText(link).then(() => toast("Ссылка скопирована — откройте её на телефоне")); }}>
          <Copy className="size-3.5" />
        </Button>
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

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Plug className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Интеграции: реальные каналы
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Работают прямо из браузера, токены и сессии хранятся на этом компьютере. Личные аккаунты подключаются по рабочему номеру: Telegram — входом как в приложении, WhatsApp — по QR.
        {" "}<b className="font-medium text-foreground">Исключение:</b> если включить «Приём на сервере», токен бота уезжает в общую базу пространства —
        иначе сервер не сможет принимать сообщения при закрытом браузере. Значит, его увидят и другие участники: пускайте в пространство только своих.
      </p>

      <TgUserCard />
      <PrivateInCloud />

      <div className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <Send className="size-3.5 text-muted-foreground" /> Telegram-бот <Status st={ints.tg.status} okText={ints.tg.botName ?? "подключено"} />
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">@BotFather → /newbot → вставьте токен. Клиенты пишут боту — вы отвечаете отсюда.</p>
        {ints.tg.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.tg.error}</p>}
        <div className="mt-2 flex gap-2">
          <Input className="h-9 flex-1 text-[12.5px]" type="password" placeholder="123456789:AA…" value={tgToken} onChange={e => setTgToken(e.target.value)} />
          <Button className="h-9" disabled={!tgToken.trim() || ints.tg.status === "connecting"} onClick={() => tgConnect(tgToken)}>Подключить</Button>
        </div>
        {ints.tg.status === "ok" && (
          <ServerIntake on={ints.tg.mode === "hook"} cloud={s.mode === "cloud"} onChange={v => { if (v) void tgUseServer(ints.tg.token); else void tgUsePolling(ints.tg.token); }} />
        )}
        {ints.tg.status === "ok" && (
          <Button variant="outline" className="mt-2 h-8 text-[12px]"
            onClick={() => { if (ints.tg.mode === "hook") void tgUsePolling(ints.tg.token); A.intPatch(i => { i.tg = { token: "", status: "off" }; }); setTgToken(""); }}>
            Отключить бота
          </Button>
        )}
      </div>

      <div className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <MessageCircle className="size-3.5 text-muted-foreground" /> WhatsApp <span className="text-[10.5px] font-normal text-muted-foreground">Green API</span> <Status st={ints.wa.status} />
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Ваш личный WhatsApp на рабочем номере: green-api.com → инстанс → QR своим WhatsApp (как WhatsApp Web) → idInstance и ApiToken сюда.</p>
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
      </div>

      <div className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <MessageSquare className="size-3.5 text-muted-foreground" /> MAX <span className="text-[10.5px] font-normal text-muted-foreground">Bot API</span> <Status st={ints.max.status} okText={ints.max.botName ?? "подключено"} />
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Бот создаётся у мастера ботов MAX (@MasterBot в MAX) → токен сюда. Личные аккаунты MAX пока не открывает через API — как только откроет, добавлю вход по номеру.</p>
        {ints.max.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.max.error}</p>}
        <div className="mt-2 flex gap-2">
          <Input className="h-9 flex-1 text-[12.5px]" type="password" placeholder="токен бота MAX" value={maxToken} onChange={e => setMaxToken(e.target.value)} />
          <Button className="h-9" disabled={!maxToken.trim() || ints.max.status === "connecting"} onClick={() => maxConnect(maxToken)}>Подключить</Button>
          {ints.max.status === "ok" && <Button variant="outline" className="h-9" onClick={() => { if (ints.max.mode === "hook") void maxUsePolling(ints.max.token); A.intPatch(i => { i.max = { token: "", status: "off" }; }); setMaxToken(""); }}>Откл.</Button>}
        </div>
        {ints.max.status === "ok" && (
          <ServerIntake on={ints.max.mode === "hook"} cloud={s.mode === "cloud"} onChange={v => { if (v) void maxUseServer(ints.max.token); else void maxUsePolling(ints.max.token); }} />
        )}
      </div>

      <NotifyCard />

      {!!ownHook && (
        <div className="mt-2 rounded-md border p-3">
          <div className="text-[12.5px] font-semibold">Ваш серверный приёмник заявок</div>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Вставьте в Тильде: Настройки сайта → Формы → Webhook. Работает всегда, браузер не нужен.</p>
          <code className="font-mono2 mt-2 block break-all rounded-md bg-muted px-2.5 py-2 text-[11px]">{ownHook}</code>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-8 text-[12px]" onClick={async () => {
              if (!window.confirm("Перевыпустить секрет? Старый адрес перестанет работать, и его нужно будет заменить в форме на сайте.")) return;
              const secret = await rotateHookSecret("tilda");
              if (secret && s.wsId) setOwnHook(hookUrl(s.wsId, "tilda", secret));
            }}>Перевыпустить секрет</Button>
            <span className="text-[11px] leading-snug text-muted-foreground">
              Если адрес куда-то утёк (репозиторий, переписка, скриншот) — перевыпустите: в нём лежит ключ, по которому можно слать заявки в вашу CRM.
            </span>
          </div>
        </div>
      )}

      <div className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">Tilda: заявки с сайта <Status st={ints.tilda.status} okText="мост активен" /></div>
        {ints.tilda.status !== "ok" ? (
          <>
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
              Создам URL-приёмник. Вставьте его в Тильде: Настройки сайта → Формы → Webhook — заявки сами станут сделками.
            </p>
            {ints.tilda.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.tilda.error}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {s.mode === "cloud" && <Button className="h-9" onClick={() => void makeOwnHook()}>Создать свой URL (сервер)</Button>}
              <Button variant={s.mode === "cloud" ? "outline" : "default"} className="h-9" disabled={ints.tilda.status === "connecting"} onClick={tildaCreateHook}>
                Временный мост (только для проверки)
              </Button>
              <p className="basis-full text-[11px] leading-snug text-destructive">
                Временный мост складывает заявки на <b>чужой публичный сервис</b> webhook.site: имя, телефон и текст
                каждой заявки может прочитать любой, кто знает адрес, и они остаются там навсегда. Он годится
                проверить, что форма настроена — боевые заявки через него пускать нельзя.
              </p>
            </div>
          </>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <code className="font-mono2 flex-1 truncate rounded-md bg-muted px-2.5 py-2 text-[11.5px]">{tildaHookUrl()}</code>
            <Button variant="outline" className="h-9 gap-1.5" onClick={() => { navigator.clipboard?.writeText(tildaHookUrl()).then(() => toast("URL скопирован")); }}><Copy className="size-3.5" /></Button>
            <Button variant="outline" className="h-9" onClick={() => A.intPatch(i => { i.tilda = { hookId: "", status: "off", seen: [] }; })}>Откл.</Button>
          </div>
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

// Живые секции настроек: интеграции каналов и шаблоны ответов
import { useState } from "react";
import type { IntStatus } from "@/lib/model";
import { useApp, A } from "@/lib/store";
import { tgConnect, waConnect, maxConnect, tildaCreateHook, tildaHookUrl } from "@/lib/integrations";
import { tguStartLogin, tguSubmitCode, tguSubmitPassword, tguCancelLogin, tguDisconnect, tguResync, TG_APP } from "@/lib/tg-user";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Copy, MessageCircle, MessageSquare, Pencil, Plug, Plus, RefreshCw, Send, Trash2, User, X } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function IntegrationsLive() {
  const s = useApp();
  const ints = s.integrations;
  const [tgToken, setTgToken] = useState(ints.tg.token);
  const [waUrl, setWaUrl] = useState(ints.wa.apiUrl);
  const [waId, setWaId] = useState(ints.wa.idInstance);
  const [waToken, setWaToken] = useState(ints.wa.apiToken);
  const [maxToken, setMaxToken] = useState(ints.max.token);

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Plug className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Интеграции: реальные каналы
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Работают прямо из браузера, токены и сессии хранятся только на этом компьютере. Личные аккаунты подключаются по рабочему номеру: Telegram — входом как в приложении, WhatsApp — по QR.
      </p>

      <TgUserCard />

      <div className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <Send className="size-3.5 text-muted-foreground" /> Telegram-бот <Status st={ints.tg.status} okText={ints.tg.botName ?? "подключено"} />
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">@BotFather → /newbot → вставьте токен. Клиенты пишут боту — вы отвечаете отсюда.</p>
        {ints.tg.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.tg.error}</p>}
        <div className="mt-2 flex gap-2">
          <Input className="h-9 flex-1 text-[12.5px]" type="password" placeholder="123456789:AA…" value={tgToken} onChange={e => setTgToken(e.target.value)} />
          <Button className="h-9" disabled={!tgToken.trim() || ints.tg.status === "connecting"} onClick={() => tgConnect(tgToken)}>Подключить</Button>
          {ints.tg.status === "ok" && <Button variant="outline" className="h-9" onClick={() => { A.intPatch(i => { i.tg = { token: "", status: "off" }; }); setTgToken(""); }}>Откл.</Button>}
        </div>
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
          {ints.max.status === "ok" && <Button variant="outline" className="h-9" onClick={() => { A.intPatch(i => { i.max = { token: "", status: "off" }; }); setMaxToken(""); }}>Откл.</Button>}
        </div>
      </div>

      <div className="mt-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">Tilda: заявки с сайта <Status st={ints.tilda.status} okText="мост активен" /></div>
        {ints.tilda.status !== "ok" ? (
          <>
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
              Создам URL-приёмник (мост для теста; свой приёмник будет на шаге Supabase). Вставьте его в Тильде: Настройки сайта → Формы → Webhook — заявки сами станут сделками.
            </p>
            {ints.tilda.error && <p className="mt-1 text-[11.5px] text-destructive">{ints.tilda.error}</p>}
            <Button className="mt-2 h-9" disabled={ints.tilda.status === "connecting"} onClick={tildaCreateHook}>Создать URL для Tilda</Button>
          </>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <code className="font-mono2 flex-1 truncate rounded-md bg-muted px-2.5 py-2 text-[11.5px]">{tildaHookUrl()}</code>
            <Button variant="outline" className="h-9 gap-1.5" onClick={() => { navigator.clipboard?.writeText(tildaHookUrl()).then(() => toast("URL скопирован")); }}><Copy className="size-3.5" /></Button>
            <Button variant="outline" className="h-9" onClick={() => A.intPatch(i => { i.tilda = { hookId: "", status: "off", seen: [] }; })}>Откл.</Button>
          </div>
        )}
      </div>

      <label className="mt-2.5 flex cursor-pointer items-center justify-between rounded-md border p-3">
        <span>
          <span className="block text-[12.5px] font-medium">Автолид из новых диалогов</span>
          <span className="block text-[11px] text-muted-foreground">Новый собеседник сразу создаёт сделку в воронке</span>
        </span>
        <Switch checked={ints.autoLead} onCheckedChange={v => A.setAutoLead(v)} />
      </label>
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
        Переменные подставляются из связанной сделки: <code className="font-mono2 text-[11px]">{"{имя} {клиент} {сумма} {стадия} {трек} {менеджер} {компания}"}</code>
      </p>
      <div className="mt-2.5 flex flex-col gap-2">
        {s.replyTemplates.map(t => (
          <div key={t.id} className="flex items-start gap-3 rounded-md border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium">{t.name}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{t.text}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button className="press grid h-7 w-7 place-items-center rounded-md border text-muted-foreground hover:text-foreground" onClick={() => startEdit(t.id)}><Pencil className="size-3" /></button>
              <button className="press grid h-7 w-7 place-items-center rounded-md border text-muted-foreground hover:text-destructive" onClick={() => A.tplDelete(t.id)}><Trash2 className="size-3" /></button>
            </div>
          </div>
        ))}

        {(adding || editId) ? (
          <div className="rounded-md border border-dashed p-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium">{editId ? "Редактирование шаблона" : "Новый шаблон"}</span>
              <button onClick={() => { setEditId(null); setAdding(false); }}><X className="size-3.5 text-muted-foreground" /></button>
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

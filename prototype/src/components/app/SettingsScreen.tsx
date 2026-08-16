// Настройки: пространство, тема, интеграции, AI, команда, честная справка, сброс
import { useState } from "react";
import { A, useApp } from "@/lib/store";
import { tgConnect, waConnect, tildaCreateHook, tildaHookUrl } from "@/lib/integrations";
import type { IntStatus } from "@/lib/model";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserChip } from "./bits";
import { toast } from "sonner";
import { Check, Copy, Globe, MessageCircle, Moon, Plug, RotateCcw, Send, Sparkles, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const REAL = [
  "Конструктор: разделы, 18 типов полей (включая рол-апы), связи, стадии, WIP",
  "Представления: таблица (группировка, массовые действия), канбан (DnD), календарь (месяц/неделя), карточки",
  "Фильтры-конструктор, импорт CSV с дедупом, веб-форма → заявка, счёт в PDF",
  "Задачи, хронология, «Мой день», поиск, Ctrl+Z, автосохранение в браузере",
  "Автоматизации-движок, дашборд с живыми виджетами",
  "AI по вашему API-ключу: резюме, черновики ответов, «спроси CRM»",
];
const DEMO = [
  "Инбокс мессенджеров — имитация (реальные Telegram/WhatsApp/MAX — этап V2)",
  "Телефония и email-синхронизация — этап V2–V3 плана",
  "Права ролей показаны, но не ограничивают (V2)",
  "Совместная работа требует бэкенда — данные живут в этом браузере",
];

export function SettingsScreen() {
  const s = useApp();
  const ws = s.ws!;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-6">
        <h1 className="text-[22px] font-semibold tracking-tight">Настройки</h1>

        <section className="mt-5 rounded-xl border bg-card p-4">
          <div className="text-sm font-semibold">Пространство</div>
          <label className="mt-3 block text-xs font-medium text-muted-foreground">Название компании</label>
          <Input className="mt-1 h-9 max-w-sm" value={ws.name} onChange={e => A.renameWorkspace(e.target.value)} />
          <label className="mt-4 block text-xs font-medium text-muted-foreground">Тема интерфейса</label>
          <div className="mt-1.5 flex gap-1.5">
            {([["light", "Светлая", Sun], ["dark", "Тёмная", Moon]] as const).map(([t, label, Ic]) => (
              <button key={t} onClick={() => A.setTheme(t)}
                className={cn("flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] transition-colors", s.theme === t ? "border-transparent font-medium" : "text-muted-foreground hover:text-foreground")}
                style={s.theme === t ? { background: "hsl(42 42% 55% / 0.2)", color: "var(--brass-ink)" } : undefined}>
                <Ic className="size-4" /> {label}
              </button>
            ))}
          </div>
        </section>

        <IntegrationsSection />

        <AiSection />

        <section className="mt-4 rounded-xl border bg-card p-4">
          <div className="text-sm font-semibold">Команда</div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Переключайтесь между сотрудниками через аватар справа сверху — фильтры «Мои» и «Мой день» пересчитаются.</p>
          <div className="mt-3 flex flex-col gap-2">
            {ws.users.map(u => (
              <div key={u.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <UserChip id={u.id} size={26} withName />
                <span className="ml-auto text-[12px] text-muted-foreground">{u.role}</span>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11.5px] text-muted-foreground">Роли и права (до уровня поля) — этап V2 по плану продукта.</p>
        </section>

        <section className="mt-4 rounded-xl border bg-card p-4">
          <div className="text-sm font-semibold">Что в прототипе настоящее</div>
          <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              {REAL.map(t => (
                <div key={t} className="flex items-start gap-2 text-[12.5px] leading-snug">
                  <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--brass-ink)" }} /> {t}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {DEMO.map(t => (
                <div key={t} className="flex items-start gap-2 text-[12.5px] leading-snug text-muted-foreground">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" /> {t}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-destructive/25 bg-card p-4" data-danger>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Сбросить прототип</div>
              <div className="text-[12.5px] text-muted-foreground">Вернуться к мастеру и попробовать другую нишу или сборку «с нуля».</div>
            </div>
            <Button variant="outline" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/5" onClick={A.reset}>
              <RotateCcw className="size-4" /> Сбросить
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ st, okText = "подключено" }: { st: IntStatus; okText?: string }) {
  if (st === "off") return null;
  const map: Record<IntStatus, { t: string; cls: string }> = {
    off: { t: "", cls: "" },
    connecting: { t: "подключаю…", cls: "bg-muted text-muted-foreground" },
    ok: { t: okText, cls: "" },
    error: { t: "ошибка", cls: "bg-destructive/10 text-destructive" },
  };
  return (
    <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium", map[st].cls)}
      style={st === "ok" ? { background: "hsl(42 42% 55% / 0.2)", color: "var(--brass-ink)" } : undefined}>
      {map[st].t}
    </span>
  );
}

function IntegrationsSection() {
  const s = useApp();
  const ints = s.ws!.integrations!;
  const [tgToken, setTgToken] = useState(ints.tg.token);
  const [waUrl, setWaUrl] = useState(ints.wa.apiUrl);
  const [waId, setWaId] = useState(ints.wa.idInstance);
  const [waToken, setWaToken] = useState(ints.wa.apiToken);

  return (
    <section className="mt-4 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Plug className="size-4" style={{ color: "var(--brass-ink)" }} /> Интеграции: реальные каналы
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
        Прототип подключается к настоящим Telegram, WhatsApp и Tilda прямо из браузера. Токены хранятся только на этом компьютере.
      </p>

      <div className="mt-3 rounded-lg border p-3">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold">
          <Send className="size-4 text-muted-foreground" /> Telegram-бот
          <StatusBadge st={ints.tg.status} okText={ints.tg.botName ?? "подключено"} />
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          1. В Telegram напишите <b>@BotFather</b> → /newbot → скопируйте токен. 2. Вставьте сюда. 3. Напишите своему боту с телефона — диалог появится во «Входящих», отвечать можно из CRM.
        </p>
        {ints.tg.error && <p className="mt-1 text-[12px] text-destructive">{ints.tg.error}</p>}
        <div className="mt-2 flex gap-2">
          <Input className="h-9 flex-1 text-[13px]" type="password" placeholder="123456789:AA…" value={tgToken} onChange={e => setTgToken(e.target.value)} />
          <Button className="h-9" disabled={!tgToken.trim() || ints.tg.status === "connecting"} onClick={() => tgConnect(tgToken)}>Подключить</Button>
          {ints.tg.status === "ok" && (
            <Button variant="outline" className="h-9" onClick={() => { A.intPatch(i => { i.tg = { token: "", status: "off" }; }); setTgToken(""); }}>Отключить</Button>
          )}
        </div>
      </div>

      <div className="mt-2.5 rounded-lg border p-3">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold">
          <MessageCircle className="size-4 text-muted-foreground" /> WhatsApp <span className="text-[11px] font-normal text-muted-foreground">через Green API</span>
          <StatusBadge st={ints.wa.status} />
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          Зарегистрируйтесь на <b>green-api.com</b> (есть бесплатный тариф для разработки), создайте инстанс, отсканируйте QR своим WhatsApp — и вставьте idInstance и ApiToken. Входящие и ответы клиентам пойдут через ваш номер.
        </p>
        {ints.wa.error && <p className="mt-1 text-[12px] text-destructive">{ints.wa.error}</p>}
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_130px_1fr_auto]">
          <Input className="h-9 text-[13px]" placeholder="API URL" value={waUrl} onChange={e => setWaUrl(e.target.value)} />
          <Input className="h-9 text-[13px]" placeholder="idInstance" value={waId} onChange={e => setWaId(e.target.value)} />
          <Input className="h-9 text-[13px]" type="password" placeholder="apiTokenInstance" value={waToken} onChange={e => setWaToken(e.target.value)} />
          <Button className="h-9" disabled={!waId.trim() || !waToken.trim() || ints.wa.status === "connecting"} onClick={() => waConnect(waUrl, waId, waToken)}>Подключить</Button>
        </div>
      </div>

      <div className="mt-2.5 rounded-lg border p-3">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold">
          <Globe className="size-4 text-muted-foreground" /> Tilda: заявки с сайта
          <StatusBadge st={ints.tilda.status} okText="мост активен" />
        </div>
        {ints.tilda.status !== "ok" ? (
          <>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Создадим URL-приёмник (мост через webhook.site для прототипа; в реальной версии — свой приёмник). Вставьте его в Тильде: <b>Настройки сайта → Формы → Webhook</b> — и заявки будут сами падать в воронку с именем, телефоном и email.
            </p>
            {ints.tilda.error && <p className="mt-1 text-[12px] text-destructive">{ints.tilda.error}</p>}
            <Button className="mt-2 h-9" disabled={ints.tilda.status === "connecting"} onClick={tildaCreateHook}>Создать URL для Tilda</Button>
          </>
        ) : (
          <div className="mt-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-muted px-2.5 py-2 text-[12px]">{tildaHookUrl()}</code>
              <Button variant="outline" className="h-9 gap-1.5" onClick={() => { navigator.clipboard?.writeText(tildaHookUrl()).then(() => toast("URL скопирован")); }}>
                <Copy className="size-3.5" /> Копировать
              </Button>
              <Button variant="outline" className="h-9" onClick={() => A.intPatch(i => { i.tilda = { hookId: "", status: "off", seen: [] }; })}>Отключить</Button>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              Tilda: Настройки сайта → Формы → Приём данных → Webhook → вставьте URL → переопубликуйте страницу. Проверка: отправьте форму — лид появится за ~5 секунд. Мост живёт ограниченное время (webhook.site), для теста этого достаточно.
            </p>
          </div>
        )}
      </div>

      <label className="mt-3 flex cursor-pointer items-center justify-between rounded-lg border p-3">
        <span>
          <span className="block text-[13px] font-medium">Автолид из новых диалогов</span>
          <span className="block text-[11.5px] text-muted-foreground">Новый собеседник в Telegram/WhatsApp сразу создаёт запись в воронке</span>
        </span>
        <Switch checked={ints.autoLead} onCheckedChange={v => A.setAutoLead(v)} />
      </label>
    </section>
  );
}

function AiSection() {
  const s = useApp();
  const ai = s.ws!.ai;
  const [baseUrl, setBaseUrl] = useState(ai?.baseUrl ?? "https://openrouter.ai/api/v1");
  const [apiKey, setApiKey] = useState(ai?.apiKey ?? "");
  const [model, setModel] = useState(ai?.model ?? "openai/gpt-4o-mini");

  return (
    <section className="mt-4 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4" style={{ color: "var(--brass-ink)" }} /> Настоящий AI
        {ai?.apiKey && <span className="ml-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: "hsl(42 42% 55% / 0.2)", color: "var(--brass-ink)" }}>подключён</span>}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
        Любой OpenAI-совместимый endpoint (OpenRouter, ProxyAPI и т.п.). Включает: живое резюме записи, черновики ответов клиенту и «спроси CRM» на дашборде. Ключ хранится только в этом браузере.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
          <Select value={baseUrl} onValueChange={setBaseUrl}>
            <SelectTrigger className="mt-1 h-9 text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="https://openrouter.ai/api/v1">OpenRouter</SelectItem>
              <SelectItem value="https://api.openai.com/v1">OpenAI</SelectItem>
              <SelectItem value="https://api.proxyapi.ru/openai/v1">ProxyAPI (РФ)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Модель</label>
          <Input className="mt-1 h-9 text-[13px]" value={model} onChange={e => setModel(e.target.value)} placeholder="openai/gpt-4o-mini" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">API-ключ</label>
          <div className="mt-1 flex gap-2">
            <Input className="h-9 flex-1 text-[13px]" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…" />
            <Button className="h-9" onClick={() => { A.setAi({ baseUrl, apiKey: apiKey.trim(), model: model.trim() }); toast.success(apiKey.trim() ? "AI подключён" : "Ключ очищен"); }}>
              Сохранить
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

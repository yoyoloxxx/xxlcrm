// Аккаунты: оверлей входа/регистрации, создание/вступление в пространство, живая «Команда» в настройках
import { useEffect, useMemo, useState } from "react";
import { useApp, setAuthStage, getState } from "@/lib/store";
import { signIn, signUp, signOutCloud, createWs, joinWs, localWeight, iAmOwner, rotateInvite, removeMember, backupWeight, moveBackupHere, myWorkspaces, switchWs, deleteWs, setMemberScope } from "@/lib/cloud";
import { plural } from "@/lib/model";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Copy, LogIn, LogOut, Trash2, UserPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

function Ava({ name, hue, size = 26 }: { name: string; hue: number; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full text-[10px] font-semibold"
      style={{ width: size, height: size, background: `hsl(${hue} 30% 87%)`, color: `hsl(${hue} 42% 27%)` }}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function AuthOverlay({ stage }: { stage: "auth" | "ws" }) {
  // Escape закрывает окно входа: без этого выйти можно только через безымянный крестик 26×26
  useEffect(() => {
    const h = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAuthStage(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const [tab, setTab] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [wsName, setWsName] = useState("");
  const [myName, setMyName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [move, setMove] = useState(true);   // по умолчанию переносим: терять наработанное — худший исход
  const weight = localWeight();

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true); setErr("");
    const e = await fn();
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Вход в аккаунт"
      onMouseDown={ev => { if (ev.target === ev.currentTarget) setAuthStage(null); }}
      className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "hsl(var(--foreground) / 0.45)" }}>
      <div className="cascade w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-2.5">
          <span className="mark-frame grid h-[30px] w-[30px] place-items-center rounded-[7px] text-[10px] font-bold" style={{ color: "var(--brass-ink)" }}>XXL</span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold tracking-tight">{stage === "auth" ? "Вход в XXLcrm" : "Ваше пространство"}</div>
            <div className="text-[11.5px] text-muted-foreground">{stage === "auth" ? "Данные станут общими для команды — с любого устройства" : "Создайте компанию или вступите по коду приглашения"}</div>
          </div>
          <button className="press grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            onClick={() => { if (stage === "ws") void signOutCloud(); else setAuthStage(null); }}>
            <X className="size-4" />
          </button>
        </div>

        {stage === "auth" ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
              {([["in", "Вход"], ["up", "Регистрация"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); setErr(""); }}
                  className={cn("press h-8 rounded-[5px] text-[12.5px] transition-colors", tab === id ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Input className="h-10 text-[13px]" type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
              <Input className="h-10 text-[13px]" type="password" placeholder={tab === "up" ? "пароль (минимум 6 символов)" : "пароль"} value={pw} onChange={e => setPw(e.target.value)}
                onKeyDown={e => e.key === "Enter" && email.trim() && pw && run(() => (tab === "in" ? signIn(email, pw) : signUp(email, pw)))} />
              {err && <p className="text-[12px] text-destructive">{err}</p>}
              <Button className="h-10" disabled={busy || !email.trim() || pw.length < 6}
                onClick={() => run(() => (tab === "in" ? signIn(email, pw) : signUp(email, pw)))}>
                {busy ? "Секунду…" : tab === "in" ? "Войти" : "Создать аккаунт"}
              </Button>
              <p className="text-center text-[10.5px] leading-snug text-muted-foreground">
                После входа появится шаг «пространство»: своя компания или код от владельца.
              </p>
            </div>
          </>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <div className="rounded-md border p-3.5">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold"><Users className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Создать компанию</div>
              <div className="mt-2 flex flex-col gap-2">
                <Input className="h-9 text-[12.5px]" placeholder="Название компании" value={wsName} onChange={e => setWsName(e.target.value)} />
                <Input className="h-9 text-[12.5px]" placeholder="Ваше имя (видно команде)" value={myName} onChange={e => setMyName(e.target.value)} />
                {weight.any && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-dashed p-2.5">
                    <Switch checked={move} onCheckedChange={setMove} />
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium">Перенести то, что уже наработано</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">
                        {weight.records} {plural(weight.records, "запись", "записи", "записей")}
                        {weight.chats ? `, ${weight.chats} ${plural(weight.chats, "диалог", "диалога", "диалогов")}` : ""}
                        {weight.tasks ? `, ${weight.tasks} ${plural(weight.tasks, "задача", "задачи", "задач")}` : ""} — вместе с разделами и автоматизациями.
                        Копия останется и на этом устройстве. Примеры не переношу.
                      </span>
                    </span>
                  </label>
                )}
                <Button className="h-9" disabled={busy || !myName.trim()} onClick={() => run(() => createWs(wsName, myName, move))}>{busy ? "Переношу…" : "Создать пространство"}</Button>
              </div>
            </div>
            <div className="rounded-md border border-dashed p-3.5">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold"><UserPlus className="size-3.5 text-muted-foreground" /> Вступить по коду</div>
              <p className="mt-1 text-[11px] text-muted-foreground">Код даёт владелец пространства — 8 символов</p>
              <div className="mt-2 flex gap-2">
                <Input className="font-mono2 h-9 w-32 text-[12.5px]" placeholder="код" value={code} onChange={e => setCode(e.target.value)} />
                <Input className="h-9 flex-1 text-[12.5px]" placeholder="Ваше имя" value={myName} onChange={e => setMyName(e.target.value)} />
                <Button variant="outline" className="h-9" disabled={busy || !code.trim() || !myName.trim()} onClick={() => run(() => joinWs(code, myName))}>Войти</Button>
              </div>
              {weight.any && (
                <p className="mt-2 text-[11px] leading-snug" style={{ color: "var(--brass-ink)" }}>
                  У вас на устройстве {weight.records} {plural(weight.records, "запись", "записи", "записей")}. В ЧУЖОЕ пространство я их не переношу —
                  там своя база, и мешать их нельзя. Локальная копия никуда не денется: если она нужна, сначала выгрузите её
                  (Настройки → «Копия базы») или создайте своё пространство.
                </p>
              )}
            </div>
            {err && <p className="text-[12px] text-destructive">{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function TeamLive() {
  const s = useApp();
  const owner = iAmOwner();
  const [shown, setShown] = useState(false);
  const weight = localWeight();

  if (s.mode !== "cloud") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">Команда и аккаунт</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Сейчас вы работаете <b className="font-medium text-foreground">только на этом устройстве</b>: база лежит в браузере,
            её не видно с телефона и с другого компьютера, а места в нём около 4 МБ — это несколько тысяч записей, дальше он откажет.
            Так удобно посмотреть и настроить под себя. Для настоящей работы — общее пространство: там объём не ограничен,
            заявки приходят при закрытом браузере, и всё видно команде.
          </div>
          {weight.any && (
            <div className="mt-1.5 text-[11.5px] leading-snug" style={{ color: "var(--brass-ink)" }}>
              У вас уже {weight.records} {plural(weight.records, "своя запись", "своих записи", "своих записей")} — при переходе перенесу их с собой.
            </div>
          )}
        </div>
        <Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={() => setAuthStage("auth")}><LogIn className="size-3.5" /> Перейти в облако</Button>
      </div>
    );
  }

  const copyInvite = () => { navigator.clipboard?.writeText(s.inviteCode).then(() => toast("Код приглашения скопирован")); };

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Users className="size-3.5" style={{ color: "var(--brass-ink)" }} /> Команда · {s.wsName}
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {s.users.map(u => (
          <div key={u.id} className="flex items-center gap-2.5 rounded-md border px-3 py-2">
            <Ava name={u.name} hue={u.hue} size={24} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
              {u.name}{u.id === s.currentUserId && <span className="ml-1.5 text-[10.5px] font-normal text-muted-foreground">— это вы</span>}
            </span>
            <span className={cn("rounded-full border px-2 py-px text-[10px]", u.role === "Владелец" && "font-medium")}
              style={u.role === "Владелец" ? { background: "hsl(var(--brass) / 0.16)", borderColor: "hsl(var(--brass) / 0.5)", color: "var(--brass-ink)" } : undefined}>
              {u.role}
            </span>
            {/* Права: владелец решает, видит ли сотрудник всё пространство или только свои записи.
                Проверяет база — чужое такому сотруднику не отдаётся даже через API. */}
            {u.role !== "Владелец" && (owner ? (
              <select aria-label={`Права: ${u.name}`} value={u.scope === "own" ? "own" : "all"}
                onChange={e => void setMemberScope(u.id, e.target.value as "all" | "own")}
                className="h-7 rounded-md border bg-background px-1.5 text-[11px] text-muted-foreground outline-none focus:border-ring">
                <option value="all">видит всё</option>
                <option value="own">только свои</option>
              </select>
            ) : (
              <span className="text-[10.5px] text-muted-foreground">{u.scope === "own" ? "только свои" : "видит всё"}</span>
            ))}
            {owner && u.id !== s.currentUserId && (
              <RemoveMember id={u.id} name={u.name} />
            )}
          </div>
        ))}
      </div>
      {owner && s.users.some(u => u.role !== "Владелец") && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          «Только свои» — сотрудник видит и правит записи, задачи и диалоги, где он ответственный, и ничьи входящие; распределяйте заявки в «Приёме заявок» («по очереди» или на конкретного человека).
        </p>
      )}
      {/* Код приглашения — это ключ ко всей базе. Показываем его только владельцу и даём
          перевыпустить: раньше он висел у всех на виду и не менялся никогда. */}
      {owner ? (
        <div className="mt-2.5 rounded-md border border-dashed px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium">Пригласить сотрудника</div>
              <div className="text-[11px] leading-snug text-muted-foreground">
                Он регистрируется и вводит код: <code className="font-mono2">{shown ? s.inviteCode : "••••••••"}</code>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setShown(v => !v)}>{shown ? "Скрыть" : "Показать"}</Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={copyInvite}><Copy className="size-3.5" /> Код</Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-[11.5px]" onClick={() => { if (window.confirm("Перевыпустить код? Старый перестанет работать — тем, кто ещё не вступил, придётся дать новый.")) void rotateInvite(); }}>
              Перевыпустить код
            </Button>
            <span className="text-[11px] leading-snug text-muted-foreground">
              Код — это ключ ко всей базе. Разошёлся по чатам или ушёл сотрудник — перевыпустите.
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-2.5 rounded-md border border-dashed px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
          Приглашает сотрудников владелец пространства — код есть только у него.
        </p>
      )}
      <WsSwitch />
      <MoveBackup />
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={() => void signOutCloud()}>
          <LogOut className="size-3.5" /> Выйти из аккаунта
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-muted-foreground" title="Общий компьютер: выйти и стереть здесь ключи каналов и личную переписку Telegram"
          onClick={() => { if (window.confirm("Выйти и стереть на этом устройстве ключи каналов (бот, WhatsApp, MAX) и сессию личного Telegram? В облаке всё останется.")) void signOutCloud(true); }}>
          Выйти и стереть на этом устройстве
        </Button>
        {owner && <DropWs />}
      </div>
    </div>
  );
}

// Если пространств несколько — надо иметь возможность перейти в другое, не выходя из аккаунта.
// Раньше после перезагрузки открывалось какое придётся, и попасть в нужное было нечем.
function WsSwitch() {
  const s = useApp();
  const [list, setList] = useState<{ id: string; name: string; owner: boolean }[]>([]);
  const [busy, setBusy] = useState("");
  useEffect(() => { void myWorkspaces().then(setList); }, [s.wsId]);
  if (list.length < 2) return null;
  return (
    <div className="mt-2.5 rounded-md border border-dashed px-3 py-2.5">
      <div className="text-[12px] font-medium">Ваши пространства</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {list.map(w => (
          <Button key={w.id} variant="outline" size="sm"
            className={cn("h-7 text-[11.5px]", w.id === s.wsId && "border-foreground/30 font-medium")}
            disabled={!!busy || w.id === s.wsId}
            onClick={async () => {
              setBusy(w.id);
              let bad: string | null = null;
              try { bad = await switchWs(w.id); }
              catch (e) { bad = String((e as Error).message ?? e).slice(0, 160); }
              finally { setBusy(""); }
              if (bad) toast.error("Не открылось: " + bad);
            }}>
            {busy === w.id ? "Открываю…" : w.name}{w.id === s.wsId ? " · вы здесь" : ""}
          </Button>
        ))}
      </div>
    </div>
  );
}

// Перенести наработанное в ЭТО пространство. Раньше перенос жил только внутри создания
// пространства: кто сначала вошёл в облако, а потом вспомнил про базу на устройстве, забрать
// её не мог никак. Показываем блок, только если в локальной копии правда есть не-примеры.
function MoveBackup() {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const w = useMemo(() => backupWeight(), [done]);
  if (!w.any || done) return null;
  const parts = [w.records && `${w.records} ${plural(w.records, "запись", "записи", "записей")}`,
                 w.chats && `${w.chats} ${plural(w.chats, "диалог", "диалога", "диалогов")}`,
                 w.tasks && `${w.tasks} ${plural(w.tasks, "задача", "задачи", "задач")}`].filter(Boolean).join(" · ");
  return (
    <div className="mt-2.5 rounded-md border border-dashed px-3 py-2.5">
      <div className="text-[12px] font-medium">На этом устройстве осталась база</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {parts} — они не в облаке. Могу перенести сюда: примеры не поедут, копия на устройстве останется.
        Записи станут общими для команды.
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {armed ? (
          <>
            <span className="text-[11px] text-muted-foreground">Перенести в «{getState().wsName}»?</span>
            <Button size="sm" className="h-7 text-[11.5px]" disabled={busy}
              onClick={async () => {
                setBusy(true);
                // Любой срыв внутри обязан вернуть кнопку в рабочее состояние: иначе она
                // навсегда застревает на «Переношу…», и человек не знает, случилось ли что-то.
                let bad: string | null = null;
                try { bad = await moveBackupHere(); }
                catch (e) { bad = String((e as Error).message ?? e).slice(0, 160); }
                finally { setBusy(false); setArmed(false); }
                if (bad) toast.error("Перенести не вышло: " + bad, { duration: 15000, description: "Данные остались на устройстве, ничего не потеряно." });
                else setDone(true);
              }}>{busy ? "Переношу…" : "да, перенести"}</Button>
            <Button variant="outline" size="sm" className="h-7 text-[11.5px]" disabled={busy} onClick={() => setArmed(false)}>нет</Button>
          </>
        ) : (
          <Button variant="outline" size="sm" className="h-7 text-[11.5px]" onClick={() => setArmed(true)}>Перенести базу сюда</Button>
        )}
      </div>
    </div>
  );
}

// Удалить пространство. Завести можно в два клика — убрать было нечем вовсе, и человек,
// попробовавший и передумавший, оставался с мусором навсегда. Спрашиваем название целиком:
// это не та кнопка, которую жмут случайно, — вместе с пространством уходит работа всей команды.
function DropWs() {
  const s = useApp();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = s.records.filter(r => !r.demo).length;

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-destructive hover:bg-destructive/5"
        onClick={() => { setTyped(""); setOpen(true); }}>
        <Trash2 className="size-3.5" /> Удалить пространство
      </Button>
    );
  }
  return (
    <div className="w-full rounded-md border border-destructive/40 p-3">
      <div className="text-[12.5px] font-semibold text-destructive">Удалить «{s.wsName}» со всем содержимым</div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
        Уйдут {mine} {plural(mine, "запись", "записи", "записей")}, задачи, переписка и вся история —
        у вас и у {s.users.length > 1 ? "остальных участников" : "будущих участников"}. Отменить это нельзя, копии в облаке не остаётся.
        {mine > 0 && <> Если данные ещё нужны — сначала <b>Настройки → «Копия базы»</b>.</>}
      </p>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">Для подтверждения введите название: <b className="text-foreground">{s.wsName}</b></p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Input className="h-8 w-56 text-[12.5px]" value={typed} onChange={e => setTyped(e.target.value)} placeholder="название пространства" />
        <Button size="sm" className="h-8 text-[11.5px]" disabled={busy || typed.trim() !== s.wsName}
          onClick={async () => {
            setBusy(true);
            const bad = await deleteWs(s.wsId ?? "");
            setBusy(false);
            if (bad) { toast.error("Не удалил", { description: bad }); return; }
            setOpen(false);
            toast.success("Пространство удалено");
          }}>
          {busy ? "Удаляю…" : "Удалить навсегда"}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-[11.5px]" disabled={busy} onClick={() => setOpen(false)}>Отмена</Button>
      </div>
    </div>
  );
}

// Убрать сотрудника — в два шага: доступ к базе отбирают не случайным кликом
function RemoveMember({ id, name }: { id: string; name: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} title={`Убрать ${name} из пространства`} aria-label={`Убрать ${name} из пространства`}
        className="press shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:text-destructive focus-visible:text-destructive">
        <X className="size-3.5" />
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="text-[10.5px] text-destructive">убрать?</span>
      <button onClick={() => { void removeMember(id); setArmed(false); }}
        className="press rounded border border-destructive/40 px-1.5 py-0.5 text-[10.5px] text-destructive hover:bg-destructive/5">да</button>
      <button onClick={() => setArmed(false)} className="press rounded border px-1.5 py-0.5 text-[10.5px] text-muted-foreground">нет</button>
    </span>
  );
}

// Аккаунты: оверлей входа/регистрации, создание/вступление в пространство, живая «Команда» в настройках
import { useState } from "react";
import { useApp, setAuthStage } from "@/lib/store";
import { signIn, signUp, signOutCloud, createWs, joinWs } from "@/lib/cloud";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Copy, LogIn, LogOut, UserPlus, Users, X } from "lucide-react";
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
  const [tab, setTab] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [wsName, setWsName] = useState("");
  const [myName, setMyName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true); setErr("");
    const e = await fn();
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "hsl(var(--foreground) / 0.45)" }}>
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
                <Button className="h-9" disabled={busy || !myName.trim()} onClick={() => run(() => createWs(wsName, myName))}>{busy ? "Секунду…" : "Создать пространство"}</Button>
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

  if (s.mode !== "cloud") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div>
          <div className="text-[13px] font-semibold">Команда и аккаунт</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Войдите — сделки, диалоги и задачи станут общими для команды и доступными с любого устройства
          </div>
        </div>
        <Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={() => setAuthStage("auth")}><LogIn className="size-3.5" /> Войти</Button>
      </div>
    );
  }

  const copyInvite = () => { navigator.clipboard?.writeText(s.inviteCode).then(() => toast("Код приглашения скопирован: " + s.inviteCode)); };

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
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium">Пригласить сотрудника</div>
          <div className="text-[11px] leading-snug text-muted-foreground">Он регистрируется и вводит код: <code className="font-mono2">{s.inviteCode}</code></div>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={copyInvite}><Copy className="size-3.5" /> Код</Button>
      </div>
      <Button variant="outline" size="sm" className="mt-2.5 h-8 gap-1.5 text-muted-foreground" onClick={() => void signOutCloud()}>
        <LogOut className="size-3.5" /> Выйти из аккаунта
      </Button>
    </div>
  );
}

// Дни рождения: ищутся в ЛЮБОМ разделе по полю-дате с названием «День рождения» (работает и в своих разделах).
// Авто-задача «Поздравить» создаётся за 0–7 дней с детерминированным id — не дублируется ни локально, ни в команде.
import type { EntityCfg, Field, Rec } from "./model";
import { DAY } from "./model";
import { getState, recTitle, A, phoneKey } from "./store";

const isBdayField = (f: Field) => f.type === "date" && /рожде|birth/i.test(f.label);

export interface Bday { rec: Rec; nextTs: number; inDays: number; turns?: number; dateLabel: string }

// ближайшие дни рождения по всем разделам (0 = сегодня)
export function upcomingBirthdays(withinDays = 30): Bday[] {
  const st = getState();
  const fieldsByEntity = new Map<string, Field>();
  for (const e of st.entities as EntityCfg[]) {
    const f = e.fields.find(isBdayField);
    if (f) fieldsByEntity.set(e.id, f);
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out: Bday[] = [];
  for (const r of st.records) {
    const f = fieldsByEntity.get(r.entityId);
    if (!f) continue;
    const raw = Number(r.values[f.id]);
    // мусор в поле (или дата за пределами Date) раньше ломал весь блок дней рождения
    // и плодил вечно просроченную задачу-призрак
    if (!raw || !isFinite(raw) || Math.abs(raw) > 8.64e15) continue;
    const b = new Date(raw);
    if (isNaN(b.getTime()) || b.getFullYear() < 1900 || b.getFullYear() > 2200) continue;
    let next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
    if (next.getTime() < today.getTime()) next = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate());
    const inDays = Math.round((next.getTime() - today.getTime()) / DAY);
    if (inDays > withinDays) continue;
    const age = next.getFullYear() - b.getFullYear();
    out.push({
      rec: r, nextTs: next.getTime(), inDays,
      turns: b.getFullYear() > 1902 && age > 0 && age < 120 ? age : undefined,
      dateLabel: b.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
    });
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

export const inDaysLabel = (n: number) => (n === 0 ? "сегодня!" : n === 1 ? "завтра" : `через ${n} дн.`);

// напоминания «поздравить» в Задачах: на 10:00 дня рождения, за неделю до срока
export function ensureBirthdayTasks() {
  for (const b of upcomingBirthdays(7)) {
    const at = new Date(b.nextTs); at.setHours(10, 0, 0, 0);
    // В id входит и сама дата: поправил день рождения — старое напоминание уезжает, новое встаёт.
    // Раньше в карточке было 25-е, а задача продолжала стоять на 22-е, и это никак не чинилось.
    const dm = `${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
    const id = `t_bday_${b.rec.id}_${at.getFullYear()}_${dm}`;   // детерминированный id: команда не создаст дублей
    const stale = getState().tasks.filter(t => !t.done && t.id !== id && t.id.startsWith(`t_bday_${b.rec.id}_`));
    for (const t of stale) A.taskDelete(t.id);
    A.taskAddAt(id, `Поздравить: ${recTitle(b.rec.id)} (день рождения)`, "msg", at.getTime(), b.rec.id);
  }
}

// диалог, связанный с клиентом: по записи или по совпадению телефона
export function chatForRecord(rec: Rec): string | null {
  const st = getState();
  const direct = st.chats.find(c => c.recordId === rec.id);
  if (direct) return direct.id;
  const e = st.entities.find(x => x.id === rec.entityId);
  const phoneF = e?.fields.find(f => f.type === "phone");
  const d = phoneF ? phoneKey(rec.values[phoneF.id]) : null;
  if (!d) return null;
  return st.chats.find(c => phoneKey(c.phone) === d)?.id ?? null;
}

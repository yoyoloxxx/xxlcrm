// Подстановка переменных шаблона из связанной записи: {имя} {клиент} {сумма} {стадия} {трек} {менеджер}
import type { Chat } from "./model";
import { fmtMoney } from "./model";
import { getState, recById, recTitle, userName, entityCfg, relatedOf } from "./store";

export function fillTemplate(text: string, chat: Chat): string {
  const rec = chat.recordId ? recById(chat.recordId) : undefined;
  const e = rec ? entityCfg(rec.entityId) : undefined;
  // {имя}/{клиент} — это СОБЕСЕДНИК: имя диалога; если диалог связан с разделом «Контакты» — имя контакта.
  // Название сделки сюда не подставляем — «Здравствуйте, Лендинг!» недопустим.
  // имя берём ТОЛЬКО из карточки клиента: «Здравствуйте, Новый!» из названия диалога — это позор перед клиентом
  const linked = rec && !entityCfg(rec.entityId).stages?.length ? recTitle(rec.id) : "";
  const related = rec ? relatedOf(rec.id).records.find(r => !entityCfg(r.entityId).stages?.length) : undefined;
  const person = (linked || (related ? recTitle(related.id) : "")).trim();
  const vars: Record<string, string> = {
    "имя": person.split(/\s+/)[0]?.replace(/[,;:.!?]+$/, "") ?? "",
    "клиент": person,
    "менеджер": userName(rec?.ownerId ?? getState().currentUserId),
  };
  if (rec && e) {
    const money = e.fields.find(f => f.type === "money");
    if (money && rec.values[money.id] !== undefined) vars["сумма"] = fmtMoney(rec.values[money.id]);
    const track = e.fields.find(f => /трек/i.test(f.label));
    if (track && rec.values[track.id]) vars["трек"] = String(rec.values[track.id]);
    const stage = e.stages?.find(s => s.id === rec.stageId);
    if (stage) vars["стадия"] = stage.label;
  }
  const out = text.replace(/\{([^}]+)\}/g, (m, key: string) => {
    const v = vars[key.trim().toLowerCase()];
    if (v !== undefined && v !== "") return v;
    if (key.trim().toLowerCase() === "имя") return "";   // клиента не знаем — обращение выкидываем целиком
    return m;                                            // остальные незаполненные оставляем видимыми: их видно и не отправить
  });
  // «Здравствуйте, !» → «Здравствуйте!»
  return out.replace(/,\s*([!?.,])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

// В тексте остались незаполненные {переменные}? Тогда отправлять нельзя — клиент получит «счёт на {сумма}»
export const unfilledVars = (text: string): string[] => (text.match(/\{[^}]+\}/g) ?? []);

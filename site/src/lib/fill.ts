// Подстановка переменных шаблона из связанной записи: {имя} {клиент} {сумма} {стадия} {трек} {менеджер} {компания}
import type { Chat } from "./model";
import { fmtMoney } from "./model";
import { getState, recById, recTitle, userName, entityCfg } from "./store";

export function fillTemplate(text: string, chat: Chat): string {
  const rec = chat.recordId ? recById(chat.recordId) : undefined;
  const e = rec ? entityCfg(rec.entityId) : undefined;
  // {имя}/{клиент} — это СОБЕСЕДНИК: имя диалога; если диалог связан с разделом «Контакты» — имя контакта.
  // Название сделки сюда не подставляем — «Здравствуйте, Лендинг!» недопустим.
  const person = ((rec && rec.entityId === "contacts" ? recTitle(rec.id) : "") || chat.name).trim();
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
    const compF = e.fields.find(f => f.type === "relation" && f.relationTo === "companies");
    if (compF && rec.values[compF.id]) vars["компания"] = recTitle(rec.values[compF.id] as string);
  }
  return text.replace(/\{([^}]+)\}/g, (m, key: string) => {
    const v = vars[key.trim().toLowerCase()];
    return v !== undefined && v !== "" ? v : m; // неизвестные переменные оставляем видимыми
  });
}

// Реальный AI через OpenAI-совместимый endpoint (OpenRouter и т.п.). Ключ хранится только локально.
import { getState, entityById, recTitle, userName, rollupValue } from "./store";
import type { Rec } from "./model";
import { displayValue, fmtDateTime } from "./model";

export const aiReady = () => { const ai = getState().ws?.ai; return !!(ai?.apiKey && ai.baseUrl && ai.model); };

export async function llm(system: string, user: string): Promise<string> {
  const ai = getState().ws?.ai;
  if (!ai?.apiKey) throw new Error("AI не настроен: добавьте ключ в Настройках");
  const res = await fetch(ai.baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 600, temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`AI: ${res.status} ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("AI: пустой ответ");
  return String(text).trim();
}

export function recordContext(rec: Rec): string {
  const s = getState(); const ws = s.ws!;
  const e = entityById(rec.entityId)!;
  const lines: string[] = [
    `Тип записи: ${e.name}. Название: ${recTitle(rec.id)}. Ответственный: ${userName(rec.ownerId)}.`,
  ];
  if (e.pipeline) {
    const st = e.pipeline.stages.find(x => x.id === rec.stageId);
    const days = Math.max(1, Math.round((Date.now() - (rec.stageAt ?? rec.createdAt)) / 86400000));
    lines.push(`Стадия: «${st?.label}» (${days} дн.). Все стадии: ${e.pipeline.stages.map(x => x.label).join(" → ")}.`);
  }
  lines.push("Поля:");
  for (const f of e.fields) {
    const v = f.type === "rollup" ? String(rollupValue(f, rec)) : displayValue(f, rec.values[f.id], { recTitle, userName });
    if (v) lines.push(`- ${f.label}: ${v}`);
  }
  const tasks = ws.tasks.filter(t => t.recordId === rec.id);
  if (tasks.length) lines.push("Задачи: " + tasks.map(t => `${t.done ? "[x]" : "[ ]"} ${t.title} (${fmtDateTime(t.due)})`).join("; "));
  const acts = ws.activities.filter(a => a.recordId === rec.id).sort((a, b) => b.ts - a.ts).slice(0, 12);
  if (acts.length) lines.push("Хронология (новое сверху): " + acts.map(a => `${fmtDateTime(a.ts)} — ${a.text}`).join(" | "));
  const chat = ws.chats.find(c => c.recordId === rec.id);
  if (chat) lines.push(`Переписка (${chat.channel}): ` + chat.msgs.slice(-8).map(m => `${m.out ? "Мы" : "Клиент"}: ${m.text}`).join(" | "));
  return lines.join("\n");
}

export function crmContext(): string {
  const ws = getState().ws!;
  const lines: string[] = [`Компания: ${ws.name}. Сегодня: ${new Date().toLocaleDateString("ru-RU")}.`];
  for (const e of ws.entities) {
    const recs = ws.records.filter(r => r.entityId === e.id);
    let line = `Раздел «${e.namePlural}»: ${recs.length} записей.`;
    if (e.pipeline) {
      line += " По стадиям: " + e.pipeline.stages.map(st => `${st.label}=${recs.filter(r => r.stageId === st.id).length}`).join(", ") + ".";
      const money = e.fields.find(f => f.type === "money");
      if (money) {
        const open = recs.filter(r => e.pipeline!.stages.find(x => x.id === r.stageId)?.kind === "open");
        line += ` Сумма в работе: ${open.reduce((s, r) => s + (Number(r.values[money.id]) || 0), 0)} руб.`;
      }
    }
    lines.push(line);
  }
  const open = ws.tasks.filter(t => !t.done);
  lines.push(`Открытых задач: ${open.length}, из них просрочено: ${open.filter(t => t.due < Date.now()).length}.`);
  return lines.join("\n");
}

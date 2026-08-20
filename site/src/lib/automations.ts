// Движок автоматизаций: универсальные правила «когда → тогда» для любых разделов конструктора.
// События (создание записи, смена стадии) приходят из стора через ruleHooks; «застряла» и «тишина»
// проверяются периодическим сканом. Задачи создаются с детерминированным id — дублей не будет
// ни при повторном скане, ни у двух участников команды одновременно (upsert по id в общей базе).
import type { Rec, Rule } from "./model";
import { DAY } from "./model";
import { getState, recById, ruleHooks, A } from "./store";
import { toast } from "sonner";
import { plural } from "./model";

const rules = () => getState().automations.filter(r => r.enabled);

function stageMatches(rule: Extract<Rule["trigger"], { type: "stage_enter" }>, rec: Rec): boolean {
  const e = getState().entities.find(x => x.id === rec.entityId);
  const stg = e?.stages?.find(x => x.id === rec.stageId);
  if (!stg) return false;
  if (rule.stageId === "kind:won" || rule.stageId === "kind:lost") return stg.kind === rule.stageId.slice(5);
  return stg.id === rule.stageId;
}

// Ночью не назначаем: заявка в 23:40 с правилом «через час» давала задачу на 00:40,
// которая уже не «сегодня» — и «Мой день» честно рапортовал «задач нет», пока клиент ждал.
function workTime(ts: number): number {
  const d = new Date(ts);
  const h = d.getHours();
  if (h >= 9 && h < 22) return ts;
  if (h >= 22) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 30).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 30).getTime();
}

function fire(rule: Rule, rec: Rec, ctxKey: string) {
  const due = workTime(Date.now() + rule.action.afterHours * 3600000);
  const taskId = `t_rule_${rule.id}_${rec.id}_${ctxKey}`;
  const created = A.taskAddAt(taskId, rule.action.title, rule.action.kind, due, rec.id);
  if (created) A.ruleFired(rule.id);
}

function onCreated(recId: string) {
  const rec = recById(recId);
  if (!rec) return;
  for (const r of rules()) {
    if (r.trigger.type === "record_created" && r.trigger.entityId === rec.entityId) fire(r, rec, "created");
  }
}

function onStage(recId: string, stageId: string) {
  const rec = recById(recId);
  if (!rec || rec.stageId !== stageId) return;
  for (const r of rules()) {
    if (r.trigger.type === "stage_enter" && r.trigger.entityId === rec.entityId && stageMatches(r.trigger, rec)) {
      fire(r, rec, `enter_${stageId}_${rec.stageAt ?? 0}`); // повторный заход на стадию сработает снова
    }
  }
}

// Последняя активность записи — только ЧЕЛОВЕЧЕСКАЯ: комментарии, правки, стадии, сообщения.
// Задачи, поставленные самими правилами, сюда не входят: иначе правило «тишина» считало
// собственный след свежей активностью и перезаряжало себя вечно, добивая базу до квоты браузера.
const HUMAN: Record<string, boolean> = { comment: true, field: true, stage: true, created: true };
function lastActivityIndex(): Map<string, number> {
  const st = getState();
  const m = new Map<string, number>();
  for (const r of st.records) m.set(r.id, r.updatedAt);
  for (const a of st.activities) {
    if (!HUMAN[a.kind]) continue;
    const cur = m.get(a.recordId) ?? 0;
    if (a.ts > cur) m.set(a.recordId, a.ts);
  }
  return m;
}

// Одно правило на справочнике из 5 000 клиентов создавало 5 000 задач за проход и выбивало
// базу за квоту. Больше этого за раз не ставим — остальное подождёт следующего часа.
const MAX_PER_SCAN = 40;

export function scanAutomations(announce = false) {
  const st = getState();
  const nowMs = Date.now();
  const before = st.tasks.length;
  const lastAct = lastActivityIndex();      // один проход по хронике вместо прохода на каждую запись
  let capped = false;
  for (const r of rules()) {
    if (r.trigger.type === "stage_stuck") {
      const { entityId, days } = r.trigger;
      for (const rec of st.records) {
        if (rec.entityId !== entityId) continue;
        const e = st.entities.find(x => x.id === entityId);
        const stg = e?.stages?.find(x => x.id === rec.stageId);
        if (!stg || stg.kind !== "open") continue;
        const since = rec.stageAt ?? rec.createdAt;
        if (nowMs - since <= days * DAY) continue;
        if (getState().tasks.length - before >= MAX_PER_SCAN) { capped = true; break; }
        fire(r, rec, `stuck_${rec.stageId}_${since}`);
      }
    } else if (r.trigger.type === "quiet") {
      const { entityId, days } = r.trigger;
      for (const rec of st.records) {
        if (rec.entityId !== entityId) continue;
        const e = st.entities.find(x => x.id === entityId);
        // «спящий» имеет смысл для завершённых или бесстадийных записей: активные ловит «застряла»
        const stg = e?.stages?.find(x => x.id === rec.stageId);
        if (stg && stg.kind === "open") continue;
        if (stg && stg.kind === "lost") continue; // отказавшимся не навязываемся
        const last = lastAct.get(rec.id) ?? 0;
        if (!last || nowMs - last <= days * DAY) continue;
        if (getState().tasks.length - before >= MAX_PER_SCAN) { capped = true; break; }
        // ключ по НЕДЕЛЕ молчания, а не по метке активности: иначе каждый скан считал бы это новым случаем
        fire(r, rec, `quiet_${Math.floor(last / DAY)}`);
      }
    }
  }
  // цифры на «Моём дне» не должны меняться сами по себе: если правила что-то создали — говорим об этом
  const added = getState().tasks.length - before;
  // Цифры на «Моём дне» не должны меняться сами по себе — говорим о часовом скане тоже,
  // а не только о том, что случился при открытии вкладки.
  if (added > 0 && (announce || added >= 1)) {
    toast(`Автоматизации поставили ${added} ${plural(added, "задачу", "задачи", "задач")}`, {
      description: capped
        ? `Это предел за один проход — остальные записи проверю через час`
        : "Правила «когда → тогда» проверили записи — список задач обновлён",
    });
  }
}

let started = false;
export function initAutomations() {
  if (started) return;
  started = true;
  ruleHooks.created = onCreated;
  ruleHooks.stage = onStage;
  window.setTimeout(() => scanAutomations(true), 2500); // после первичной загрузки данных — с отчётом
  window.setInterval(scanAutomations, 3600000);   // и раз в час
}

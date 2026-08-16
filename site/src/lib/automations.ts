// Движок автоматизаций: универсальные правила «когда → тогда» для любых разделов конструктора.
// События (создание записи, смена стадии) приходят из стора через ruleHooks; «застряла» и «тишина»
// проверяются периодическим сканом. Задачи создаются с детерминированным id — дублей не будет
// ни при повторном скане, ни у двух участников команды одновременно (upsert по id в общей базе).
import type { Rec, Rule } from "./model";
import { DAY } from "./model";
import { getState, recById, ruleHooks, A } from "./store";

const rules = () => getState().automations.filter(r => r.enabled);

function stageMatches(rule: Extract<Rule["trigger"], { type: "stage_enter" }>, rec: Rec): boolean {
  const e = getState().entities.find(x => x.id === rec.entityId);
  const stg = e?.stages?.find(x => x.id === rec.stageId);
  if (!stg) return false;
  if (rule.stageId === "kind:won" || rule.stageId === "kind:lost") return stg.kind === rule.stageId.slice(5);
  return stg.id === rule.stageId;
}

function fire(rule: Rule, rec: Rec, ctxKey: string) {
  const due = Date.now() + rule.action.afterHours * 3600000;
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

// последняя активность записи: комментарии/стадии/сообщения — что угодно в хронологии, иначе updatedAt
function lastActivityTs(recId: string): number {
  const st = getState();
  let last = recById(recId)?.updatedAt ?? 0;
  for (const a of st.activities) if (a.recordId === recId && a.ts > last) last = a.ts;
  return last;
}

export function scanAutomations() {
  const st = getState();
  const nowMs = Date.now();
  for (const r of rules()) {
    if (r.trigger.type === "stage_stuck") {
      const { entityId, days } = r.trigger;
      for (const rec of st.records) {
        if (rec.entityId !== entityId) continue;
        const e = st.entities.find(x => x.id === entityId);
        const stg = e?.stages?.find(x => x.id === rec.stageId);
        if (!stg || stg.kind !== "open") continue;
        const since = rec.stageAt ?? rec.createdAt;
        if (nowMs - since > days * DAY) fire(r, rec, `stuck_${rec.stageId}_${since}`);
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
        const last = lastActivityTs(rec.id);
        if (last && nowMs - last > days * DAY) fire(r, rec, `quiet_${last}`);
      }
    }
  }
}

let started = false;
export function initAutomations() {
  if (started) return;
  started = true;
  ruleHooks.created = onCreated;
  ruleHooks.stage = onStage;
  window.setTimeout(scanAutomations, 2500);       // после первичной загрузки данных
  window.setInterval(scanAutomations, 3600000);   // и раз в час
}

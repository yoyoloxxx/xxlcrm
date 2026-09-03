// Движок автоматизаций: универсальные правила «когда → тогда» для любых разделов конструктора.
// События (создание записи, смена стадии) приходят из стора через ruleHooks; «застряла», «тишина»,
// «клиент ждёт ответа» и «за N дней до даты» проверяются периодическим сканом. Задачи создаются
// с детерминированным id — дублей не будет ни при повторном скане, ни у двух участников команды
// одновременно (upsert по id в общей базе).
//
// Действие «написать клиенту по шаблону» уходит в диалог настоящего канала (Telegram/WhatsApp/MAX)
// через очередь отправки: ночью и «через N часов» сообщение ждёт рабочего времени, а если диалога
// или канала нет — вместо него ставится задача «Написать клиенту», чтобы правило не сработало впустую.
import type { Chat, Rec, ReplyTemplate, Rule } from "./model";
import { DAY, plural } from "./model";
import { getState, recById, ruleHooks, ruleIssue, isPrivateChat, relatedOf, tabState, A } from "./store";
import { fillTemplate, unfilledVars } from "./fill";
import { sendChatMessage } from "./integrations";
import { toast } from "sonner";

// ---------- целостность правила ----------
// Базовая проверка (раздел, стадия у «попала на стадию», воронка) живёт в сторе; здесь — то, что
// появилось вместе с новыми триггерами: стадия у «застряла», поле-дата, шаблон сообщения.
export function ruleProblem(r: Rule): string | null {
  const base = ruleIssue(r);
  if (base) return base;
  const st = getState();
  const t = r.trigger;
  const e = st.entities.find(x => x.id === t.entityId);
  if (!e) return "раздел удалён";
  if (t.type === "stage_stuck" && t.stageId && !e.stages?.some(x => x.id === t.stageId)) return "стадия удалена";
  if (t.type === "date_before") {
    const f = e.fields.find(x => x.id === t.fieldId);
    if (!f) return "поле удалено";
    if (f.type !== "date" && f.type !== "datetime") return "поле больше не дата";
  }
  const a = r.action;
  if (a.type === "message" && !st.replyTemplates.some(x => x.id === a.templateId)) return "шаблон удалён";
  return null;
}

const rules = () => getState().automations.filter(r => r.enabled && !ruleProblem(r));

function stageMatches(rule: Extract<Rule["trigger"], { type: "stage_enter" }>, rec: Rec): boolean {
  const e = getState().entities.find(x => x.id === rec.entityId);
  const stg = e?.stages?.find(x => x.id === rec.stageId);
  if (!stg) return false;
  if (rule.stageId === "kind:won" || rule.stageId === "kind:lost") return stg.kind === rule.stageId.slice(5);
  return stg.id === rule.stageId;
}

// Ночью не назначаем: заявка в 23:40 с правилом «через час» давала задачу на 00:40,
// которая уже не «сегодня» — и «Мой день» честно рапортовал «задач нет», пока клиент ждал.
// Сообщения клиенту подчиняются тому же окну: ничего не уходит между 22:00 и 9:00.
function workTime(ts: number): number {
  const d = new Date(ts);
  const h = d.getHours();
  if (h >= 9 && h < 22) return ts;
  if (h >= 22) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 30).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 30).getTime();
}
const inWorkHours = (ts: number) => workTime(ts) === ts;

const taskIdOf = (rule: Rule, rec: Rec, ctxKey: string) => `t_rule_${rule.id}_${rec.id}_${ctxKey}`;

// Одно срабатывание = одна задача ИЛИ одно сообщение. Возвращает true, если правило что-то сделало.
// since — момент, с которого считается «этот случай» (создание, заход на стадию, письмо клиента):
// по нему сообщение не отправляется повторно, даже если задачи-метки нет.
function fire(rule: Rule, rec: Rec, ctxKey: string, since: number, chatId?: string): boolean {
  const a = rule.action;
  if (a.type === "task") {
    const due = workTime(Date.now() + a.afterHours * 3600000);
    const created = A.taskAddAt(taskIdOf(rule, rec, ctxKey), a.title, a.kind, due, rec.id);
    if (created) A.ruleFired(rule.id);
    return created;
  }
  return queueMessage(rule, rec, ctxKey, since, chatId);
}

function onCreated(recId: string) {
  const rec = recById(recId);
  if (!rec) return;
  for (const r of rules()) {
    if (r.trigger.type === "record_created" && r.trigger.entityId === rec.entityId) fire(r, rec, "created", rec.createdAt);
  }
}

function onStage(recId: string, stageId: string) {
  const rec = recById(recId);
  if (!rec || rec.stageId !== stageId) return;
  for (const r of rules()) {
    if (r.trigger.type === "stage_enter" && r.trigger.entityId === rec.entityId && stageMatches(r.trigger, rec)) {
      fire(r, rec, `enter_${stageId}_${rec.stageAt ?? 0}`, rec.stageAt ?? Date.now()); // повторный заход на стадию сработает снова
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

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
const isOpenStage = (rec: Rec): boolean => {
  const e = getState().entities.find(x => x.id === rec.entityId);
  const stg = e?.stages?.find(x => x.id === rec.stageId);
  return !stg || stg.kind === "open";   // без воронки — запись всегда «в работе»
};

export function scanAutomations(announce = false) {
  const st = getState();
  const nowMs = Date.now();
  const before = st.tasks.length;
  const lastAct = lastActivityIndex();      // один проход по хронике вместо прохода на каждую запись
  let made = 0;                              // задач + сообщений за этот проход
  let capped = false;
  const room = () => { if (made >= MAX_PER_SCAN) { capped = true; return false; } return true; };
  const did = (ok: boolean) => { if (ok) made++; };
  for (const r of rules()) {
    if (r.trigger.type === "stage_stuck") {
      const { entityId, days, stageId } = r.trigger;
      for (const rec of st.records) {
        if (rec.entityId !== entityId) continue;
        if (stageId && rec.stageId !== stageId) continue;   // правило про конкретную стадию — остальных не трогаем
        const e = st.entities.find(x => x.id === entityId);
        const stg = e?.stages?.find(x => x.id === rec.stageId);
        if (!stg || stg.kind !== "open") continue;
        const since = rec.stageAt ?? rec.createdAt;
        if (nowMs - since <= days * DAY) continue;
        if (!room()) break;
        did(fire(r, rec, `stuck_${rec.stageId}_${since}`, since));
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
        if (!room()) break;
        // ключ по НЕДЕЛЕ молчания, а не по метке активности: иначе каждый скан считал бы это новым случаем
        did(fire(r, rec, `quiet_${Math.floor(last / DAY)}`, last));
      }
    } else if (r.trigger.type === "unanswered") {
      // Клиент написал последним и ждёт дольше N часов. Только НАСТОЯЩИЕ диалоги (с внешним id
      // канала): демо-переписка и личный Telegram, не отданный в CRM, задач не плодят.
      const { entityId, hours } = r.trigger;
      for (const c of st.chats) {
        if (!c.recordId || !c.ext || isPrivateChat(c)) continue;
        const rec = recById(c.recordId);
        if (!rec || rec.entityId !== entityId || !isOpenStage(rec)) continue;
        const last = c.msgs[c.msgs.length - 1];
        if (!last || last.out) continue;
        if (nowMs - last.ts < hours * 3600000) continue;
        // по этой записи уже стоит открытая задача от этого правила — второй раз не дёргаем
        if (st.tasks.some(t => t.recordId === rec.id && !t.done && t.id.startsWith(`t_rule_${r.id}_${rec.id}_`))) continue;
        if (!room()) break;
        did(fire(r, rec, `wait_${last.ts}`, last.ts, c.id));
      }
    } else if (r.trigger.type === "date_before") {
      // Окно: от «за N дней до даты» до конца самого дня. Один раз на запись+поле+дату — поменяли
      // дату в карточке, напоминание встанет заново; закрытые записи (успех/отказ) не напоминаем.
      const { entityId, fieldId, days } = r.trigger;
      for (const rec of st.records) {
        if (rec.entityId !== entityId || !isOpenStage(rec)) continue;
        const raw = Number(rec.values[fieldId]);
        if (!raw || !isFinite(raw) || Math.abs(raw) > 8.64e15) continue;
        const d = new Date(raw);
        if (isNaN(d.getTime())) continue;
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const from = dayStart - days * DAY;
        if (nowMs < from || nowMs >= dayStart + DAY) continue;
        if (!room()) break;
        did(fire(r, rec, `before_${fieldId}_${dayKey(d)}`, from));
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
  void processOutbox();
}

// ---------- сообщения клиенту: очередь отправки ----------
// Живёт на устройстве (localStorage): ночное правило дождётся утра даже после перезагрузки вкладки,
// а ключ отправленного не даст повторить сообщение при следующем скане.
interface Pending { key: string; ruleId: string; recId: string; ctx: string; since: number; at: number; chatId?: string }
interface Outbox { pending: Pending[]; sent: string[] }
const OUTBOX_KEY = "xxlcrm-auto-outbox-v1";
const SENT_MAX = 400;
const STALE_MS = 24 * 3600000;   // сообщение, пролежавшее в очереди сутки, клиенту уже не в тему — отдаём человеку задачей

function loadOutbox(): Outbox {
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return { pending: Array.isArray(o?.pending) ? o.pending : [], sent: Array.isArray(o?.sent) ? o.sent : [] };
  } catch { return { pending: [], sent: [] }; }
}
const outbox: Outbox = loadOutbox();
function saveOutbox() {
  try { window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch { /* места нет — очередь доживёт до закрытия вкладки */ }
}
function markSent(key: string) {
  outbox.sent.push(key);
  if (outbox.sent.length > SENT_MAX) outbox.sent.splice(0, outbox.sent.length - SENT_MAX);
}

function templateOf(rule: Rule): ReplyTemplate | undefined {
  const a = rule.action;
  if (a.type !== "message") return undefined;
  return getState().replyTemplates.find(t => t.id === a.templateId);
}
const markerText = (tpl: ReplyTemplate) => `Автоматика: отправлено по шаблону «${tpl.name}»`;

// Этот случай уже отработан? Ключ на устройстве, задача-метка (или её след после удаления),
// а для команды — комментарий автоматики в хронике записи не раньше начала случая.
function alreadyHandled(rule: Rule, rec: Rec, ctxKey: string, since: number): boolean {
  const key = `${rule.id}_${rec.id}_${ctxKey}`;
  if (outbox.sent.includes(key) || outbox.pending.some(p => p.key === key)) return true;
  const st = getState();
  const tid = `t_rule_${key}`;
  if (st.tasks.some(t => t.id === tid) || st.activities.some(a => a.editKey === tid)) return true;
  const tpl = templateOf(rule);
  if (tpl) {
    const marker = markerText(tpl);
    if (st.activities.some(a => a.recordId === rec.id && a.kind === "comment" && a.ts >= since && a.text === marker)) return true;
  }
  return false;
}

function queueMessage(rule: Rule, rec: Rec, ctxKey: string, since: number, chatId?: string): boolean {
  if (rule.action.type !== "message" || alreadyHandled(rule, rec, ctxKey, since)) return false;
  // В команде событие приходит во все открытые браузеры разом — разводим отправку по времени,
  // чтобы первый успел оставить след в хронике, а остальные его увидели и промолчали.
  const jitter = getState().mode === "cloud" ? 3000 + Math.floor(Math.random() * 15000) : 0;
  const at = workTime(Date.now() + (rule.action.afterHours ?? 0) * 3600000 + jitter);
  outbox.pending.push({ key: `${rule.id}_${rec.id}_${ctxKey}`, ruleId: rule.id, recId: rec.id, ctx: ctxKey, since, at, chatId });
  saveOutbox();
  void processOutbox();
  return true;
}

// Куда можно написать: настоящий диалог (внешний id канала), не личная переписка, канал подключён.
// Instagram — только приём (Meta не даёт отвечать из CRM), демо-диалоги без ext — не канал.
function sendable(c: Chat): boolean {
  if (!c.ext || isPrivateChat(c)) return false;
  const i = getState().integrations;
  if (c.ext.tgu !== undefined) return i.tgUser.status === "ok";
  if (c.ext.tg !== undefined) return i.tg.status === "ok";
  if (c.ext.wa !== undefined) return i.wa.status === "ok";
  if (c.ext.max !== undefined) return i.max.status === "ok";
  return false;
}
// Диалог клиента для записи: привязанный к ней; иначе — к тем, на кого она ссылается (сделка → клиент),
// в том числе по совпадению телефона. Из нескольких берём самый свежий.
function chatForRecord(rec: Rec, preferId?: string): Chat | undefined {
  const st = getState();
  if (preferId) {
    const c = st.chats.find(x => x.id === preferId);
    return c && sendable(c) ? c : undefined;   // правило «ждёт ответа» отвечает именно в тот диалог
  }
  const lastTs = (c: Chat) => c.msgs[c.msgs.length - 1]?.ts ?? 0;
  const pick = (list: Chat[]) => list.filter(sendable).sort((a, b) => lastTs(b) - lastTs(a))[0];
  const e = st.entities.find(x => x.id === rec.entityId);
  const ids = [rec.id, ...(e?.fields ?? []).filter(f => f.type === "relation").map(f => rec.values[f.id]).filter((v): v is string => typeof v === "string" && !!v)];
  return pick(st.chats.filter(c => !!c.recordId && ids.includes(c.recordId))) ?? pick(ids.flatMap(id => relatedOf(id).chats));
}

function fallbackTask(rule: Rule, rec: Rec, p: Pending, tpl: ReplyTemplate | undefined): boolean {
  const title = `Написать клиенту: ${tpl?.name ?? "по шаблону"}`;
  const created = A.taskAddAt(`t_rule_${p.key}`, title, "msg", workTime(Date.now()), rec.id);
  if (created) A.ruleFired(rule.id);
  return created;
}

let sending = false, again = false;
async function processOutbox() {
  if (sending) { again = true; return; }
  if (tabState().follower && getState().mode === "local") return; // ведомая вкладка ничего не пишет — и не шлёт
  sending = true;
  try { do { again = false; await runOutbox(); } while (again); } finally { sending = false; }
}

async function runOutbox() {
  const nowMs = Date.now();
  let sent = 0, tasks = 0, dirty = false;
  for (const p of [...outbox.pending]) {
    if (p.at > nowMs) continue;
    if (!inWorkHours(nowMs)) { p.at = workTime(nowMs); dirty = true; continue; }   // открыли вкладку ночью — ждём утра
    outbox.pending = outbox.pending.filter(x => x !== p); dirty = true;
    const rule = getState().automations.find(r => r.id === p.ruleId);
    const rec = recById(p.recId);
    if (!rule || !rule.enabled || rule.action.type !== "message" || !rec) continue;   // правило выключили/удалили, записи нет — молчим
    const tpl = templateOf(rule);
    if (nowMs - p.at > STALE_MS) { if (fallbackTask(rule, rec, p, tpl)) tasks++; continue; }   // пролежало сутки — пусть решит человек
    if (alreadyHandled(rule, rec, p.ctx, p.since)) continue;     // коллега уже отправил (след в хронике) — молчим
    const chat = tpl ? chatForRecord(rec, p.chatId) : undefined;
    const text = chat && tpl ? fillTemplate(tpl.text, { ...chat, recordId: rec.id }) : "";
    if (!chat || !tpl || !text || unfilledVars(text).length) {   // нет диалога/канала или в шаблоне дыры — задача вместо письма
      if (fallbackTask(rule, rec, p, tpl)) tasks++;
      continue;
    }
    markSent(p.key); saveOutbox();   // до отправки: параллельный проход не должен отправить второй раз
    await sendChatMessage(chat.id, text);
    // канал не доставил — sendChatMessage пометил пузырь как неотправленный; тогда пусть напишет человек
    const fresh = getState().chats.find(c => c.id === chat.id);
    const msg = fresh ? [...fresh.msgs].reverse().find(m => m.out && m.text === text) : undefined;
    if (!msg || msg.failed) { if (fallbackTask(rule, rec, p, tpl)) tasks++; continue; }
    A.addComment(rec.id, markerText(tpl));   // след в хронике: видно, что написала автоматика, и по чему
    A.ruleFired(rule.id);
    sent++;
  }
  if (dirty) saveOutbox();
  if (sent) toast(`Автоматизации написали клиентам: ${sent} ${plural(sent, "сообщение", "сообщения", "сообщений")}`, {
    description: "По шаблону ответа — текст виден в диалоге и в хронологии записи",
  });
  if (tasks) toast(`Автоматизации поставили ${tasks} ${plural(tasks, "задачу", "задачи", "задач")} «Написать клиенту»`, {
    description: "Диалога в подключённом канале нет или шаблон не заполнился — напишите вручную",
  });
}

let started = false;
export function initAutomations() {
  if (started) return;
  started = true;
  ruleHooks.created = onCreated;
  ruleHooks.stage = onStage;
  window.setTimeout(() => scanAutomations(true), 2500); // после первичной загрузки данных — с отчётом
  window.setInterval(scanAutomations, 3600000);   // и раз в час
  window.setInterval(() => { void processOutbox(); }, 60000); // отложенные сообщения: «через час», утро после ночи
}

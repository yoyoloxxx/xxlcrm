// Перенос базы не должен воровать записи у пространства, куда их клали раньше.
// id строки — первичный ключ на всю таблицу: upsert по старому id не добавляет запись во второе
// пространство, а переносит её из первого. Проверяем план переезда: новые id и переписанные ссылки.
import { planTransfer } from "../src/lib/transfer.ts";

const results = [];
const ok = (n, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", n, extra]); console.log(cond ? "  ✓ " + n : "  ✗ " + n + " — " + String(extra).slice(0, 220)); };

const entities = [
  { id: "deals", name: "Сделка", namePlural: "Сделки", icon: "briefcase", titleFieldId: "title",
    fields: [{ id: "title", label: "Название", type: "text" }, { id: "contact", label: "Клиент", type: "relation", relationTo: "contacts" }] },
  { id: "contacts", name: "Клиент", namePlural: "Клиенты", icon: "contact", titleFieldId: "title",
    fields: [{ id: "title", label: "Имя", type: "text" }] },
];
const src = {
  entities,
  records: [
    { id: "r_c1", entityId: "contacts", num: 1, values: { title: "Мой клиент" }, ownerId: "u1", createdAt: 1, updatedAt: 1 },
    { id: "r_d1", entityId: "deals", num: 1, values: { title: "Моя сделка", contact: "r_c1" }, ownerId: "u1", createdAt: 2, updatedAt: 2 },
    { id: "r_demo", entityId: "deals", num: 2, values: { title: "Пример", contact: "r_c1" }, ownerId: "u1", createdAt: 3, updatedAt: 3, demo: true },
  ],
  tasks: [
    { id: "t1", title: "Позвонить", kind: "call", recordId: "r_d1", ownerId: "u1", done: false },
    { id: "t_demo", title: "Пример задачи", kind: "call", recordId: "r_demo", ownerId: "u1", done: false, demo: true },
    { id: "t_orphan", title: "Задача про пример", kind: "call", recordId: "r_demo", ownerId: "u1", done: false },
  ],
  activities: [
    { id: "a1", recordId: "r_d1", ts: 5, kind: "created", text: "Запись создана", userId: "u1" },
    { id: "a_demo", recordId: "r_demo", ts: 6, kind: "created", text: "Запись создана", userId: "u1" },
  ],
  chats: [
    { id: "c1", name: "Клиент в вотсапе", channel: "wa", recordId: "r_d1", unread: 0, msgs: [] },
    { id: "c_demo", name: "Пример диалога", channel: "tg", recordId: "r_demo", unread: 0, msgs: [], demo: true },
  ],
};

let n = 0;
const newId = p => `${p}_new${++n}`;
const plan = planTransfer(src, newId);

// ---------- A: примеры остаются дома ----------
ok("A1 примеры не едут", plan.records.length === 2, `записей ${plan.records.length}`);
ok("A2 демо-задача не едет", !plan.tasks.some(t => t.title === "Пример задачи"));
ok("A3 демо-диалог не едет", plan.chats.length === 1, `диалогов ${plan.chats.length}`);
ok("A4 история примеров не едет", plan.activities.length === 1, `истории ${plan.activities.length}`);

// ---------- B: новые id ----------
const oldIds = new Set(["r_c1", "r_d1", "r_demo", "t1", "t_orphan", "a1", "c1"]);
ok("B1 у записей новые id", plan.records.every(r => !oldIds.has(r.id)), plan.records.map(r => r.id).join(", "));
ok("B2 у задач новые id", plan.tasks.every(t => !oldIds.has(t.id)));
ok("B3 у истории новые id", plan.activities.every(a => !oldIds.has(a.id)));
ok("B4 у диалогов новые id", plan.chats.every(c => !oldIds.has(c.id)));
ok("B5 id не повторяются", new Set(plan.records.map(r => r.id)).size === plan.records.length);

// ---------- C: ссылки переписаны на новые id ----------
const newC1 = plan.map.get("r_c1"), newD1 = plan.map.get("r_d1");
const deal = plan.records.find(r => r.values.title === "Моя сделка");
ok("C1 поле-связь смотрит на новый id", deal.values.contact === newC1, `в поле ${deal.values.contact}, ждали ${newC1}`);
ok("C2 задача смотрит на новый id", plan.tasks.find(t => t.title === "Позвонить").recordId === newD1);
ok("C3 история смотрит на новый id", plan.activities[0].recordId === newD1);
ok("C4 диалог смотрит на новый id", plan.chats[0].recordId === newD1);
ok("C5 задача про пример едет без битой ссылки", plan.tasks.find(t => t.title === "Задача про пример")?.recordId === undefined);

// ---------- D: два переноса подряд дают РАЗНЫЕ id ----------
const again = planTransfer(src, newId);
const first = new Set(plan.records.map(r => r.id));
ok("D1 повторный перенос не занимает те же id", again.records.every(r => !first.has(r.id)),
  "иначе второй перенос утащил бы записи из первого пространства");

// ---------- E: содержимое не потерялось ----------
ok("E1 названия на месте", plan.records.map(r => r.values.title).sort().join("|") === "Мой клиент|Моя сделка");
ok("E2 ответственный и даты сохранены", plan.records.every(r => r.ownerId === "u1" && r.createdAt > 0));

const fails = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) process.exit(1);

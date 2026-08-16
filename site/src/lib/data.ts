// Конфигурация дефолтных разделов (Сделки + Клиенты) + демо-сиды. Остальные разделы пользователь добавляет сам.
import type { EntityCfg, Field, Option, Rec, Stage, Task, Activity, User, Chat, ReplyTemplate } from "./model";
import { uid, days, now } from "./model";

export const DEFAULT_TEMPLATES: ReplyTemplate[] = [
  { id: "tpl_hello", name: "Приветствие", text: "Здравствуйте, {имя}! Меня зовут {менеджер}. Получили вашу заявку — удобно будет созвониться сегодня?" },
  { id: "tpl_track", name: "Трек-номер СДЭК", text: "Добрый день, {имя}! Ваш заказ передан в СДЭК, трек-номер: {трек}. Отследить можно на cdek.ru/track" },
  { id: "tpl_pay", name: "Напоминание об оплате", text: "{имя}, напоминаем про счёт на {сумма} — как будет оплата, сразу стартуем следующий этап." },
  { id: "tpl_bday", name: "С днём рождения", text: "{имя}, поздравляем вас с днём рождения! 🎉 Дарим скидку 10% на следующий заказ — действует неделю." },
];

const opt = (label: string, color: string): Option => ({ id: "o_" + label.toLowerCase().replace(/[^a-zа-яё0-9]/g, ""), label, color });
const f = (id: string, label: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ id, label, type, inTable: true, ...extra });
const stg = (id: string, label: string, color: string, kind: Stage["kind"] = "open"): Stage => ({ id, label, color, kind });

export const USERS: User[] = [
  { id: "u1", name: "Глеб", role: "Владелец", hue: 42 },
  { id: "u2", name: "Марина", role: "Менеджер", hue: 152 },
  { id: "u3", name: "Артём", role: "Менеджер", hue: 210 },
];

export const ENTITIES: EntityCfg[] = [
  {
    id: "deals", name: "Сделка", namePlural: "Сделки", icon: "briefcase", titleFieldId: "title",
    fields: [
      f("title", "Название", "text", { required: true }),
      f("amount", "Сумма", "money", { required: true }),
      f("contact", "Клиент", "relation", { relationTo: "contacts" }),
      f("source", "Источник", "select", { options: [opt("Рекомендация", "#7D8A5C"), opt("Сайт", "#6E8B8A"), opt("Telegram", "#5C7A9E"), opt("Конференция", "#B0725A"), opt("Холодный звонок", "#8A8578")] }),
      f("track", "Трек-номер СДЭК", "text", { inTable: false }),
      f("deadline", "Дедлайн", "date", { inTable: false }),
      f("notes", "Комментарий", "textarea", { inTable: false }),
    ],
    stages: [
      stg("s_new", "Новая", "#8A8578"), stg("s_qual", "Квалификация", "#BC9F5C"),
      stg("s_neg", "Переговоры", "#B0725A"), stg("s_contract", "Договор", "#6E8B8A"),
      stg("s_won", "Оплачено", "#6E8B4F", "won"), stg("s_lost", "Проиграна", "#A8543F", "lost"),
    ],
  },
  {
    id: "contacts", name: "Клиент", namePlural: "Клиенты", icon: "contact", titleFieldId: "title",
    fields: [
      f("title", "Имя", "text", { required: true }),
      f("phone", "Телефон", "phone"),
      f("email", "Email", "email"),
      f("bday", "День рождения", "date", { inTable: false }),
      f("notes", "Комментарий", "textarea", { inTable: false }),
    ],
  },
];

export const entityCfg = (id: string) => ENTITIES.find(e => e.id === id)!;

// ---------- демо-сиды (создаются один раз, дальше живут в хранилище) ----------
export function seed(): { records: Rec[]; tasks: Task[]; activities: Activity[]; chats: Chat[] } {
  const records: Rec[] = [];
  const activities: Activity[] = [];
  let n: Record<string, number> = {};
  const rec = (entityId: string, values: Record<string, unknown>, o: { stage?: string; owner?: string; ago?: number } = {}) => {
    n[entityId] = (n[entityId] ?? 0) + 1;
    const createdAt = days(-(o.ago ?? 5));
    const r: Rec = {
      id: uid("r"), entityId, num: n[entityId], values,
      ownerId: o.owner ?? "u1", createdAt, updatedAt: createdAt,
      stageId: o.stage, stageAt: createdAt + 2 * 3600000,
    };
    records.push(r);
    activities.push({ id: uid("a"), recordId: r.id, ts: createdAt, kind: "created", text: "Запись создана", userId: r.ownerId });
    return r;
  };

  const y = new Date().getFullYear();
  const bd = (mon: number, day: number, yearBack: number) => new Date(y - yearBack, mon - 1, day, 12).getTime();
  const p = (t: string, phone: string, email: string, bday?: number) =>
    rec("contacts", { title: t, phone, email, ...(bday ? { bday } : {}) }, { ago: 15, owner: "u2" });
  const p1 = p("Виктор Гусев", "+7 931 502-18-46", "v.gusev@stroyteh.ru", bd(8, 24, 41));
  const p2 = p("Анна Волкова", "+7 934 771-20-84", "a.volkova@uyut.ru");
  const p3 = p("Дарья Киселёва", "+7 920 337-60-12", "kiseleva@medplus.ru");
  const p4 = p("Сергей Соколов", "+7 932 415-77-03", "s.sokolov@lab42.ru");
  const p5 = p("Ксения Макарова", "+7 961 208-44-91", "makarova@av.ru", bd(8, 19, 34));

  const d = (t: string, amount: number, contactId: string | undefined, source: string, stage: string, ago: number, owner = "u1") =>
    rec("deals", { title: t, amount, contact: contactId, source: "o_" + source }, { stage, ago, owner });
  d("Лендинг курса аналитики", 87000, undefined, "рекомендация", "s_new", 1, "u1");
  d("Сайт-каталог мебели", 412000, p2.id, "сайт", "s_new", 2, "u2");
  d("Брендинг клиники", 180000, p3.id, "telegram", "s_qual", 4, "u3");
  d("Поддержка на год", 540000, p4.id, "сайт", "s_qual", 6, "u2");
  const big = d("Портал для «СтройТех»", 1240000, p1.id, "рекомендация", "s_neg", 9, "u1");
  d("Мобильное приложение", 890000, undefined, "холодныйзвонок", "s_neg", 7, "u3");
  d("Интеграция с 1С", 310000, p5.id, "конференция", "s_contract", 12, "u1");
  d("Аудит маркетинга", 96000, undefined, "конференция", "s_won", 16, "u2");

  activities.push(
    { id: uid("a"), recordId: big.id, ts: days(-2), kind: "comment", text: "Клиент просит скидку 10%, обсуждаем этапность оплаты", userId: "u2" },
    { id: uid("a"), recordId: big.id, ts: days(-1), kind: "stage", text: "Стадия: Переговоры", userId: "u1" },
  );

  const tasks: Task[] = [
    { id: uid("t"), title: "Дожать: КП без ответа 3 дня", kind: "call", recordId: big.id, ownerId: "u2", due: now() - 20 * 3600000, done: false },
    { id: uid("t"), title: "Позвонить: обсудить смету этапа 2", kind: "call", recordId: records.find(r => r.values.title === "Поддержка на год")!.id, ownerId: "u1", due: now() + 3 * 3600000, done: false },
    { id: uid("t"), title: "Встреча по договору в Zoom", kind: "meet", recordId: records.find(r => r.values.title === "Интеграция с 1С")!.id, ownerId: "u1", due: now() + 26 * 3600000, done: false },
    { id: uid("t"), title: "Отправить материалы после звонка", kind: "msg", recordId: records.find(r => r.values.title === "Брендинг клиники")!.id, ownerId: "u3", due: now() + 6 * 3600000, done: false },
  ];

  const chat = (name: string, channel: Chat["channel"], recordId: string | undefined, msgs: [number, boolean, string][], unread = 0, phone?: string): Chat => ({
    id: uid("c"), name, channel, recordId, unread, phone,
    msgs: msgs.map(([agoH, out, text]) => ({ id: uid("m"), ts: now() - agoH * 3600000, out, text })),
  });
  const lend = records.find(r => r.values.title === "Лендинг курса аналитики")!;
  const chats: Chat[] = [
    chat("Максим Веретенников", "tg", lend.id, [
      [30, false, "Здравствуйте! Мне вас порекомендовали. Нужен лендинг для курса, бюджет ~90 тысяч. С чего начнём?"],
      [29, true, "Добрый день, Максим! Отличная задача. Расскажите пару слов о курсе — соберу структуру и предложение."],
      [5, false, "Курс по продуктовой аналитике, старт потока 15 сентября. Важно успеть за 2 недели."],
    ], 1, "+7 916 284-51-07"),
    chat("Ольга, «Клиника Мед+»", "wa", records.find(r => r.values.title === "Брендинг клиники")!.id, [
      [50, false, "Когда покажете варианты логотипа?"],
      [49, true, "В четверг пришлём три направления на выбор."],
    ], 0, "+7 920 865-64-65"),
    chat("Новый клиент (демо)", "tg", undefined, [
      [2, false, "Здравствуйте! Видел ваши работы, хочу обсудить сайт для автосервиса."],
    ], 1),
  ];

  return { records, tasks, activities, chats };
}

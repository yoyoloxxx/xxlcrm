// Шаблоны отраслей = конфигурации примитивов + демо-данные (даты относительны «сегодня»)
import type { Entity, Rec, Task, Activity, Automation, Widget, Workspace, User, Field, Chat } from "./model";
import { field, opt, stg, uid, pick, rnd, days, atHour, now, DAY } from "./model";

export interface TemplateMeta { key: string; icon: string; title: string; desc: string; entitiesHint: string }

export const TEMPLATE_META: TemplateMeta[] = [
  { key: "b2b", icon: "💼", title: "Отдел продаж B2B", desc: "Услуги, длинные сделки, компании и контакты", entitiesHint: "Сделки · Компании · Контакты" },
  { key: "shop", icon: "📦", title: "Интернет-магазин", desc: "Заказы по статусам, товары, каналы продаж", entitiesHint: "Заказы · Покупатели · Товары" },
  { key: "salon", icon: "💇‍♀️", title: "Салон / студия", desc: "Записи в календаре, услуги, абонементы", entitiesHint: "Записи · Клиенты · Услуги" },
  { key: "agency", icon: "🎨", title: "Агентство / фриланс", desc: "Лиды, проекты с дедлайнами и бюджетами", entitiesHint: "Лиды · Проекты · Клиенты" },
  { key: "realty", icon: "🏠", title: "Недвижимость", desc: "Объекты, показы, сделки, подбор", entitiesHint: "Объекты · Клиенты · Показы" },
  { key: "blank", icon: "✨", title: "С нуля", desc: "Пустое пространство: собери свою систему сам", entitiesHint: "1 раздел «Контакты» для старта" },
];

export const USERS: User[] = [
  { id: "u1", name: "Глеб", role: "Владелец", hue: 42 },
  { id: "u2", name: "Марина", role: "Менеджер", hue: 152 },
  { id: "u3", name: "Артём", role: "Менеджер", hue: 210 },
];

const PEOPLE = ["Иван Петров", "Мария Смирнова", "Дмитрий Козлов", "Анна Волкова", "Сергей Соколов", "Ольга Морозова", "Павел Лебедев", "Елена Новикова", "Никита Фёдоров", "Дарья Киселёва", "Алексей Орлов", "Ксения Макарова", "Роман Захаров", "Наталья Белова", "Виктор Гусев", "Полина Ершова"];
const name2 = () => pick(PEOPLE);
const phone = () => `+7 9${Math.floor(rnd() * 90 + 10)} ${Math.floor(rnd() * 900 + 100)}-${Math.floor(rnd() * 90 + 10)}-${Math.floor(rnd() * 90 + 10)}`;
const mail = (n: string) => n.split(" ")[0].toLowerCase().replace(/[^a-zа-я]/g, "") + Math.floor(rnd() * 90 + 9) + "@mail.ru";

class B {
  entities: Entity[] = []; records: Rec[] = []; tasks: Task[] = []; acts: Activity[] = []; autos: Automation[] = []; widgets: Widget[] = []; chats: Chat[] = [];
  chat(name: string, channel: Chat["channel"], msgs: [number, boolean, string][], recordId?: string, unread = 0) {
    this.chats.push({
      id: uid("c"), name, channel, recordId, unread, phone: phone(),
      msgs: msgs.map(([agoH, out, text]) => ({ id: uid("m"), ts: now() - agoH * 3600000, out, text })),
    });
  }
  ent(name: string, namePlural: string, icon: string, color: string, fields: Field[], stages?: ReturnType<typeof stg>[], views?: Entity["views"]) {
    const e: Entity = {
      id: uid("e"), name, namePlural, icon, color, fields, titleFieldId: fields[0].id,
      pipeline: stages ? { stages } : undefined,
      views: views ?? [{ id: uid("v"), name: "Таблица", type: "table", sort: null }],
    };
    this.entities.push(e); return e;
  }
  rec(e: Entity, values: Record<string, unknown>, o: { stage?: number; owner?: string; ago?: number } = {}) {
    const createdAt = days(-(o.ago ?? Math.floor(rnd() * 25)));
    const r: Rec = {
      id: uid("r"), entityId: e.id, num: this.records.filter(x => x.entityId === e.id).length + 1,
      values, ownerId: o.owner ?? pick(USERS).id, createdAt, updatedAt: createdAt,
      stageId: e.pipeline ? e.pipeline.stages[Math.min(o.stage ?? 0, e.pipeline.stages.length - 1)].id : undefined,
      stageAt: createdAt + Math.floor(rnd() * 3) * DAY,
    };
    this.records.push(r);
    this.acts.push({ id: uid("a"), recordId: r.id, ts: createdAt, kind: "created", text: "Запись создана", userId: r.ownerId });
    return r;
  }
  task(title: string, kind: Task["kind"], recordId: string | undefined, dueOffsetH: number, owner?: string, done = false) {
    this.tasks.push({ id: uid("t"), title, kind, recordId, ownerId: owner ?? pick(USERS).id, due: now() + dueOffsetH * 3600000, done, doneAt: done ? now() - DAY : undefined });
  }
  comment(r: Rec, text: string, agoH: number, userId = "u1") {
    this.acts.push({ id: uid("a"), recordId: r.id, ts: now() - agoH * 3600000, kind: "comment", text, userId });
  }
  auto(a: Omit<Automation, "id" | "fired" | "enabled"> & { enabled?: boolean }) {
    this.autos.push({ id: uid("au"), fired: Math.floor(rnd() * 9 + 2), enabled: true, ...a });
  }
  w(w: Omit<Widget, "id">) { this.widgets.push({ id: uid("w"), ...w }); }
}

const vKanban = () => ({ id: uid("v"), name: "Канбан", type: "kanban" as const, sort: null });
const vTable = () => ({ id: uid("v"), name: "Таблица", type: "table" as const, sort: null });
const vCal = (dateFieldId: string) => ({ id: uid("v"), name: "Календарь", type: "calendar" as const, dateFieldId, sort: null });
const vCards = () => ({ id: uid("v"), name: "Карточки", type: "cards" as const, sort: null });

// ---------- B2B ----------
function b2b(b: B) {
  const fSphere = field("Сфера", "select", { options: ["IT", "Медицина", "Ритейл", "Производство", "Стройка"].map(opt) });
  const companies = b.ent("Компания", "Компании", "🏢", "#8A8578", [
    field("Название", "text", { required: true }), fSphere, field("Город", "text"), field("Сайт", "url"), field("Телефон", "phone"), field("Комментарий", "textarea", { inTable: false }),
  ]);
  const contacts = b.ent("Контакт", "Контакты", "👤", "#6E8B8A", [
    field("Имя", "text", { required: true }), field("Должность", "text"), field("Телефон", "phone"), field("Email", "email"),
    field("Компания", "relation", { relationTo: companies.id }),
  ]);
  const fSum = field("Сумма", "money", { required: true });
  const fSrc = field("Источник", "select", { options: ["Сайт", "Рекомендация", "Telegram", "Холодный звонок", "Конференция"].map(opt) });
  const fCompany = field("Компания", "relation", { relationTo: companies.id });
  const fContact = field("Контакт", "relation", { relationTo: contacts.id });
  const fLoss = field("Причина проигрыша", "select", { inTable: false, options: ["Дорого", "Ушли к конкуренту", "Не ответили", "Отложили"].map(opt) });
  const deals = b.ent("Сделка", "Сделки", "💼", "#BC9F5C",
    [field("Название", "text", { required: true }), fSum, fCompany, fContact, fSrc, field("Комментарий", "textarea", { inTable: false }), fLoss],
    [stg("Новая", 0), stg("Квалификация", 4), stg("КП отправлено", 1), stg("Переговоры", 3), stg("Договор", 7), stg("Оплачено", 0, "won"), stg("Проиграна", 0, "lost")],
    [vKanban(), vTable()]);

  const comps = ["Азбука Вкуса", "СтройТех", "Клиника «Мед+»", "ГК Модуль", "Лаборатория 42", "ТК Восток", "Фабрика Уюта", "Digital Loft"].map((n, i) =>
    b.rec(companies, { [companies.fields[0].id]: n, [fSphere.id]: pick(fSphere.options!).id, [companies.fields[2].id]: pick(["Москва", "СПб", "Казань", "Екатеринбург"]), [companies.fields[4].id]: phone() }, { ago: 30 - i * 3 }));
  const conts = Array.from({ length: 10 }, () => { const nm = name2(); return b.rec(contacts, { [contacts.fields[0].id]: nm, [contacts.fields[1].id]: pick(["Директор", "Маркетолог", "ИТ-директор", "Закупки"]), [contacts.fields[2].id]: phone(), [contacts.fields[3].id]: mail(nm), [contacts.fields[4].id]: pick(comps).id }); });

  const dealNames = ["Сайт под ключ", "CRM-внедрение", "Брендинг", "Поддержка на год", "Лендинг + реклама", "Мобильное приложение", "Аудит маркетинга", "Интернет-магазин", "SEO-продвижение", "Корпоративный портал", "Чат-бот для продаж", "Редизайн сайта", "Интеграция с 1С", "Видео-продакшн"];
  dealNames.forEach((nm, i) => {
    const r = b.rec(deals, {
      [deals.fields[0].id]: nm, [fSum.id]: (Math.floor(rnd() * 46) + 6) * 10000,
      [fCompany.id]: pick(comps).id, [fContact.id]: pick(conts).id, [fSrc.id]: pick(fSrc.options!).id,
    }, { stage: [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5, 6, 1][i], ago: [0, 1, 3, 5, 6, 8, 4, 10, 12, 9, 14, 20, 16, 2][i] });
    if (i === 6) b.comment(r, "Клиент просит скидку 10%, обсуждаем этапность оплаты", 5, "u2");
    if (i === 3) b.comment(r, "Отправил КП, обещали ответ до пятницы", 26, "u3");
  });
  const d = (i: number) => b.records.filter(r => r.entityId === deals.id)[i];
  b.task("Позвонить: обсудить КП", "call", d(4).id, 2, "u2");
  b.task("Встреча по договору в Zoom", "meet", d(9).id, 26, "u1");
  b.task("Дожать: без ответа 3 дня", "call", d(7).id, -20, "u3");
  b.task("Отправить закрывающие документы", "todo", d(10).id, 50, "u2");
  b.task("Написать в Telegram: напомнить о встрече", "msg", d(6).id, 4, "u1");
  b.task("Квалифицировать заявку с сайта", "call", d(1).id, -3, "u2");

  b.auto({ name: "Новая сделка → связаться за час", entityId: deals.id, trigger: "record.created", actions: [{ kind: "task", title: "Связаться с клиентом в течение часа", inDays: 0, taskKind: "call" }] });
  b.auto({ name: "«Переговоры» 3 дня без движения → задача", entityId: deals.id, trigger: "stale", stageId: deals.pipeline!.stages[3].id, days: 3, actions: [{ kind: "task", title: "Сделка застряла: позвонить и продвинуть", inDays: 0, taskKind: "call" }] });
  b.auto({ name: "Оплата получена → поздравить команду", entityId: deals.id, trigger: "stage.changed", stageId: deals.pipeline!.stages[5].id, actions: [{ kind: "notify", text: "🎉 Сделка оплачена! Отличная работа" }] });

  b.w({ type: "number", title: "В работе, сумма", entityId: deals.id, metric: "sum", fieldId: fSum.id, openOnly: true });
  b.w({ type: "plan", title: "План месяца", entityId: deals.id, fieldId: fSum.id, target: 1500000, period: "month" });
  b.w({ type: "funnel", title: "Воронка продаж", entityId: deals.id });
  b.w({ type: "bars", title: "Сделки по источникам", entityId: deals.id, groupFieldId: fSrc.id });
  b.w({ type: "number", title: "Новых за неделю", entityId: deals.id, metric: "count", period: "week" });
  b.w({ type: "activity", title: "Последние события" });

  companies.fields.push(field("Сделки, сумма", "rollup", { rollup: { entityId: deals.id, viaFieldId: fCompany.id, agg: "sum", targetFieldId: fSum.id } }));
  const deal0 = b.records.filter(r => r.entityId === deals.id);
  b.chat("Иван Петров", "tg", [[30, false, "Добрый день! Видел ваш кейс с интернет-магазином, хотим похожее"], [29, true, "Здравствуйте! Расскажите пару слов о проекте — соберу предложение"], [5, false, "Отправил бриф на почту, гляньте пожалуйста 🙏"]], deal0[4]?.id, 1);
  b.chat("Ольга, Клиника «Мед+»", "wa", [[50, false, "Когда сможете показать первую версию сайта?"], [49, true, "К пятнице пришлём ссылку на тест"], [26, false, "Отлично, ждём!"]], deal0[5]?.id);
  b.chat("Максим (по рекомендации)", "tg", [[2, false, "Здравствуйте! Мне вас порекомендовали. Нужен лендинг для курса, бюджет ~80к. С чего начнём?"]], undefined, 1);
  return deals.id;
}

// ---------- Интернет-магазин ----------
function shop(b: B) {
  const fSeg = field("Сегмент", "select", { options: ["Новый", "Постоянный", "VIP"].map(opt) });
  const buyers = b.ent("Покупатель", "Покупатели", "🛍️", "#8B6E86", [
    field("Имя", "text", { required: true }), field("Телефон", "phone"), field("Email", "email"), field("Город", "text"), fSeg,
  ]);
  const fPrice = field("Цена", "money");
  const fCat = field("Категория", "select", { options: ["Одежда", "Обувь", "Аксессуары", "Дом"].map(opt) });
  const goods = b.ent("Товар", "Товары", "🧺", "#7D8A5C", [
    field("Название", "text", { required: true }), fPrice, field("Остаток", "number"), fCat,
  ]);
  const fSum = field("Сумма", "money", { required: true });
  const fBuyer = field("Покупатель", "relation", { relationTo: buyers.id });
  const fChan = field("Канал", "select", { options: ["Сайт", "Telegram", "WhatsApp", "Avito", "Маркетплейс"].map(opt) });
  const fShip = field("Доставка", "select", { options: ["СДЭК", "Почта", "Курьер", "Самовывоз"].map(opt) });
  const orders = b.ent("Заказ", "Заказы", "📦", "#BC9F5C",
    [field("Заказ", "text", { required: true }), fSum, fBuyer, fChan, fShip, field("Трек-номер", "text", { inTable: false }), field("Состав", "tags", { inTable: false })],
    [stg("Новый", 0), stg("Подтверждён", 4), stg("Собран", 1), stg("Отправлен", 5), stg("Доставлен", 0, "won"), stg("Возврат", 0, "lost")],
    [vKanban(), vTable()]);

  const bs = Array.from({ length: 9 }, () => { const nm = name2(); return b.rec(buyers, { [buyers.fields[0].id]: nm, [buyers.fields[1].id]: phone(), [buyers.fields[2].id]: mail(nm), [buyers.fields[3].id]: pick(["Москва", "СПб", "Новосибирск", "Краснодар"]), [fSeg.id]: pick(fSeg.options!).id }); });
  ["Пальто «Осло»", "Кеды White 42", "Свитер оверсайз", "Сумка-шоппер", "Плед из хлопка", "Джинсы Slim", "Ремень кожаный", "Ботинки Chelsea"].forEach((g, i) =>
    b.rec(goods, { [goods.fields[0].id]: g, [fPrice.id]: (Math.floor(rnd() * 80) + 15) * 100, [goods.fields[2].id]: Math.floor(rnd() * 40), [fCat.id]: fCat.options![i % 4].id }));
  for (let i = 0; i < 15; i++) {
    const r = b.rec(orders, {
      [orders.fields[0].id]: `Заказ #${1041 + i}`, [fSum.id]: (Math.floor(rnd() * 120) + 18) * 100,
      [fBuyer.id]: pick(bs).id, [fChan.id]: pick(fChan.options!).id, [fShip.id]: pick(fShip.options!).id,
    }, { stage: [0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 1][i], ago: [0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 8, 10, 7, 0][i] });
    if (i === 7) b.comment(r, "Клиент просил доставку после 18:00", 20, "u2");
  }
  const o = (i: number) => b.records.filter(r => r.entityId === orders.id)[i];
  b.task("Подтвердить заказ по телефону", "call", o(0).id, 1, "u2");
  b.task("Отправить трек-номер в WhatsApp", "msg", o(7).id, 3, "u3");
  b.task("Собрать заказ до 15:00", "todo", o(4).id, -2, "u2");
  b.task("Уточнить размер у клиента", "msg", o(2).id, 5, "u1");

  b.auto({ name: "Новый заказ → подтвердить за 30 минут", entityId: orders.id, trigger: "record.created", actions: [{ kind: "task", title: "Подтвердить заказ", inDays: 0, taskKind: "call" }] });
  b.auto({ name: "Отправлен → написать клиенту трек", entityId: orders.id, trigger: "stage.changed", stageId: orders.pipeline!.stages[3].id, actions: [{ kind: "task", title: "Отправить трек-номер клиенту", inDays: 0, taskKind: "msg" }, { kind: "notify", text: "Заказ отправлен — не забудь трек-номер" }] });

  b.w({ type: "number", title: "Заказов сегодня", entityId: orders.id, metric: "count", period: "today" });
  b.w({ type: "number", title: "Выручка месяца", entityId: orders.id, metric: "sum", fieldId: fSum.id, period: "month" });
  b.w({ type: "bars", title: "Заказы по каналам", entityId: orders.id, groupFieldId: fChan.id });
  b.w({ type: "funnel", title: "Путь заказа", entityId: orders.id });
  b.w({ type: "activity", title: "Последние события" });

  buyers.fields.push(field("Покупок на сумму", "rollup", { rollup: { entityId: orders.id, viaFieldId: fBuyer.id, agg: "sum", targetFieldId: fSum.id } }));
  const ord = b.records.filter(r => r.entityId === orders.id);
  b.chat("Дарья Киселёва", "wa", [[28, false, "Здравствуйте! А пальто «Осло» есть в размере S?"], [27, true, "Добрый день! Да, есть 2 штуки. Оформить?"], [4, false, "Да, давайте! И покажите ещё сумки"]], ord[2]?.id, 1);
  b.chat("Никита Фёдоров", "tg", [[52, false, "Где мой заказ #1046? Обещали вчера"], [51, true, "Проверяю у курьера, отвечу в течение часа"], [50, true, "Заказ будет сегодня до 18:00, приносим извинения за задержку"]], ord[5]?.id);
  b.chat("Новый клиент с Avito", "max", [[1, false, "Здравствуйте, кеды White 42 ещё в наличии? Заберу сегодня"]], undefined, 1);
  return orders.id;
}

// ---------- Салон ----------
function salon(b: B) {
  const clients = b.ent("Клиент", "Клиенты", "🌸", "#8B6E86", [
    field("Имя", "text", { required: true }), field("Телефон", "phone"), field("День рождения", "date", { inTable: false }),
    field("Сегмент", "select", { options: ["Новый", "Постоянный", "VIP"].map(opt) }), field("Заметки", "textarea", { inTable: false }),
  ]);
  const fPrice = field("Цена", "money");
  const services = b.ent("Услуга", "Услуги", "✂️", "#7D8A5C", [
    field("Название", "text", { required: true }), fPrice, field("Длительность, мин", "number"),
    field("Категория", "select", { options: ["Волосы", "Ногти", "Брови", "Косметология"].map(opt) }),
  ]);
  const fClient = field("Клиент", "relation", { relationTo: clients.id, required: true });
  const fServ = field("Услуга", "relation", { relationTo: services.id });
  const fWhen = field("Дата и время", "datetime", { required: true });
  const fMaster = field("Мастер", "user");
  const fCost = field("Стоимость", "money");
  const visits = b.ent("Запись", "Записи", "📅", "#BC9F5C",
    [field("Запись", "text", { required: true }), fClient, fServ, fWhen, fMaster, fCost, field("Комментарий", "textarea", { inTable: false })],
    [stg("Запланирована", 5), stg("Клиент пришёл", 1), stg("Оплачена", 0, "won"), stg("Не пришёл", 0, "lost")],
    [vCal(fWhen.id), vKanban(), vTable()]);
  const subs = b.ent("Абонемент", "Абонементы", "🎟️", "#6E8B8A", [
    field("Абонемент", "text", { required: true }), field("Клиент", "relation", { relationTo: clients.id }),
    field("Осталось посещений", "number"), field("Действует до", "date"),
  ]);

  const cls = Array.from({ length: 10 }, () => { const nm = name2(); return b.rec(clients, { [clients.fields[0].id]: nm, [clients.fields[1].id]: phone(), [clients.fields[3].id]: pick(clients.fields[3].options!).id }); });
  const svs = [["Стрижка + укладка", 2500, 60], ["Окрашивание", 6500, 150], ["Маникюр с покрытием", 2800, 90], ["Коррекция бровей", 1200, 30], ["Чистка лица", 3900, 60], ["Вечерняя причёска", 3500, 90]].map(([n, p, d], i) =>
    b.rec(services, { [services.fields[0].id]: n, [fPrice.id]: p, [services.fields[2].id]: d, [services.fields[3].id]: services.fields[3].options![i % 4].id }));
  const slots = [[-1, 11], [-1, 15], [0, 10], [0, 12], [0, 16], [0, 18], [1, 10], [1, 13], [1, 17], [2, 11], [2, 14], [3, 12], [4, 15], [5, 10]];
  slots.forEach(([dOff, h], i) => {
    const c = pick(cls), s = pick(svs);
    b.rec(visits, {
      [visits.fields[0].id]: "", [fClient.id]: c.id, [fServ.id]: s.id,
      [fWhen.id]: atHour(dOff, h), [fMaster.id]: pick(["u1", "u2", "u3"]), [fCost.id]: s.values[fPrice.id],
    }, { stage: dOff < 0 ? (i % 3 === 0 ? 3 : 2) : 0, ago: Math.max(0, -dOff + 1), owner: "u2" });
  });
  cls.slice(0, 3).forEach((c, i) => b.rec(subs, { [subs.fields[0].id]: pick(["Маникюр ×5", "Укладка ×10"]), [subs.fields[1].id]: c.id, [subs.fields[2].id]: 5 - i, [subs.fields[3].id]: days(30 + i * 10) }));
  const v = (i: number) => b.records.filter(r => r.entityId === visits.id)[i];
  b.task("Подтвердить запись на завтра", "call", v(6).id, 3, "u2");
  b.task("Напомнить о записи в WhatsApp", "msg", v(4).id, 1, "u2");
  b.task("Перезвонить: не пришла вчера", "call", v(0).id, -4, "u3");

  b.auto({ name: "Новая запись → напоминание клиенту за 2 часа", entityId: visits.id, trigger: "record.created", actions: [{ kind: "task", title: "Напомнить клиенту о записи", inDays: 0, taskKind: "msg" }] });
  b.auto({ name: "«Не пришёл» → перезвонить и перенести", entityId: visits.id, trigger: "stage.changed", stageId: visits.pipeline!.stages[3].id, actions: [{ kind: "task", title: "Позвонить, предложить перенос записи", inDays: 0, taskKind: "call" }] });

  b.w({ type: "number", title: "Записей сегодня", entityId: visits.id, metric: "count", period: "today" });
  b.w({ type: "number", title: "Выручка недели", entityId: visits.id, metric: "sum", fieldId: fCost.id, period: "week" });
  b.w({ type: "bars", title: "Загрузка мастеров", entityId: visits.id, groupFieldId: fMaster.id });
  b.w({ type: "funnel", title: "Статусы записей", entityId: visits.id });
  b.w({ type: "activity", title: "Последние события" });

  clients.fields.push(field("Визитов", "rollup", { rollup: { entityId: visits.id, viaFieldId: fClient.id, agg: "count" } }));
  const vs = b.records.filter(r => r.entityId === visits.id);
  b.chat("Ксения Макарова", "wa", [[26, false, "Добрый день! Можно перенести завтрашнюю запись на 17:00?"], [25, true, "Здравствуйте! Да, перенесла на 17:00, ждём вас 💛"]], vs[6]?.id, 1);
  b.chat("Новая клиентка (Instagram)", "tg", [[3, false, "Здравствуйте! Хочу окрашивание, сколько стоит и когда есть окошки?"]], undefined, 1);
  return visits.id;
}

// ---------- Агентство ----------
function agency(b: B) {
  const clients = b.ent("Клиент", "Клиенты", "🤝", "#6E8B8A", [
    field("Название", "text", { required: true }), field("Контакт", "text"), field("Телефон", "phone"), field("Email", "email"),
  ]);
  const fBud = field("Бюджет", "money");
  const fSrc = field("Источник", "select", { options: ["Сайт", "Рекомендация", "Telegram", "Биржа"].map(opt) });
  const leads = b.ent("Лид", "Лиды", "📨", "#B0725A",
    [field("Запрос", "text", { required: true }), fBud, fSrc, field("Телефон", "phone"), field("Комментарий", "textarea", { inTable: false })],
    [stg("Новый", 0), stg("Созвон", 4), stg("КП", 1), stg("Договор", 0, "won"), stg("Отказ", 0, "lost")],
    [vKanban(), vTable()]);
  const fClient = field("Клиент", "relation", { relationTo: clients.id });
  const fDead = field("Дедлайн", "date");
  const fServ = field("Направление", "select", { options: ["Сайт", "Брендинг", "SMM", "Реклама", "Видео"].map(opt) });
  const projects = b.ent("Проект", "Проекты", "🗂️", "#BC9F5C",
    [field("Проект", "text", { required: true }), fClient, field("Бюджет", "money"), fDead, fServ, field("Предоплата", "checkbox")],
    [stg("Бриф", 0), stg("В работе", 4), stg("Ревью", 1), stg("Сдан", 0, "won"), stg("Отменён", 0, "lost")],
    [vKanban(), vTable(), vCards()]);

  const cs = ["Кофейня «Зерно»", "Фитнес-клуб Pulse", "Школа танцев Vibe", "Барбершоп Kontora", "ЖК «Ясная поляна»", "Vetro Design"].map(n =>
    b.rec(clients, { [clients.fields[0].id]: n, [clients.fields[1].id]: name2(), [clients.fields[2].id]: phone() }));
  ["Лендинг открытия", "Реклама в Telegram", "Ребрендинг", "SMM на 3 месяца", "Видеоролик 30 сек", "Сайт-каталог", "Фирменный стиль"].forEach((nm, i) =>
    b.rec(leads, { [leads.fields[0].id]: nm, [fBud.id]: (Math.floor(rnd() * 25) + 4) * 10000, [fSrc.id]: pick(fSrc.options!).id, [leads.fields[3].id]: phone() }, { stage: [0, 0, 1, 1, 2, 3, 4][i], ago: [0, 1, 2, 4, 6, 12, 9][i] }));
  const pj = ["Сайт для «Зерно»", "SMM Pulse: август", "Айдентика Kontora", "Кампания ЖК", "Ролик Vetro"].map((nm, i) =>
    b.rec(projects, { [projects.fields[0].id]: nm, [fClient.id]: cs[i].id, [projects.fields[2].id]: (Math.floor(rnd() * 40) + 8) * 10000, [fDead.id]: days(3 + i * 5), [fServ.id]: pick(fServ.options!).id, [projects.fields[5].id]: rnd() > 0.4 }, { stage: [1, 1, 2, 0, 1][i], ago: 6 + i * 2 }));
  b.comment(pj[0], "Клиент утвердил макет главной, верстаем", 8, "u3");
  b.task("Созвон по брифу", "meet", pj[3].id, 22, "u1");
  b.task("Отправить макеты на ревью", "todo", pj[2].id, 4, "u3");
  b.task("Позвонить по лиду «Ребрендинг»", "call", b.records.filter(r => r.entityId === leads.id)[2].id, -6, "u2");

  b.auto({ name: "Новый лид → связаться за час", entityId: leads.id, trigger: "record.created", actions: [{ kind: "task", title: "Связаться с лидом", inDays: 0, taskKind: "call" }] });
  b.auto({ name: "Проект «Ревью» 2 дня → напомнить", entityId: projects.id, trigger: "stale", stageId: projects.pipeline!.stages[2].id, days: 2, actions: [{ kind: "task", title: "Дожать ревью с клиентом", inDays: 0, taskKind: "msg" }] });

  b.w({ type: "number", title: "Проектов в работе", entityId: projects.id, metric: "count", openOnly: true });
  b.w({ type: "number", title: "Портфель, сумма", entityId: projects.id, metric: "sum", fieldId: projects.fields[2].id, openOnly: true });
  b.w({ type: "funnel", title: "Воронка лидов", entityId: leads.id });
  b.w({ type: "bars", title: "Проекты по направлениям", entityId: projects.id, groupFieldId: fServ.id });
  b.w({ type: "activity", title: "Последние события" });

  clients.fields.push(field("Проектов на сумму", "rollup", { rollup: { entityId: projects.id, viaFieldId: fClient.id, agg: "sum", targetFieldId: projects.fields[2].id } }));
  b.chat("Кофейня «Зерно»", "tg", [[30, false, "Посмотрели макет — очень нравится! Пара правок в шапке"], [29, true, "Супер! Пришлите правки списком, внесём до завтра"], [6, false, "Отправил в общий чат 👌"]], pj[0]?.id, 1);
  b.chat("Барбершоп Kontora", "wa", [[80, false, "Когда покажете варианты логотипа?"], [79, true, "В четверг три направления на выбор"]], pj[2]?.id);
  return projects.id;
}

// ---------- Недвижимость ----------
function realty(b: B) {
  const fType = field("Тип", "select", { options: ["1-комн", "2-комн", "3-комн", "Дом", "Коммерция"].map(opt) });
  const fArea = field("Район", "select", { options: ["Центр", "Север", "Юг", "Запад", "Пригород"].map(opt) });
  const fStatus = field("Статус", "select", { options: ["В продаже", "Резерв", "Продан"].map(opt) });
  const objects = b.ent("Объект", "Объекты", "🏠", "#5C7A9E", [
    field("Адрес", "text", { required: true }), fType, field("Цена", "money"), field("Площадь, м²", "number"), fArea, fStatus,
  ], undefined, [vTable(), vCards()]);
  const fBudget = field("Бюджет до", "money");
  const clients = b.ent("Клиент", "Клиенты", "👥", "#6E8B8A", [
    field("Имя", "text", { required: true }), field("Телефон", "phone"), fBudget,
    field("Ищет", "select", { options: ["1-комн", "2-комн", "3-комн", "Дом"].map(opt) }),
  ]);
  const fCl = field("Клиент", "relation", { relationTo: clients.id });
  const fObj = field("Объект", "relation", { relationTo: objects.id });
  const fWhen = field("Дата показа", "datetime");
  const shows = b.ent("Показ", "Показы", "🔑", "#BC9F5C",
    [field("Показ", "text", { required: true }), fCl, fObj, fWhen],
    [stg("Назначен", 5), stg("Проведён", 1), stg("Аванс", 0, "won"), stg("Отказ", 0, "lost")],
    [vCal(fWhen.id), vKanban(), vTable()]);

  const objs = ["ул. Лесная 12, кв 45", "пр. Мира 8, кв 12", "ул. Садовая 3, кв 78", "КП «Сосны», дом 7", "ул. Новая 21, кв 5", "наб. Реки 14, кв 33", "ул. Полевая 2, офис 4"].map((a, i) =>
    b.rec(objects, { [objects.fields[0].id]: a, [fType.id]: fType.options![i % 5].id, [objects.fields[2].id]: (Math.floor(rnd() * 70) + 45) * 100000, [objects.fields[3].id]: Math.floor(rnd() * 70) + 32, [fArea.id]: pick(fArea.options!).id, [fStatus.id]: fStatus.options![i === 6 ? 2 : i % 2 === 0 ? 0 : 0].id }));
  const cls = Array.from({ length: 7 }, () => { const nm = name2(); return b.rec(clients, { [clients.fields[0].id]: nm, [clients.fields[1].id]: phone(), [fBudget.id]: (Math.floor(rnd() * 60) + 50) * 100000, [clients.fields[3].id]: pick(clients.fields[3].options!).id }); });
  [[0, 12], [0, 17], [1, 11], [1, 15], [2, 13], [-1, 16], [-2, 12]].forEach(([dOff, h], i) => {
    b.rec(shows, { [shows.fields[0].id]: "", [fCl.id]: pick(cls).id, [fObj.id]: pick(objs).id, [fWhen.id]: atHour(dOff, h) }, { stage: dOff < 0 ? (i % 2 ? 1 : 3) : 0, ago: Math.max(0, -dOff), owner: pick(["u2", "u3"]) });
  });
  const s = (i: number) => b.records.filter(r => r.entityId === shows.id)[i];
  b.task("Подтвердить показ на Лесной", "call", s(0).id, 2, "u2");
  b.task("Подготовить подборку для клиента", "todo", cls[1].id, 6, "u3");
  b.task("Перезвонить после показа", "call", s(5).id, -12, "u2");

  b.auto({ name: "Показ проведён → взять обратную связь", entityId: shows.id, trigger: "stage.changed", stageId: shows.pipeline!.stages[1].id, actions: [{ kind: "task", title: "Позвонить: впечатления от показа", inDays: 1, taskKind: "call" }] });

  b.w({ type: "number", title: "Объектов в продаже", entityId: objects.id, metric: "count" });
  b.w({ type: "number", title: "Показов на неделе", entityId: shows.id, metric: "count", period: "week" });
  b.w({ type: "bars", title: "Объекты по районам", entityId: objects.id, groupFieldId: fArea.id });
  b.w({ type: "funnel", title: "Показы → авансы", entityId: shows.id });
  b.w({ type: "activity", title: "Последние события" });

  clients.fields.push(field("Показов", "rollup", { rollup: { entityId: shows.id, viaFieldId: fCl.id, agg: "count" } }));
  b.chat("Покупатель: Лесная 12", "wa", [[20, false, "Добрый день! Подтверждаю показ на сегодня"], [19, true, "Отлично, встречаемся у подъезда за 5 минут"]], b.records.filter(r => r.entityId === shows.id)[0]?.id),
  b.chat("Собственник, пр. Мира 8", "tg", [[3, false, "Есть ли новые просмотры по моей квартире? Готов немного подвинуться по цене"]], undefined, 1);
  return objects.id;
}

function blank(b: B) {
  const contacts = b.ent("Контакт", "Контакты", "👤", "#8A8578", [
    field("Имя", "text", { required: true }), field("Телефон", "phone"), field("Email", "email"), field("Комментарий", "textarea", { inTable: false }),
  ]);
  b.rec(contacts, { [contacts.fields[0].id]: "Первый контакт (пример)", [contacts.fields[1].id]: phone() }, { ago: 0, owner: "u1" });
  b.w({ type: "number", title: "Всего контактов", entityId: contacts.id, metric: "count" });
  b.w({ type: "activity", title: "Последние события" });
  return contacts.id;
}

export function buildWorkspace(key: string, wsName: string): { ws: Workspace; firstEntityId: string } {
  const b = new B();
  const fn = { b2b, shop, salon, agency, realty, blank }[key as "b2b"] ?? blank;
  const firstEntityId = fn(b);
  return {
    ws: {
      name: wsName || TEMPLATE_META.find(t => t.key === key)?.title || "Моя компания",
      templateKey: key, entities: b.entities, records: b.records, tasks: b.tasks,
      activities: b.acts, automations: b.autos, widgets: b.widgets, users: USERS, chats: b.chats, notices: [
        { id: uid("n"), ts: now() - 3600000, text: "Добро пожаловать в XXLcrm! Это демо-стенд: все данные вымышлены.", icon: "👋" },
      ],
    },
    firstEntityId,
  };
}

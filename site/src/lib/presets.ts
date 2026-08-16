// Пресеты ниш: «выбери профиль бизнеса — получи почти готовую CRM».
// Каждый пресет переопределяет два базовых раздела (deals + contacts — id СОХРАНЯЕМ, от них зависят
// дедуп по телефону, привязка диалогов, связки записей), задаёт воронку, автоматизации и демо-данные.
import type { EntityCfg, Field, Option, Rec, Rule, Task, Activity, Chat, Channel, Stage } from "./model";
import { uid, days, now } from "./model";

const opt = (label: string, color: string): Option => ({ id: "o_" + label.toLowerCase().replace(/[^a-zа-яё0-9]/g, ""), label, color });
const f = (id: string, label: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ id, label, type, inTable: true, ...extra });
const stg = (id: string, label: string, color: string, kind: Stage["kind"] = "open"): Stage => ({ id, label, color, kind });

// каналы продаж — общие опции для поля «Канал». Держим id = "source", чтобы работали автолид (входящее
// само проставляет канал) и блок «Источники» на дашборде.
const CHANNELS = [opt("Telegram", "#5C7A9E"), opt("WhatsApp", "#6E8B4F"), opt("Instagram", "#A8547C"), opt("Тильда", "#B0725A")];
const contactsOf = (extraFields: Field[] = []): EntityCfg => ({
  id: "contacts", name: "Клиент", namePlural: "Клиенты", icon: "contact", titleFieldId: "title",
  fields: [
    f("title", "Имя", "text", { required: true }),
    f("phone", "Телефон", "phone"),
    f("source", "Канал", "select", { inTable: false, options: CHANNELS }),
    f("bday", "День рождения", "date", { inTable: false }),
    ...extraFields,
  ],
});

type SampleClient = { key: string; name: string; phone: string; channel?: string; wishes?: string; bday?: [number, number, number] };
type SampleDeal = { title: string; amount: number; stage: string; client?: string; channel?: string; ago?: number; owner?: string; extra?: Record<string, unknown> };
type SampleChat = { name: string; channel: Channel; dealTitle?: string; unread?: number; phone?: string; msgs: [number, boolean, string][] };
type PresetRule = Omit<Rule, "id" | "fired">;

export interface Preset {
  id: string;
  label: string;
  tagline: string;
  emoji: string;
  accent: string;
  custom?: boolean;        // сохранённый пользователем шаблон (без демо-данных, живёт в localStorage)
  entities: EntityCfg[];
  rules: PresetRule[];
  clients: SampleClient[];
  deals: SampleDeal[];
  chats?: SampleChat[];
}

const JEWELRY_DELIVERY = [opt("Собираем", "#8A8578"), opt("Передан в СДЭК", "#BC9F5C"), opt("В пути", "#6E8B8A"), opt("Доставлен", "#6E8B4F")];

export const PRESETS: Preset[] = [
  {
    id: "jewelry",
    label: "Магазин украшений",
    tagline: "Хендмейд: заявки из ТГ / WhatsApp / Instagram / Тильды, доставка СДЭК",
    emoji: "💍",
    accent: "#A8547C",
    entities: [
      {
        id: "deals", name: "Заказ", namePlural: "Заказы", icon: "package", titleFieldId: "title",
        fields: [
          f("title", "Что заказали", "text", { required: true }),
          f("amount", "Сумма", "money", { required: true }),
          f("contact", "Клиент", "relation", { relationTo: "contacts" }),
          f("source", "Канал", "select", { options: CHANNELS }),
          f("track", "Трек СДЭК", "text", { inTable: false }),
          f("delivery", "Статус доставки", "select", { inTable: false, options: JEWELRY_DELIVERY }),
          f("giftdate", "К дате", "date", { inTable: false }),
          f("address", "Адрес доставки", "textarea", { inTable: false }),
          f("wishes", "Пожелания (размер, гравировка)", "textarea", { inTable: false }),
        ],
        stages: [
          stg("jw_new", "Новая", "#8A8578"), stg("jw_agree", "Согласование", "#BC9F5C"),
          stg("jw_pay", "Оплата", "#C9A24B"), stg("jw_make", "Изготовление", "#B0725A"),
          stg("jw_ship", "Отправка", "#6E8B8A"), stg("jw_won", "Получен", "#6E8B4F", "won"),
          stg("jw_lost", "Отказ", "#A8543F", "lost"),
        ],
      },
      contactsOf([f("wishes", "Размер кольца, металл, камни", "textarea", { inTable: false })]),
    ],
    rules: [
      { name: "Новая заявка → ответить за 15 минут", enabled: true, trigger: { type: "record_created", entityId: "deals" }, action: { type: "task", title: "Ответить клиенту (за 15 минут)", kind: "msg", afterHours: 0.25 } },
      { name: "Перешёл в «Оплату» → прислать реквизиты", enabled: true, trigger: { type: "stage_enter", entityId: "deals", stageId: "jw_pay" }, action: { type: "task", title: "Прислать реквизиты / QR для оплаты", kind: "msg", afterHours: 0 } },
      { name: "Перешёл в «Отправку» → оформить СДЭК", enabled: true, trigger: { type: "stage_enter", entityId: "deals", stageId: "jw_ship" }, action: { type: "task", title: "Оформить СДЭК и вписать трек", kind: "todo", afterHours: 0 } },
      { name: "Завис в «Согласовании» 2 дня → дожать", enabled: true, trigger: { type: "stage_stuck", entityId: "deals", days: 2 }, action: { type: "task", title: "Согласование затянулось — мягко напомнить", kind: "msg", afterHours: 2 } },
      { name: "Получен → отзыв, фото и допродажа", enabled: true, trigger: { type: "stage_enter", entityId: "deals", stageId: "jw_won" }, action: { type: "task", title: "Попросить отзыв и фото, предложить парное изделие", kind: "msg", afterHours: 24 } },
      { name: "Тишина 45 дней → показать новинку", enabled: true, trigger: { type: "quiet", entityId: "deals", days: 45 }, action: { type: "task", title: "Давно не общались — показать новинку", kind: "msg", afterHours: 1 } },
    ],
    clients: [
      { key: "olya", name: "Ольга Мельникова", phone: "+7 916 220-14-58", channel: "Instagram", wishes: "Размер кольца 16.5, любит серебро и лунный камень", bday: [4, 12, 33] },
      { key: "nastya", name: "Анастасия Р.", phone: "+7 903 771-09-22", channel: "Telegram", wishes: "Золото 585, без камней" },
      { key: "marina", name: "Марина Котова", phone: "+7 921 004-88-31", channel: "WhatsApp", wishes: "Гравировка на внутренней стороне" },
      { key: "lena", name: "Елена (подарок мужу)", phone: "+7 999 145-33-70", channel: "Тильда" },
    ],
    deals: [
      { title: "Серьги с жемчугом", amount: 4900, stage: "jw_new", channel: "Instagram", client: "olya", ago: 0 },
      { title: "Помолвочное кольцо, золото", amount: 38000, stage: "jw_agree", channel: "Telegram", client: "nastya", ago: 1 },
      { title: "Кольцо с гравировкой (пара)", amount: 12500, stage: "jw_pay", channel: "WhatsApp", client: "marina", ago: 2 },
      { title: "Кулон на цепочке", amount: 6800, stage: "jw_make", channel: "Instagram", client: "olya", ago: 4 },
      { title: "Запонки серебро (подарок)", amount: 7300, stage: "jw_ship", channel: "Тильда", client: "lena", ago: 5, extra: { track: "1069000123456", delivery: JEWELRY_DELIVERY[1].id } },
      { title: "Браслет с шармами", amount: 5400, stage: "jw_won", channel: "Telegram", client: "nastya", ago: 22 },
    ],
    chats: [
      { name: "Ольга Мельникова", channel: "ig", dealTitle: "Серьги с жемчугом", unread: 1, phone: "+7 916 220-14-58", msgs: [[2, false, "Здравствуйте! Увидела серьги с жемчугом в сторис — есть в наличии? И можно ли под заказ размер побольше?"]] },
      { name: "Марина Котова", channel: "wa", dealTitle: "Кольцо с гравировкой (пара)", unread: 0, phone: "+7 921 004-88-31", msgs: [[26, false, "Оплатила, чек скинуть?"], [25, true, "Спасибо, Марина! Вижу оплату — запускаем гравировку, к пятнице готово."]] },
    ],
  },

  {
    id: "barber",
    label: "Барбершоп / салон",
    tagline: "Запись клиентов, мастера, напоминания о визите",
    emoji: "💈",
    accent: "#5C7A9E",
    entities: [
      {
        id: "deals", name: "Запись", namePlural: "Записи", icon: "calendar", titleFieldId: "title",
        fields: [
          f("title", "Услуга", "text", { required: true }),
          f("amount", "Стоимость", "money"),
          f("contact", "Клиент", "relation", { relationTo: "contacts" }),
          f("source", "Канал", "select", { options: CHANNELS }),
          f("when", "Дата и время", "datetime", { inTable: false }),
          f("notes", "Комментарий", "textarea", { inTable: false }),
        ],
        stages: [
          stg("bs_new", "Новая", "#8A8578"), stg("bs_ok", "Подтверждена", "#BC9F5C"),
          stg("bs_here", "Пришёл", "#6E8B8A"), stg("bs_done", "Выполнено", "#6E8B4F", "won"),
          stg("bs_no", "Не пришёл", "#A8543F", "lost"),
        ],
      },
      contactsOf([f("wishes", "Предпочтения (стрижка, мастер)", "textarea", { inTable: false })]),
    ],
    rules: [
      { name: "Новая запись → подтвердить", enabled: true, trigger: { type: "record_created", entityId: "deals" }, action: { type: "task", title: "Подтвердить запись с клиентом", kind: "call", afterHours: 0.25 } },
      { name: "Выполнено → записать на следующий визит", enabled: true, trigger: { type: "stage_enter", entityId: "deals", stageId: "bs_done" }, action: { type: "task", title: "Записать на следующий визит", kind: "msg", afterHours: 1 } },
      { name: "Тишина 30 дней → пора подстричься", enabled: true, trigger: { type: "quiet", entityId: "deals", days: 30 }, action: { type: "task", title: "Напомнить: пора подстричься", kind: "msg", afterHours: 1 } },
    ],
    clients: [
      { key: "kirill", name: "Кирилл Дёмин", phone: "+7 915 330-21-04", channel: "Telegram", wishes: "Фейд по бокам, мастер — Артём" },
      { key: "pavel", name: "Павел С.", phone: "+7 903 118-77-52", channel: "WhatsApp" },
      { key: "denis", name: "Денис Коваль", phone: "+7 926 740-15-88", channel: "Instagram", wishes: "Борода + стрижка" },
    ],
    deals: [
      { title: "Стрижка + борода", amount: 2200, stage: "bs_new", channel: "Instagram", client: "denis", ago: 0 },
      { title: "Мужская стрижка", amount: 1500, stage: "bs_ok", channel: "Telegram", client: "kirill", ago: 0 },
      { title: "Камуфляж седины", amount: 1800, stage: "bs_here", channel: "WhatsApp", client: "pavel", ago: 0 },
      { title: "Мужская стрижка", amount: 1500, stage: "bs_done", channel: "Telegram", client: "kirill", ago: 20 },
    ],
  },

  {
    id: "bakery",
    label: "Кондитерская / торты на заказ",
    tagline: "Заказы к дате, предоплата, декор и доставка",
    emoji: "🎂",
    accent: "#B0725A",
    entities: [
      {
        id: "deals", name: "Заказ", namePlural: "Заказы", icon: "package", titleFieldId: "title",
        fields: [
          f("title", "Что за торт", "text", { required: true }),
          f("amount", "Сумма", "money", { required: true }),
          f("contact", "Клиент", "relation", { relationTo: "contacts" }),
          f("source", "Канал", "select", { options: CHANNELS }),
          f("giftdate", "К дате", "date", { inTable: false }),
          f("address", "Адрес доставки", "textarea", { inTable: false }),
          f("wishes", "Начинка, вес, декор", "textarea", { inTable: false }),
        ],
        stages: [
          stg("bk_new", "Новая", "#8A8578"), stg("bk_agree", "Согласование", "#BC9F5C"),
          stg("bk_pay", "Предоплата", "#C9A24B"), stg("bk_bake", "Готовим", "#B0725A"),
          stg("bk_give", "Выдача/Доставка", "#6E8B8A"), stg("bk_won", "Выполнен", "#6E8B4F", "won"),
          stg("bk_lost", "Отказ", "#A8543F", "lost"),
        ],
      },
      contactsOf([f("wishes", "Предпочтения (аллергии, вкусы)", "textarea", { inTable: false })]),
    ],
    rules: [
      { name: "Новая заявка → ответить за 15 минут", enabled: true, trigger: { type: "record_created", entityId: "deals" }, action: { type: "task", title: "Ответить клиенту (за 15 минут)", kind: "msg", afterHours: 0.25 } },
      { name: "Предоплата → прислать реквизиты", enabled: true, trigger: { type: "stage_enter", entityId: "deals", stageId: "bk_pay" }, action: { type: "task", title: "Прислать реквизиты для предоплаты", kind: "msg", afterHours: 0 } },
      { name: "Завис в «Согласовании» 2 дня → дожать", enabled: true, trigger: { type: "stage_stuck", entityId: "deals", days: 2 }, action: { type: "task", title: "Согласование затянулось — напомнить", kind: "msg", afterHours: 2 } },
      { name: "Выполнен → отзыв и следующая дата", enabled: true, trigger: { type: "stage_enter", entityId: "deals", stageId: "bk_won" }, action: { type: "task", title: "Попросить отзыв и фото, спросить про следующий повод", kind: "msg", afterHours: 24 } },
      { name: "Тишина 60 дней → напомнить о себе", enabled: true, trigger: { type: "quiet", entityId: "deals", days: 60 }, action: { type: "task", title: "Давно не заказывали — напомнить к празднику", kind: "msg", afterHours: 1 } },
    ],
    clients: [
      { key: "irina", name: "Ирина Соловьёва", phone: "+7 917 442-90-11", channel: "Instagram", wishes: "Без орехов, любит красный бархат" },
      { key: "olga2", name: "Ольга (день рождения дочки)", phone: "+7 905 613-28-40", channel: "Тильда" },
      { key: "timur", name: "Тимур Ахметов", phone: "+7 927 705-63-19", channel: "WhatsApp" },
    ],
    deals: [
      { title: "Торт «Красный бархат», 2 кг", amount: 4200, stage: "bk_new", channel: "Instagram", client: "irina", ago: 0 },
      { title: "Детский торт с единорогом", amount: 5600, stage: "bk_agree", channel: "Тильда", client: "olga2", ago: 1 },
      { title: "Капкейки, 24 шт", amount: 3600, stage: "bk_pay", channel: "WhatsApp", client: "timur", ago: 2 },
      { title: "Свадебный торт, 3 яруса", amount: 14800, stage: "bk_bake", channel: "Instagram", client: "irina", ago: 4 },
      { title: "Бенто-торт", amount: 1900, stage: "bk_won", channel: "WhatsApp", client: "timur", ago: 25 },
    ],
  },
];

export const presetById = (id: string) => PRESETS.find(p => p.id === id);

// ---------- пользовательские шаблоны (сохранённые настройки) ----------
// Живут на устройстве (localStorage): «сохранить мою настройку как шаблон» и применить её снова/в другом пространстве.
const CUSTOM_KEY = "xxlcrm-presets-v1";
export function loadCustomPresets(): Preset[] {
  try { const raw = window.localStorage.getItem(CUSTOM_KEY); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
}
function saveCustomList(list: Preset[]) { try { window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* нет хранилища — живём в RAM */ } }
export function saveCustomPreset(label: string, entities: EntityCfg[], rules: Rule[]): Preset {
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const p: Preset = {
    id: "custom_" + uid("p"), label: label.trim() || "Мой шаблон", tagline: "Ваш сохранённый шаблон", emoji: "⭐", accent: "#BC9F5C",
    custom: true, entities: clone(entities), rules: clone(rules), clients: [], deals: [],
  };
  const list = loadCustomPresets().filter(x => x.label !== p.label); // одноимённый — перезаписываем
  list.unshift(p);
  saveCustomList(list.slice(0, 24));
  return p;
}
export function deleteCustomPreset(id: string) { saveCustomList(loadCustomPresets().filter(p => p.id !== id)); }
export const resolvePreset = (id: string): Preset | undefined => presetById(id) ?? loadCustomPresets().find(p => p.id === id);

// материализация пресета в состояние: свежие id у записей/правил, связка сделок с клиентами по ключу
export function buildPresetData(p: Preset): { entities: EntityCfg[]; automations: Rule[]; records: Rec[]; activities: Activity[]; tasks: Task[]; chats: Chat[] } {
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const entities = clone(p.entities);
  const automations: Rule[] = p.rules.map(r => ({ ...clone(r), id: uid("rule"), fired: 0 }));
  const records: Rec[] = [];
  const activities: Activity[] = [];
  const idByKey: Record<string, string> = {};
  const n: Record<string, number> = {};
  const y = new Date().getFullYear();
  const srcId = (label?: string) => label ? "o_" + label.toLowerCase().replace(/[^a-zа-яё0-9]/g, "") : undefined;

  const mk = (entityId: string, values: Record<string, unknown>, o: { stage?: string; owner?: string; ago?: number }) => {
    n[entityId] = (n[entityId] ?? 0) + 1;
    const createdAt = days(-(o.ago ?? 3));
    const r: Rec = { id: uid("r"), entityId, num: n[entityId], values, ownerId: o.owner ?? "u1", createdAt, updatedAt: createdAt, stageId: o.stage, stageAt: createdAt + 3600000 };
    records.push(r);
    activities.push({ id: uid("a"), recordId: r.id, ts: createdAt, kind: "created", text: "Запись создана", userId: r.ownerId });
    return r;
  };

  for (const c of p.clients) {
    const values: Record<string, unknown> = { title: c.name, phone: c.phone };
    if (c.channel) values.source = srcId(c.channel);
    if (c.wishes) values.wishes = c.wishes;
    if (c.bday) { const [mo, d, yb] = c.bday; values.bday = new Date(y - yb, mo - 1, d, 12).getTime(); }
    idByKey[c.key] = mk("contacts", values, { ago: 20, owner: "u2" }).id;
  }
  for (const d of p.deals) {
    const values: Record<string, unknown> = { title: d.title, amount: d.amount };
    if (d.client && idByKey[d.client]) values.contact = idByKey[d.client];
    if (d.channel) values.source = srcId(d.channel);
    Object.assign(values, d.extra ?? {});
    mk("deals", values, { stage: d.stage, ago: d.ago, owner: d.owner });
  }

  const chats: Chat[] = (p.chats ?? []).map(ch => ({
    id: uid("c"), name: ch.name, channel: ch.channel, unread: ch.unread ?? 0, phone: ch.phone,
    recordId: ch.dealTitle ? records.find(r => r.entityId === "deals" && r.values.title === ch.dealTitle)?.id : undefined,
    msgs: ch.msgs.map(([agoH, out, text]) => ({ id: uid("m"), ts: now() - agoH * 3600000, out, text })),
  }));

  return { entities, automations, records, activities, tasks: [], chats };
}

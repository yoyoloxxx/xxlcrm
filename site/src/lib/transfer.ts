// Перенос локальной базы в облачное пространство: план переезда.
//
// id строки в базе — ПЕРВИЧНЫЙ КЛЮЧ на всю таблицу, а не внутри пространства. Если перенести
// одну и ту же локальную базу дважды, upsert по старым id не добавит записи во второе
// пространство, а ПЕРЕТАЩИТ их из первого — там они молча исчезнут. Поэтому каждая строка едет
// с новым id, а все ссылки на неё — из задач, диалогов, истории и полей-связей — переписываются.
//
// Функция чистая: ничего не отправляет и не трогает состояние. Так её можно проверить тестом,
// не поднимая облако.
import type { Rec, Task, Activity, Chat, EntityCfg } from "./model";

export interface TransferSrc {
  entities: EntityCfg[];
  records: Rec[];
  tasks: Task[];
  activities: Activity[];
  chats: Chat[];
}

export interface TransferPlan {
  records: Rec[];
  tasks: Task[];
  activities: Activity[];
  chats: Chat[];
  map: Map<string, string>;   // старый id записи → новый
}

/** Что именно поедет и под какими id. Примеры не едут: они не работа человека.
    Генератор id передаётся снаружи — так план можно проверить тестом без остального приложения. */
export function planTransfer(s: TransferSrc, newId: (prefix: string) => string): TransferPlan {
  const keepRec = s.records.filter(r => !r.demo);
  const old = new Set(keepRec.map(r => r.id));
  const map = new Map(keepRec.map(r => [r.id, newId("r")]));

  const relFields = new Map<string, string[]>();
  for (const e of s.entities) relFields.set(e.id, e.fields.filter(f => f.type === "relation").map(f => f.id));
  const remapValues = (r: Rec): Record<string, unknown> => {
    const fields = relFields.get(r.entityId);
    if (!fields?.length) return r.values;
    const v = { ...r.values };
    for (const f of fields) {
      const cur = v[f];
      if (typeof cur === "string" && map.has(cur)) v[f] = map.get(cur);
    }
    return v;
  };

  return {
    map,
    records: keepRec.map(r => ({ ...r, id: map.get(r.id)!, values: remapValues(r) })),
    // задача, привязанная к примеру, поедет без привязки — иначе она сошлётся в пустоту
    tasks: s.tasks.filter(t => !t.demo && (!t.recordId || old.has(t.recordId)))
      .map(t => ({ ...t, id: newId("t"), recordId: t.recordId ? map.get(t.recordId) : undefined })),
    activities: s.activities.filter(a => old.has(a.recordId))
      .map(a => ({ ...a, id: newId("a"), recordId: map.get(a.recordId)! })),
    chats: s.chats.filter(c => !c.demo)
      .map(c => ({ ...c, id: newId("c"), recordId: c.recordId && map.has(c.recordId) ? map.get(c.recordId) : undefined })),
  };
}

// Слияние по полям: что именно этот человек изменил в карточке.
//
// Раньше сохранение отправляло карточку целиком. Двое правили одну и ту же: один менял
// телефон, другой — сумму; кто записал вторым, тот и затирал чужую работу молча, без следа
// в ленте. Для общей базы это не мелочь — люди перестают доверять тому, что видят.
// Теперь наверх уходит ТОЛЬКО разница, а склеивает её база (функция rec_merge_many).
import type { Rec } from "./model";

export type Merge = { id: string; patch: Record<string, unknown>; drop: string[]; scalars: Record<string, unknown> };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Разница между тем, что лежит в базе (prev), и тем, что на экране (next). null — отправлять нечего. */
export function recDiff(prev: Rec, next: Rec, nowMs = Date.now()): Merge | null {
  // Смена сущности или даты создания — это уже не правка поля, а другая карточка.
  // Такую отправим целиком, чтобы не получить полурасползшуюся строку.
  if (prev.entityId !== next.entityId || prev.createdAt !== next.createdAt) return null;

  const patch: Record<string, unknown> = {};
  const drop: string[] = [];
  const a = prev.values ?? {}, b = next.values ?? {};
  for (const k of Object.keys(b)) {
    if (same(a[k], b[k])) continue;
    // Очистка «выбора», числа, связи, даты приходит из UI как undefined (ключ остаётся, значение
    // снято). Это УДАЛЕНИЕ поля, а не правка: без этой ветки undefined выпадал при JSON.stringify,
    // на сервер уходил пустой patch, поле не очищалось — и ответ базы возвращал старое значение.
    if (b[k] === undefined) drop.push(k);
    else patch[k] = b[k];
  }
  // Пустая СТРОКА — это значение («телефон стёрли, но поле оставили»), а не удаление поля.
  for (const k of Object.keys(a)) if (!(k in b) && a[k] !== undefined) drop.push(k);

  const scalars: Record<string, unknown> = {};
  if (prev.stageId !== next.stageId) { scalars.stage_id = next.stageId ?? ""; scalars.stage_at = next.stageAt ?? nowMs; }
  else if (prev.stageAt !== next.stageAt) scalars.stage_at = next.stageAt ?? null;
  if (prev.ownerId !== next.ownerId) scalars.owner_id = next.ownerId ?? "";
  if (prev.pos !== next.pos) scalars.pos = next.pos ?? null;
  if (prev.num !== next.num) scalars.num = next.num;

  if (!Object.keys(patch).length && !drop.length && !Object.keys(scalars).length) return null;
  return { id: next.id, patch, drop, scalars };
}

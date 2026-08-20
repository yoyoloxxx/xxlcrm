-- XXLcrm v0.28 — слияние по ПОЛЯМ, а не по карточке целиком.
--
-- Зачем. Раньше сохранение отправляло весь объект values. Двое открыли одну карточку:
-- один поправил телефон, второй — сумму. Кто сохранился вторым, тот и затёр чужую правку,
-- молча и без следа. Для общей базы это не мелочь: люди перестают доверять тому, что видят.
--
-- Теперь клиент шлёт ТОЛЬКО свои изменения, а склеивает их база — атомарно, внутри UPDATE.
-- Заодно updated_at ставит сервер: часы в браузере врут, и «последним» оказывался тот,
-- у кого они убежали вперёд.

create or replace function public.rec_merge_many(p_ws uuid, p_items jsonb)
returns setof public.records
language plpgsql
security invoker           -- RLS остаётся в силе: чужое пространство так не тронуть
set search_path = public
as $$
declare
  it   jsonb;
  drops text[];
  r    public.records;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    drops := coalesce(
      (select array_agg(x) from jsonb_array_elements_text(coalesce(it->'drop', '[]'::jsonb)) x),
      '{}'::text[]);

    update public.records set
      -- сначала убираем поля, которые человек очистил, потом накладываем его правки
      values     = (coalesce(values, '{}'::jsonb) - drops) || coalesce(it->'patch', '{}'::jsonb),
      stage_id   = case when it->'scalars' ? 'stage_id' then nullif(it->'scalars'->>'stage_id', '') else stage_id end,
      stage_at   = case when it->'scalars' ? 'stage_at' then (it->'scalars'->>'stage_at')::bigint   else stage_at end,
      owner_id   = case when it->'scalars' ? 'owner_id' then nullif(it->'scalars'->>'owner_id', '') else owner_id end,
      pos        = case when it->'scalars' ? 'pos'      then (it->'scalars'->>'pos')::numeric       else pos      end,
      num        = case when it->'scalars' ? 'num'      then (it->'scalars'->>'num')::int           else num      end,
      updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
    where id = it->>'id' and workspace_id = p_ws
    returning * into r;

    -- строки может не быть: карточку завели офлайн или её уже удалил коллега.
    -- Тогда просто не возвращаем её — клиент разберётся сам и зальёт целиком.
    if r.id is not null then
      return next r;
      r := null;
    end if;
  end loop;
end $$;

revoke all on function public.rec_merge_many(uuid, jsonb) from public, anon;
grant execute on function public.rec_merge_many(uuid, jsonb) to authenticated;

-- XXLcrm · v0.30 · закрытие дыр, найденных аудитом безопасности (выполнять в SQL Editor целиком)

-- 1) chat_append_msg — SECURITY DEFINER без проверки прав, а по умолчанию Supabase выдаёт EXECUTE
--    ролям anon/authenticated: любой с anon-ключом мог дописать «сообщение клиента» в чужой диалог.
revoke execute on function public.chat_append_msg(text, jsonb) from public, anon, authenticated;
grant execute on function public.chat_append_msg(text, jsonb) to service_role;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- 2) Код приглашения: перевыпущенный код сравнивался без учёта регистра только с одной стороны —
--    новый код не подходил никому. Плюс пауза на промах: перебор кода становится бессмысленным.
create or replace function public.join_workspace(code text, display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'Не авторизован'; end if;
  select id into wid from workspaces where lower(invite_code) = lower(trim(code));
  if wid is null then perform pg_sleep(0.6); raise exception 'Код приглашения не найден'; end if;
  insert into members (workspace_id, user_id, name, role, hue)
    values (wid, auth.uid(), coalesce(nullif(trim(display_name), ''), 'Сотрудник'), 'member', floor(random() * 360)::int)
    on conflict (workspace_id, user_id) do update set name = excluded.name;
  return wid;
end $$;

-- 3) Журнал входящих не должен расти бесконечно: обработанные строки старше 60 дней — в корзину.
--    (Если pg_cron включён — ежедневно; иначе функцию можно вызывать руками или из приёмника.)
create or replace function public.inbound_prune() returns void language sql security definer set search_path = public as $$
  delete from public.inbound where processed = true and ts < (extract(epoch from now()) * 1000)::bigint - 60::bigint * 86400000;
$$;
revoke execute on function public.inbound_prune() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('xxlcrm-inbound-prune', '17 3 * * *', 'select public.inbound_prune()');
  end if;
exception when others then null; end $$;

-- проверка: у chat_append_msg не должно быть anon/authenticated в proacl
select proname, proacl from pg_proc where proname in ('chat_append_msg', 'rec_merge_many', 'join_workspace', 'inbound_prune');

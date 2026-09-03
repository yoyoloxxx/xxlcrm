-- XXLcrm · v0.31 · права «сотрудник видит только свои», утренний дайджест, новые каналы (VK/Avito/ответы в Instagram)
-- Выполнять в SQL Editor целиком.

-- ---------- 1) Права: у участника есть scope — «всё» или «только свои» ----------
alter table public.members add column if not exists scope text not null default 'all' check (scope in ('all','own'));

-- владелец меняет scope участников (свою строку он правит через mem_update_self); роль так не поменять
drop policy if exists mem_update_owner on public.members;
create policy mem_update_owner on public.members for update
  using (public.is_owner(workspace_id))
  with check (public.is_owner(workspace_id) and role = 'member');

-- видит ли текущий пользователь запись с таким ответственным: владелец и «всё» — любую,
-- «только свои» — свои и ничьи (входящие без ответственного должен кто-то подобрать)
create or replace function public.can_see(ws uuid, rec_owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and (m.role = 'owner' or m.scope = 'all' or rec_owner is null or rec_owner = '' or rec_owner = auth.uid()::text)
  );
$$;
-- видна ли запись по её id (для истории и диалогов)
create or replace function public.can_see_record(ws uuid, rec_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when rec_id is null or rec_id = '' then public.is_member(ws)
    when not exists (select 1 from records r where r.id = rec_id) then public.is_member(ws)
    else exists (select 1 from records r where r.id = rec_id and public.can_see(ws, r.owner_id))
  end;
$$;

-- записи и задачи: чтение и правка — по видимости; вставка — любой участник
do $$
declare t text;
begin
  foreach t in array array['records','tasks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for select using (public.can_see(workspace_id, owner_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for update using (public.can_see(workspace_id, owner_id)) with check (public.can_see(workspace_id, owner_id))', t || '_upd', t);
  end loop;
end $$;

-- история: видна, если видна её запись
drop policy if exists act_all on public.activities;
drop policy if exists act_sel on public.activities;
drop policy if exists act_ins on public.activities;
drop policy if exists act_upd on public.activities;
drop policy if exists act_del on public.activities;
create policy act_sel on public.activities for select using (public.can_see_record(workspace_id, record_id));
create policy act_ins on public.activities for insert with check (public.is_member(workspace_id));
create policy act_upd on public.activities for update using (public.can_see_record(workspace_id, record_id)) with check (public.is_member(workspace_id));
create policy act_del on public.activities for delete using (public.can_see_record(workspace_id, record_id));

-- диалоги: непривязанные видят все, привязанные — по видимости записи
drop policy if exists chat_sel on public.chats;
drop policy if exists chat_upd on public.chats;
create policy chat_sel on public.chats for select using (public.can_see_record(workspace_id, record_id));
create policy chat_upd on public.chats for update using (public.can_see_record(workspace_id, record_id)) with check (public.is_member(workspace_id));

-- ---------- 2) Настройки каналов: место под данные VK/Avito/Meta ----------
alter table public.channel_hooks add column if not exists meta jsonb not null default '{}'::jsonb;

-- ---------- 3) Утренний дайджест: pg_cron дёргает приёмник по ключу из закрытой таблицы ----------
create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;   -- политик нет: читает только service_role
insert into public.app_settings (key, value) values ('digest_key', encode(gen_random_bytes(18), 'hex')) on conflict (key) do nothing;
do $$
declare jid int;
begin
  select jobid into jid from cron.job where jobname = 'xxlcrm-digest';
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('xxlcrm-digest', '0 5 * * *',
    $q$ select net.http_get(url := 'https://nddauhfqciuvzbvdipuf.supabase.co/functions/v1/hook?digest=' || (select value from public.app_settings where key = 'digest_key')) $q$);
  select jobid into jid from cron.job where jobname = 'xxlcrm-inbound-prune';
  if jid is null then perform cron.schedule('xxlcrm-inbound-prune', '17 3 * * *', 'select public.inbound_prune()'); end if;
end $$;

-- проверка
select (select count(*) from cron.job) as cron_jobs,
       (select count(*) from public.app_settings where key = 'digest_key') as digest_key,
       (select count(*) from pg_policies where tablename in ('records','tasks','activities','chats') and policyname like '%_sel') as sel_policies,
       (select column_name from information_schema.columns where table_name = 'members' and column_name = 'scope') as members_scope,
       (select column_name from information_schema.columns where table_name = 'channel_hooks' and column_name = 'meta') as hooks_meta;

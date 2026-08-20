-- XXLcrm · серверный приём заявок (v0.18). Запускается один раз в SQL Editor после supabase-init.sql.
-- Смысл: сообщения и заявки приходят на сервер, а не в открытую вкладку браузера.

-- Секреты вебхуков: по одному на пространство и источник. Клиент их создаёт, функция сверяет.
create table if not exists public.channel_hooks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null,                       -- tg | tilda | wa | max
  secret text not null,
  bot_token text,                             -- нужен, чтобы снять вебхук; хранится только для своего пространства
  created_at timestamptz not null default now(),
  primary key (workspace_id, source)
);

-- Журнал входящих: что именно пришло на сервер. Обычно функция сразу превращает это в диалог и заявку
-- (processed = true). Если не вышло — строка остаётся необработанной, и приложение доделает её при открытии.
create table if not exists public.inbound (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null,
  ext jsonb not null default '{}'::jsonb,     -- внешние идентификаторы: {"tg": 123456}
  name text,
  phone text,
  text text,
  fields jsonb,                               -- поля формы с сайта
  ts bigint not null,
  processed boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists inbound_ws on public.inbound (workspace_id, processed);

-- Идемпотентность доставки: Telegram повторяет апдейт, если не увидел 200 вовремя.
-- Без этого повтор заводил второй такой же диалог и накручивал непрочитанные.
alter table public.inbound add column if not exists ext_key text;
create unique index if not exists inbound_dedup on public.inbound (workspace_id, source, ext_key)
  where ext_key is not null;

-- Маршруты приёма («куда падают заявки») лежат рядом со структурой. Колонки не было в первой
-- схеме, из-за чего серверная функция падала на запросе и заявки молча терялись.
alter table public.ws_config add column if not exists automations jsonb;

-- Кто что может удалять. Раньше любой участник (а порог входа — восьмисимвольный код
-- приглашения, который виден всем) мог одним запросом стереть всю базу пространства.
-- Теперь: свои записи и задачи сотрудник удаляет сам, чужие — только владелец.
-- Читать, создавать и править по-прежнему может каждый участник.
create or replace function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from workspaces w where w.id = ws and w.owner_id = auth.uid()); $$;

do $$
declare t text;
begin
  foreach t in array array['records','tasks'] loop
    -- старые общие политики называются rec_all / task_all: если их не снять, они
    -- останутся действовать ПАРАЛЛЕЛЬНО (разрешения складываются) и ограничение на
    -- удаление окажется бесполезным
    execute format('drop policy if exists %I on public.%I', case t when 'records' then 'rec_all' else 'task_all' end, t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for select using (public.is_member(workspace_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert with check (public.is_member(workspace_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t || '_upd', t);
    -- ВНИМАНИЕ: records.owner_id и tasks.owner_id — text, а auth.uid() возвращает uuid.
    -- Без приведения типов Postgres отказывается сравнивать: «operator does not exist: text = uuid».
    execute format('create policy %I on public.%I for delete using (public.is_member(workspace_id) and (owner_id = auth.uid()::text or public.is_owner(workspace_id)))', t || '_del', t);
  end loop;
end $$;

-- Диалоги: удалять переписку с клиентом может только владелец
drop policy if exists chat_all on public.chats;
drop policy if exists chat_sel on public.chats;
drop policy if exists chat_ins on public.chats;
drop policy if exists chat_upd on public.chats;
drop policy if exists chat_del on public.chats;
create policy chat_sel on public.chats for select using (public.is_member(workspace_id));
create policy chat_ins on public.chats for insert with check (public.is_member(workspace_id));
create policy chat_upd on public.chats for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy chat_del on public.chats for delete using (public.is_owner(workspace_id));

-- Участник мог назначить себя владельцем: политика на UPDATE не проверяла, ЧТО он пишет.
-- Своё имя менять можно, роль — нет.
drop policy if exists mem_update_self on public.members;
create policy mem_update_self on public.members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and role = (select m.role from public.members m where m.user_id = auth.uid() and m.workspace_id = members.workspace_id));

-- Дозапись сообщения в диалог на стороне базы. Раньше сервер читал весь массив msgs,
-- дописывал и клал обратно: два сообщения, пришедшие одновременно, затирали друг друга.
create or replace function public.chat_append_msg(p_chat text, p_msg jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  full_list jsonb;
  n int;
begin
  select coalesce(msgs, '[]'::jsonb) || jsonb_build_array(p_msg) into full_list
    from public.chats where id = p_chat for update;
  if full_list is null then return; end if;
  n := jsonb_array_length(full_list);
  if n > 500 then
    select coalesce(jsonb_agg(el order by ord), '[]'::jsonb) into full_list
      from jsonb_array_elements(full_list) with ordinality t(el, ord)
     where ord > n - 500;
  end if;
  update public.chats
     set msgs = full_list,
         unread = coalesce(unread, 0) + 1,
         updated_at = (extract(epoch from now()) * 1000)::bigint
   where id = p_chat;
end;
$$;
revoke all on function public.chat_append_msg(text, jsonb) from public;
grant execute on function public.chat_append_msg(text, jsonb) to service_role;

alter table public.channel_hooks enable row level security;
alter table public.inbound enable row level security;

-- Токен бота и секрет приёмника — это доступ к переписке с клиентами и право слать
-- заявки в CRM. Рядовому участнику они не нужны: оставляем их только владельцу.
drop policy if exists hooks_all on public.channel_hooks;
drop policy if exists hooks_owner on public.channel_hooks;
create policy hooks_owner on public.channel_hooks for all
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

drop policy if exists inbound_all on public.inbound;
create policy inbound_all on public.inbound for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- Кому сервер пишет о новой заявке в Telegram (подписка через «/start notify_<ws>» у своего бота)
create table if not exists public.notify_targets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  chat_id text not null,
  name text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, chat_id)
);
alter table public.notify_targets enable row level security;
drop policy if exists notify_all on public.notify_targets;
create policy notify_all on public.notify_targets for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- realtime: незакрытая вкладка получает входящее мгновенно
alter table public.inbound replica identity full;
do $$ begin
  execute 'alter publication supabase_realtime add table public.inbound';
exception when duplicate_object then null; end $$;

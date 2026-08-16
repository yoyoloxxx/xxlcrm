-- XXLcrm · схема системы аккаунтов (шаг Supabase). Запускается один раз в SQL Editor.
-- Строковые id записей = id клиента (миграция из localStorage без потерь).

-- ---------- Пространства и участники ----------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'member' check (role in ('owner','member')),
  hue int not null default 42,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ---------- Данные CRM ----------
create table if not exists public.records (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_id text not null,
  num int not null default 0,
  values jsonb not null default '{}'::jsonb,
  stage_id text,
  stage_at bigint,
  owner_id text,
  pos numeric,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists records_ws on public.records (workspace_id, entity_id);

create table if not exists public.tasks (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  kind text not null default 'todo',
  record_id text,
  owner_id text,
  due bigint,
  done boolean not null default false,
  done_at bigint
);
create index if not exists tasks_ws on public.tasks (workspace_id);

create table if not exists public.activities (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  record_id text not null,
  ts bigint not null,
  kind text not null,
  text text not null,
  user_id text
);
create index if not exists activities_ws on public.activities (workspace_id, record_id);

create table if not exists public.chats (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  phone text,
  channel text not null,
  record_id text,
  unread int not null default 0,
  ext jsonb,
  msgs jsonb not null default '[]'::jsonb,
  updated_at bigint not null default 0
);
create index if not exists chats_ws on public.chats (workspace_id);

create table if not exists public.reply_templates (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  text text not null
);
create index if not exists tpl_ws on public.reply_templates (workspace_id);

-- задел под конструктор разделов (шаг 3): конфиг сущностей на пространство
create table if not exists public.ws_config (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  entities jsonb,
  updated_at bigint not null default 0
);

-- ---------- RLS ----------
alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.records enable row level security;
alter table public.tasks enable row level security;
alter table public.activities enable row level security;
alter table public.chats enable row level security;
alter table public.reply_templates enable row level security;
alter table public.ws_config enable row level security;

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from members m where m.workspace_id = ws and m.user_id = auth.uid()); $$;

drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces for select using (public.is_member(id));
drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces for update using (owner_id = auth.uid());

drop policy if exists mem_select on public.members;
create policy mem_select on public.members for select using (public.is_member(workspace_id));
drop policy if exists mem_update_self on public.members;
create policy mem_update_self on public.members for update using (user_id = auth.uid());
drop policy if exists mem_delete on public.members;
create policy mem_delete on public.members for delete
  using (user_id = auth.uid() or exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid()));

drop policy if exists rec_all on public.records;
create policy rec_all on public.records for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
drop policy if exists task_all on public.tasks;
create policy task_all on public.tasks for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
drop policy if exists act_all on public.activities;
create policy act_all on public.activities for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
drop policy if exists chat_all on public.chats;
create policy chat_all on public.chats for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
drop policy if exists tpl_all on public.reply_templates;
create policy tpl_all on public.reply_templates for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
drop policy if exists cfg_all on public.ws_config;
create policy cfg_all on public.ws_config for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- ---------- Функции: создать пространство / войти по коду ----------
create or replace function public.create_workspace(ws_name text, display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'Не авторизован'; end if;
  insert into workspaces (name, owner_id)
    values (coalesce(nullif(trim(ws_name), ''), 'Моя компания'), auth.uid())
    returning id into wid;
  insert into members (workspace_id, user_id, name, role, hue)
    values (wid, auth.uid(), coalesce(nullif(trim(display_name), ''), 'Владелец'), 'owner', floor(random() * 360)::int);
  return wid;
end $$;

create or replace function public.join_workspace(code text, display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'Не авторизован'; end if;
  select id into wid from workspaces where invite_code = lower(trim(code));
  if wid is null then raise exception 'Код приглашения не найден'; end if;
  insert into members (workspace_id, user_id, name, role, hue)
    values (wid, auth.uid(), coalesce(nullif(trim(display_name), ''), 'Сотрудник'), 'member', floor(random() * 360)::int)
    on conflict (workspace_id, user_id) do update set name = excluded.name;
  return wid;
end $$;

-- ---------- Realtime ----------
alter table public.records replica identity full;
alter table public.tasks replica identity full;
alter table public.activities replica identity full;
alter table public.chats replica identity full;
alter table public.reply_templates replica identity full;
alter table public.members replica identity full;

do $$
declare t text;
begin
  foreach t in array array['records','tasks','activities','chats','reply_templates','members'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

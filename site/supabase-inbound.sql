-- XXLcrm · серверный приём заявок (v0.12). Запускается один раз в SQL Editor после supabase-init.sql.
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

alter table public.channel_hooks enable row level security;
alter table public.inbound enable row level security;

drop policy if exists hooks_all on public.channel_hooks;
create policy hooks_all on public.channel_hooks for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

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

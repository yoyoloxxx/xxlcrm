-- XXLcrm v0.29 — владелец может удалить своё пространство из самого продукта.
--
-- Зачем. Завести пространство можно в два клика, а убрать — нечем: политики DELETE на
-- workspaces не было вовсе. Человек, попробовавший CRM и передумавший, оставался с мусором
-- навсегда и лез бы за этим в SQL-редактор. Для продукта, который зовут в чужой бизнес,
-- это неприемлемо: право уйти и забрать за собой — часть доверия.
--
-- Удаляет ТОЛЬКО владелец и ТОЛЬКО своё. Всё содержимое уезжает следом само:
-- records/tasks/activities/chats/members и прочее ссылаются на workspaces
-- с on delete cascade.

drop policy if exists ws_delete on public.workspaces;
create policy ws_delete on public.workspaces
  for delete using (owner_id = auth.uid());

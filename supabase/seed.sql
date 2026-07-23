insert into public.app_id_counters (entity, next_value)
values
  ('position_groups', 1),
  ('document_groups', 1),
  ('candidates', 1)
on conflict (entity) do nothing;

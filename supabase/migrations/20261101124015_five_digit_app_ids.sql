begin;

-- Prevent concurrent ID issuance while synchronizing counters with legacy rows.
lock table public.app_id_counters, public.position_groups, public.candidates
  in share row exclusive mode;

with next_candidates as (
  select coalesce(max(substring(candidate_id from '^CAN-([0-9]+)$')::integer), 0) + 1 as next_value
  from public.candidates
  where candidate_id ~ '^CAN-[0-9]+$'
)
insert into public.app_id_counters (entity, next_value)
select 'candidates', next_value from next_candidates
on conflict (entity) do update set
  next_value = greatest(public.app_id_counters.next_value, excluded.next_value);

with next_position_groups as (
  select coalesce(max(substring(group_id from '^GRP-([0-9]+)$')::integer), 0) + 1 as next_value
  from public.position_groups
  where group_id ~ '^GRP-[0-9]+$'
)
insert into public.app_id_counters (entity, next_value)
select 'position_groups', next_value from next_position_groups
on conflict (entity) do update set
  next_value = greatest(public.app_id_counters.next_value, excluded.next_value);

create or replace function app_private.next_app_id(p_entity text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value integer;
  v_min_width integer;
begin
  if p_entity is null or p_prefix is null then
    raise exception 'Entity and prefix are required.';
  end if;

  insert into public.app_id_counters (entity, next_value)
  values (p_entity, 1)
  on conflict (entity) do nothing;

  update public.app_id_counters
  set next_value = next_value + 1
  where entity = p_entity
  returning next_value - 1 into v_value;

  v_min_width := case when upper(p_prefix) in ('CAN', 'GRP') then 5 else 4 end;
  return p_prefix || '-' || lpad(v_value::text, greatest(v_min_width, length(v_value::text)), '0');
end;
$$;

commit;

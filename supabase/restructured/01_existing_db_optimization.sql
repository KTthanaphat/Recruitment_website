begin;

create table if not exists public.app_id_counters (
  entity text primary key,
  next_value integer not null default 1 check (next_value > 0)
);

with next_position_groups as (
  select coalesce(max(nullif(substring(group_id from '^GRP-([0-9]+)$'), '')::integer), 0) + 1 as next_value
  from public.position_groups
  where group_id ~ '^GRP-[0-9]+$'
)
insert into public.app_id_counters (entity, next_value)
select 'position_groups', next_value from next_position_groups
on conflict (entity) do update set
  next_value = greatest(public.app_id_counters.next_value, excluded.next_value);

with next_document_groups as (
  select coalesce(max(nullif(substring(doc_group_id from '^DGRP-([0-9]+)$'), '')::integer), 0) + 1 as next_value
  from public.document_groups
  where doc_group_id ~ '^DGRP-[0-9]+$'
)
insert into public.app_id_counters (entity, next_value)
select 'document_groups', next_value from next_document_groups
on conflict (entity) do update set
  next_value = greatest(public.app_id_counters.next_value, excluded.next_value);

with next_candidates as (
  select coalesce(max(nullif(substring(candidate_id from '^CAN-([0-9]+)$'), '')::integer), 0) + 1 as next_value
  from public.candidates
  where candidate_id ~ '^CAN-[0-9]+$'
)
insert into public.app_id_counters (entity, next_value)
select 'candidates', next_value from next_candidates
on conflict (entity) do update set
  next_value = greatest(public.app_id_counters.next_value, excluded.next_value);

create or replace function public.next_app_id(p_entity text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value integer;
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

  return p_prefix || '-' || lpad(v_value::text, 4, '0');
end;
$$;

create or replace function public.next_prefixed_id(p_table text, p_column text, p_prefix text)
returns text
language sql
security definer
set search_path = public
as $$
  select public.next_app_id(p_table, p_prefix)
$$;

create index if not exists idx_profiles_role_site on public.profiles(role, site);
create index if not exists idx_requisitions_status_site_owner on public.requisitions(status, site, person_in_charge);
create index if not exists idx_requisitions_request_type_date on public.requisitions(request_type, pr_approved_date);
create index if not exists idx_requisition_logs_doc_date on public.requisition_logs(doc_id, log_date desc);
create index if not exists idx_position_groups_position on public.position_groups(group_position);
create index if not exists idx_document_groups_group_id on public.document_groups(group_id);
create index if not exists idx_recruitment_logs_candidate_latest on public.recruitment_logs(candidate_id, log_id desc);
create index if not exists idx_recruitment_logs_stage_result_date on public.recruitment_logs(recruitment_process, result, log_date desc);
create index if not exists idx_offers_doc_accepted on public.offers(doc_id, accepted_date) where accepted_date is not null;
create index if not exists idx_vacancy_weekly_snapshots_week_site on public.vacancy_weekly_snapshots(week_start, site);
create index if not exists idx_change_logs_changed_at on public.change_logs(changed_at desc);

commit;

-- Candidate Pipeline paired-status model.
-- One canonical row represents a stage/round from editable Pending through its
-- immutable Outcome. Historical duplicates remain linked as superseded rows.

alter table public.recruitment_logs
  add column if not exists stage_instance_id uuid default gen_random_uuid(),
  add column if not exists outcome_date date,
  add column if not exists outcome_interviewer text,
  add column if not exists outcome_remark text,
  add column if not exists outcome_recorded_at timestamptz,
  add column if not exists pending_edited_at timestamptz,
  add column if not exists pending_edited_by uuid references auth.users(id) on delete set null,
  add column if not exists record_origin text default 'user',
  add column if not exists migration_note text,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_stage_instance_id uuid,
  add column if not exists superseded_reason text,
  add column if not exists updated_at timestamptz default now();

update public.recruitment_logs
set stage_instance_id = coalesce(stage_instance_id, gen_random_uuid()),
    outcome_date = case when result is not null then coalesce(outcome_date, log_date) else null end,
    outcome_interviewer = case when result is not null then coalesce(outcome_interviewer, interviewer) else null end,
    outcome_remark = case when result is not null then coalesce(outcome_remark, remark) else null end,
    outcome_recorded_at = case when result is not null then coalesce(outcome_recorded_at, created_at, now()) else null end,
    record_origin = 'migration',
    migration_note = concat_ws('; ', nullif(migration_note, ''), 'paired-status backfill'),
    updated_at = coalesce(updated_at, created_at, now());

set constraints all immediate;

alter table public.recruitment_logs
  alter column stage_instance_id set default gen_random_uuid(),
  alter column stage_instance_id set not null,
  alter column record_origin set default 'user',
  alter column record_origin set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.recruitment_logs
  add constraint recruitment_logs_stage_instance_id_key unique (stage_instance_id);

alter table public.recruitment_logs
  add constraint recruitment_logs_superseded_by_stage_instance_id_fkey
  foreign key (superseded_by_stage_instance_id)
  references public.recruitment_logs(stage_instance_id)
  deferrable initially deferred;

create temporary table pipeline_reconciliation on commit drop as
with active_rows as (
  select *,
    row_number() over (
      partition by candidate_id, recruitment_process, round
      order by (result is not null) desc, log_id desc
    ) as canonical_rank
  from public.recruitment_logs
  where recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
), canonical as (
  select candidate_id, recruitment_process, round, log_id as canonical_log_id
  from active_rows
  where canonical_rank = 1
)
select c.*,
  (
    select p.log_id
    from public.recruitment_logs p
    where p.candidate_id = c.candidate_id
      and p.recruitment_process = c.recruitment_process
      and p.round = c.round
      and p.result is null
      and p.log_id <= c.canonical_log_id
    order by p.log_id desc
    limit 1
  ) as pending_source_log_id
from canonical c;

-- Preserve the selected Outcome while reconstructing its Pending fields. If
-- the legacy data has no Pending row, use previous canonical Outcome, then
-- first contact, then the old Outcome, then created_at. Clamp only where needed
-- to keep previous Outcome <= Pending <= Outcome and record every inference.
with canonical_context as (
  select
    choice.canonical_log_id,
    choice.pending_source_log_id,
    canonical.outcome_date,
    canonical.created_at,
    pending.log_date as pending_opened_date,
    pending.interviewer as pending_interviewer,
    pending.remark as pending_remark,
    candidate.first_contact_date,
    (
      select previous.outcome_date
      from pipeline_reconciliation previous_choice
      join public.recruitment_logs previous on previous.log_id = previous_choice.canonical_log_id
      where previous_choice.candidate_id = choice.candidate_id
        and previous_choice.canonical_log_id < choice.canonical_log_id
        and previous.result is not null
      order by previous_choice.canonical_log_id desc
      limit 1
    ) as previous_outcome_date
  from pipeline_reconciliation choice
  join public.recruitment_logs canonical on canonical.log_id = choice.canonical_log_id
  join public.candidates candidate on candidate.candidate_id = choice.candidate_id
  left join public.recruitment_logs pending on pending.log_id = choice.pending_source_log_id
  where canonical.result is not null
), resolved as (
  select *,
    coalesce(
      pending_opened_date,
      previous_outcome_date,
      first_contact_date,
      outcome_date,
      created_at::date
    ) as raw_opened_date
  from canonical_context
), normalized as (
  select *,
    least(
      outcome_date,
      greatest(raw_opened_date, coalesce(previous_outcome_date, raw_opened_date))
    ) as resolved_opened_date
  from resolved
)
update public.recruitment_logs canonical
set log_date = normalized.resolved_opened_date,
    interviewer = case when normalized.pending_source_log_id is null then null else normalized.pending_interviewer end,
    remark = case when normalized.pending_source_log_id is null then null else normalized.pending_remark end,
    migration_note = concat_ws(
      '; ',
      nullif(canonical.migration_note, ''),
      case
        when normalized.pending_source_log_id is not null
          then 'Pending fields reconciled from log ' || normalized.pending_source_log_id::text
        when normalized.previous_outcome_date is not null
          then 'Outcome-only Pending opened fallback: previous canonical Outcome'
        when normalized.first_contact_date is not null
          then 'Outcome-only Pending opened fallback: candidate first_contact_date'
        when normalized.outcome_date is not null
          then 'Outcome-only Pending opened fallback: old Outcome'
        else 'Outcome-only Pending opened fallback: created_at'
      end,
      case when normalized.resolved_opened_date is distinct from normalized.raw_opened_date
        then 'Pending opened date clamped for chronology' end,
      case when normalized.previous_outcome_date > normalized.outcome_date
        then 'migration conflict: previous canonical Outcome is after this Outcome' end
    )
from normalized
where canonical.log_id = normalized.canonical_log_id;

update public.recruitment_logs historical
set superseded_at = coalesce(historical.superseded_at, now()),
    superseded_by_stage_instance_id = canonical.stage_instance_id,
    superseded_reason = coalesce(historical.superseded_reason, 'duplicate stage/round reconciled by paired-status migration')
from pipeline_reconciliation choice
join public.recruitment_logs canonical on canonical.log_id = choice.canonical_log_id
where historical.candidate_id = choice.candidate_id
  and historical.recruitment_process = choice.recruitment_process
  and historical.round = choice.round
  and historical.log_id <> choice.canonical_log_id;

-- A Pending-only canonical row followed by later canonical activity is an
-- implicit Pass. Use the later row's opened date and leave Outcome interviewer
-- blank because it cannot be recovered from legacy data.
with inferred as (
  select pending.log_id, pending.log_date as old_opened_date,
    later.log_date as later_opened_date, later.created_at as later_created_at
  from public.recruitment_logs pending
  join lateral (
    select next_row.log_date, next_row.created_at
    from public.recruitment_logs next_row
    where next_row.candidate_id = pending.candidate_id
      and next_row.superseded_at is null
      and next_row.log_id > pending.log_id
      and next_row.recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
    order by next_row.log_id
    limit 1
  ) later on true
  where pending.superseded_at is null
    and pending.result is null
    and pending.recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
)
update public.recruitment_logs pending
set log_date = least(inferred.old_opened_date, inferred.later_opened_date),
    result = 1,
    outcome_date = inferred.later_opened_date,
    outcome_interviewer = null,
    outcome_remark = null,
    outcome_recorded_at = coalesce(inferred.later_created_at, now()),
    migration_note = concat_ws(
      '; ', nullif(pending.migration_note, ''),
      'Pass inferred from later canonical stage opened date',
      case when inferred.old_opened_date > inferred.later_opened_date
        then 'Pending opened date clamped for inferred Pass chronology' end
    )
from inferred
where pending.log_id = inferred.log_id;

-- A canonical Fail terminates active history. Preserve later rows for audit but
-- mark them as superseded conflict records linked to the terminating Fail.
with first_fail as (
  select distinct on (candidate_id) candidate_id, log_id, stage_instance_id
  from public.recruitment_logs
  where superseded_at is null and result = 0
    and recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
  order by candidate_id, log_id
), flagged_fail as (
  update public.recruitment_logs failed
  set migration_note = concat_ws('; ', nullif(failed.migration_note, ''),
    'migration conflict: canonical Fail had later active history')
  from first_fail
  where failed.log_id = first_fail.log_id
    and exists (
      select 1 from public.recruitment_logs later
      where later.candidate_id = first_fail.candidate_id
        and later.superseded_at is null and later.log_id > first_fail.log_id
        and later.recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
    )
  returning first_fail.candidate_id, first_fail.log_id, first_fail.stage_instance_id
)
update public.recruitment_logs later
set superseded_at = now(),
    superseded_by_stage_instance_id = flagged_fail.stage_instance_id,
    superseded_reason = 'later active history conflicts with canonical Fail',
    migration_note = concat_ws('; ', nullif(later.migration_note, ''),
      'migration conflict: superseded because an earlier canonical stage failed')
from flagged_fail
where later.candidate_id = flagged_fail.candidate_id
  and later.superseded_at is null
  and later.log_id > flagged_fail.log_id
  and later.recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer');

-- Retain only the latest genuinely unresolved Pending row.
with pending_rank as (
  select log_id, stage_instance_id, candidate_id,
    row_number() over (partition by candidate_id order by log_id desc) as pending_rank
  from public.recruitment_logs
  where superseded_at is null and result is null
), winner as (
  select candidate_id, stage_instance_id
  from pending_rank
  where pending_rank = 1
)
update public.recruitment_logs stale
set superseded_at = now(),
    superseded_by_stage_instance_id = winner.stage_instance_id,
    superseded_reason = 'stale duplicate Pending reconciled by paired-status migration'
from pending_rank ranked
join winner using (candidate_id)
where stale.log_id = ranked.log_id and ranked.pending_rank > 1;

-- If the latest canonical row is a non-Offer Pass and no Pending remains,
-- create the immediate next Pending stage at the Outcome date.
create temporary table pipeline_missing_next on commit drop as
with latest as (
  select distinct on (candidate_id) *
  from public.recruitment_logs
  where superseded_at is null
    and recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
  order by candidate_id, log_id desc
)
select latest.candidate_id, latest.stage_instance_id as completed_stage_instance_id,
  latest.outcome_date as next_opened_date,
  case latest.recruitment_process
    when 'Phone Screen' then 'HR Interview'
    when 'HR Interview' then 'Line Interview'
    when 'Line Interview' then 'Test'
    when 'Test' then 'Reference Check'
    when 'Reference Check' then 'Offer'
  end as next_stage,
  gen_random_uuid() as next_stage_instance_id
from latest
where latest.result = 1 and latest.recruitment_process <> 'Offer'
  and not exists (
    select 1 from public.recruitment_logs pending
    where pending.candidate_id = latest.candidate_id
      and pending.superseded_at is null and pending.result is null
  );

update public.recruitment_logs conflicting
set superseded_at = now(),
    superseded_by_stage_instance_id = missing.completed_stage_instance_id,
    superseded_reason = 'out-of-order next stage replaced by inferred Pending',
    migration_note = concat_ws('; ', nullif(conflicting.migration_note, ''),
      'migration conflict: next stage existed before the latest Pass')
from pipeline_missing_next missing
where conflicting.candidate_id = missing.candidate_id
  and conflicting.superseded_at is null
  and conflicting.recruitment_process = missing.next_stage
  and conflicting.round = 1;

insert into public.recruitment_logs (
  stage_instance_id, candidate_id, log_date, recruitment_process, round,
  result, remark, record_origin, migration_note
)
select next_stage_instance_id, candidate_id, next_opened_date, next_stage, 1,
  null, 'Created after latest migrated Pass', 'migration',
  'immediate next Pending inferred from latest non-Offer Pass'
from pipeline_missing_next;

-- Archive First Contact/Rejected/Withdrawn rows without inventing active
-- history. Legacy-only candidates use the narrowly documented null-replacement
-- exception; otherwise the link points to a real canonical stage instance.
with legacy_replacement as (
  select legacy.log_id,
    (
      select active.stage_instance_id
      from public.recruitment_logs active
      where active.candidate_id = legacy.candidate_id
        and active.superseded_at is null
        and active.recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
      order by active.log_id desc
      limit 1
    ) as replacement_stage_instance_id
  from public.recruitment_logs legacy
  where legacy.recruitment_process not in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
)
update public.recruitment_logs legacy
set superseded_at = coalesce(legacy.superseded_at, now()),
    superseded_by_stage_instance_id = legacy_replacement.replacement_stage_instance_id,
    superseded_reason = coalesce(legacy.superseded_reason,
      case when legacy_replacement.replacement_stage_instance_id is null
        then 'legacy-only non-active history archived without canonical replacement'
        else 'legacy non-active stage archived by paired-status migration' end),
    record_origin = 'migration',
    migration_note = concat_ws('; ', nullif(legacy.migration_note, ''),
      case when legacy_replacement.replacement_stage_instance_id is null
        then 'legacy-only archive without canonical replacement'
        else 'legacy stage linked to canonical active history' end)
from legacy_replacement
where legacy.log_id = legacy_replacement.log_id;

set constraints all immediate;

alter table public.recruitment_logs drop constraint if exists recruitment_logs_recruitment_process_check;
alter table public.recruitment_logs drop constraint if exists recruitment_logs_result_check;

alter table public.recruitment_logs
  add constraint recruitment_logs_recruitment_process_check check (
    recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
    or (record_origin = 'migration' and superseded_at is not null)
  ),
  add constraint recruitment_logs_result_check check (result in (0, 1)),
  add constraint recruitment_logs_record_origin_check check (record_origin in ('user', 'auto', 'migration', 'correction')),
  add constraint recruitment_logs_paired_status_check check (
    (result is null and outcome_date is null and outcome_interviewer is null and outcome_remark is null and outcome_recorded_at is null)
    or (result in (0, 1) and outcome_date is not null and outcome_recorded_at is not null)
  ),
  add constraint recruitment_logs_outcome_date_check check (result is null or outcome_date >= log_date),
  add constraint recruitment_logs_supersession_check check (
    (superseded_at is null and superseded_by_stage_instance_id is null and superseded_reason is null)
    or (
      superseded_at is not null and superseded_by_stage_instance_id is not null and superseded_reason is not null
      and superseded_by_stage_instance_id <> stage_instance_id
    )
    or (
      superseded_at is not null and superseded_by_stage_instance_id is null and superseded_reason is not null
      and record_origin = 'migration'
      and migration_note like '%legacy-only archive without canonical replacement%'
    )
  );

drop index if exists public.idx_recruitment_logs_candidate_latest;
drop index if exists public.idx_recruitment_logs_stage_result_date;
create index idx_recruitment_logs_candidate_latest
  on public.recruitment_logs(candidate_id, log_id desc) where superseded_at is null;
create index idx_recruitment_logs_stage_result_date
  on public.recruitment_logs(recruitment_process, result, coalesce(outcome_date, log_date) desc) where superseded_at is null;
create unique index uq_recruitment_logs_canonical_stage_round
  on public.recruitment_logs(candidate_id, recruitment_process, round) where superseded_at is null;
create unique index uq_recruitment_logs_current_pending
  on public.recruitment_logs(candidate_id) where superseded_at is null and result is null;

drop trigger if exists set_recruitment_logs_updated_at on public.recruitment_logs;
create trigger set_recruitment_logs_updated_at
before update on public.recruitment_logs
for each row execute function app_private.set_updated_at();

create or replace function app_private.protect_canonical_pipeline_log_delete()
returns trigger language plpgsql set search_path = public, app_private as $$
begin
  if old.superseded_at is null and current_setting('app.action', true) <> 'candidate:delete' then
    raise exception 'Canonical pipeline stage records cannot be deleted; use app_correct_pipeline_outcome_v2.';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_canonical_pipeline_log_delete on public.recruitment_logs;
create trigger protect_canonical_pipeline_log_delete
before delete on public.recruitment_logs
for each row execute function app_private.protect_canonical_pipeline_log_delete();

create or replace function app_private.assert_candidate_pipeline_open(p_candidate_id text)
returns void language plpgsql stable security definer set search_path = public, app_private as $$
begin
  if exists (select 1 from public.recruitment_logs where candidate_id = p_candidate_id and superseded_at is null and result = 0) then
    raise exception 'Pipeline update unavailable because this candidate has a failed stage.';
  end if;
  if (select count(distinct recruitment_process) from public.recruitment_logs
      where candidate_id = p_candidate_id and superseded_at is null and result = 1
        and recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')) = 6 then
    raise exception 'Pipeline update unavailable because this candidate completed all stages.';
  end if;
end;
$$;

create or replace function app_private.assert_pipeline_log_deletable(p_log_id bigint)
returns void language plpgsql stable security definer set search_path = public, app_private as $$
begin
  if exists (select 1 from public.recruitment_logs where log_id = p_log_id and superseded_at is null) then
    raise exception 'Canonical pipeline stage records cannot be deleted; use app_correct_pipeline_outcome_v2.';
  end if;
end;
$$;

-- Candidate pipeline v2. A canonical row owns both the editable Pending fields
-- and its immutable Outcome. Superseded rows remain available for audit/history.
create or replace function app_private.pipeline_stage_index(p_stage text)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select array_position(
    array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[],
    p_stage
  )
$$;

create or replace function app_private.pipeline_business_date()
returns date
language sql
stable
set search_path = pg_catalog
as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

create or replace function app_private.lock_pipeline_candidate(p_candidate_id text)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  perform app_private.assert_recruitment_writer();
  if p_candidate_id is null then raise exception 'PIPELINE_CANDIDATE_REQUIRED: Candidate is required.'; end if;
  if not app_private.can_manage_candidate(p_candidate_id) then
    raise exception 'PIPELINE_NOT_AUTHORIZED: You can update process only for candidates where you are person in charge.';
  end if;
  perform 1 from public.candidates where candidate_id = p_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;
end;
$$;

create or replace function public.app_update_pipeline_pending_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_pending jsonb := coalesce(payload -> 'pending', '{}'::jsonb);
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_previous_outcome_date date;
  v_row public.recruitment_logs%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage_instance_id, expected_updated_at, and pending.opened_date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id
    and stage_instance_id = v_stage_instance_id
    and superseded_at is null
  for update;

  if not found or v_row.result is not null then
    raise exception 'PIPELINE_NOT_CURRENT: The selected stage is not the current Pending stage.';
  end if;
  if v_row.updated_at <> v_expected_updated_at then
    raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.';
  end if;
  if exists (
    select 1 from public.recruitment_logs later
    where later.candidate_id = v_candidate_id
      and later.superseded_at is null
      and later.log_id > v_row.log_id
  ) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Pending opened date must be between the previous Outcome and the Bangkok business date.';
  end if;

  perform set_config('app.action', 'pipeline:pending-edit', true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      pending_edited_at = now(),
      pending_edited_by = auth.uid()
  where log_id = v_row.log_id
  returning * into v_row;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'stage_instance_id', v_row.stage_instance_id, 'updated_at', v_row.updated_at);
end;
$$;

create or replace function public.app_complete_pipeline_stage_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_pending jsonb := coalesce(payload -> 'pending', '{}'::jsonb);
  v_outcome jsonb := coalesce(payload -> 'outcome', '{}'::jsonb);
  v_next jsonb := coalesce(payload -> 'next_pending', '{}'::jsonb);
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_next_stage text := nullif(v_next ->> 'stage', '');
  v_next_round integer := coalesce(nullif(v_next ->> 'round', '')::integer, 1);
  v_next_opened_date date := nullif(v_next ->> 'opened_date', '')::date;
  v_expected_next_stage text;
  v_previous_outcome_date date;
  v_row public.recruitment_logs%rowtype;
  v_next_row public.recruitment_logs%rowtype;
  v_next_id uuid;
  v_handoff jsonb;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null or v_outcome_date is null or v_result is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage instance, expected timestamp, Pending date, and Pass/Fail outcome date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id
    and stage_instance_id = v_stage_instance_id
    and superseded_at is null
  for update;

  if not found or v_row.result is not null then raise exception 'PIPELINE_NOT_CURRENT: The selected stage is not Pending.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.superseded_at is null and later.log_id > v_row.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or v_outcome_date > app_private.pipeline_business_date()
    or v_outcome_date < v_opened_date
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must satisfy previous Outcome <= Pending <= Outcome <= Bangkok business date.';
  end if;

  if v_result = 0 then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Fail cannot create a next Pending stage.'; end if;
  elsif v_row.recruitment_process = 'Offer' then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Offer Pass uses handoff and cannot create a next Pending stage.'; end if;
  elsif v_row.recruitment_process = 'Test' and v_next_stage = 'Test' then
    if v_next_round <> v_row.round + 1 then raise exception 'PIPELINE_INVALID_TRANSITION: The next Test round must be current round plus one.'; end if;
  else
    v_expected_next_stage := (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[app_private.pipeline_stage_index(v_row.recruitment_process) + 1];
    if v_next_stage is distinct from v_expected_next_stage or v_next_round <> 1 then
      raise exception 'PIPELINE_NEXT_PENDING_REQUIRED: Pass must create the immediate next stage as round 1 Pending.';
    end if;
  end if;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    if v_next_opened_date is null or v_next_opened_date < v_outcome_date or v_next_opened_date > app_private.pipeline_business_date() then
      raise exception 'PIPELINE_DATE_ORDER: Next Pending opened date must be between the Outcome and Bangkok business date.';
    end if;
  end if;

  perform set_config('app.action', case when v_result = 1 then 'pipeline:pass' else 'pipeline:fail' end, true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      pending_edited_at = now(),
      pending_edited_by = auth.uid(),
      result = v_result,
      outcome_date = v_outcome_date,
      outcome_interviewer = nullif(v_outcome ->> 'interviewer', ''),
      outcome_remark = nullif(v_outcome ->> 'remark', ''),
      outcome_recorded_at = now()
  where log_id = v_row.log_id
  returning * into v_row;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    v_next_id := gen_random_uuid();
    perform set_config('app.action', 'pipeline:next-pending', true);
    insert into public.recruitment_logs (
      stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin
    ) values (
      v_next_id, v_candidate_id, v_next_opened_date, v_next_stage, v_next_round,
      nullif(v_next ->> 'interviewer', ''), null, nullif(v_next ->> 'remark', ''), 'auto'
    ) returning * into v_next_row;
    v_next_id := v_next_row.stage_instance_id;
  end if;

  if v_result = 1 and v_row.recruitment_process = 'Offer' then
    select jsonb_build_object(
      'candidate_id', v_candidate_id,
      'passed_date', v_outcome_date,
      'group_id', anchor.group_id,
      'requisitions', coalesce(jsonb_agg(jsonb_build_object(
        'doc_group_id', peer.doc_group_id,
        'doc_id', r.doc_id,
        'site', r.site,
        'position', r.position,
        'open_headcount', greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0)
      ) order by r.doc_id) filter (where r.doc_id is not null), '[]'::jsonb)
    ) into v_handoff
    from public.candidates c
    join public.document_groups anchor on anchor.doc_group_id = c.doc_group_id
    join public.document_groups peer on (anchor.group_id is not null and peer.group_id = anchor.group_id) or peer.doc_group_id = anchor.doc_group_id
    join public.requisitions r on r.doc_id = peer.doc_id and r.status = 'ongoing'
    left join lateral (
      select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null
    ) accepted on true
    where c.candidate_id = v_candidate_id
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
    group by anchor.group_id;

    if v_handoff is null
      or jsonb_array_length(coalesce(v_handoff -> 'requisitions', '[]'::jsonb)) = 0
    then
      raise exception 'PIPELINE_OFFER_HANDOFF_INELIGIBLE: Offer Pass requires an eligible ongoing requisition with open headcount.';
    end if;
  end if;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'completed_stage', jsonb_build_object(
      'stage_instance_id', v_row.stage_instance_id, 'stage', v_row.recruitment_process,
      'round', v_row.round, 'result', v_row.result, 'outcome_date', v_row.outcome_date,
      'updated_at', v_row.updated_at
    ),
    'next_stage', case when v_next_id is null then null else jsonb_build_object(
      'stage_instance_id', v_next_row.stage_instance_id, 'stage', v_next_row.recruitment_process,
      'round', v_next_row.round, 'opened_date', v_next_row.log_date, 'updated_at', v_next_row.updated_at
    ) end,
    'terminal', v_result = 0 or v_row.recruitment_process = 'Offer',
    'offer_handoff', v_handoff
  );
end;
$$;

create or replace function public.app_pass_pipeline_jump_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'current_stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_stages jsonb := coalesce(payload -> 'passed_stages', '[]'::jsonb);
  v_target jsonb := coalesce(payload -> 'target_pending', '{}'::jsonb);
  v_target_stage text := nullif(v_target ->> 'stage', '');
  v_target_date date := nullif(v_target ->> 'opened_date', '')::date;
  v_current public.recruitment_logs%rowtype;
  v_item jsonb;
  v_pending jsonb;
  v_outcome jsonb;
  v_stage text;
  v_opened_date date;
  v_outcome_date date;
  v_previous_date date;
  v_previous_outcome_date date;
  v_current_index integer;
  v_count integer := jsonb_array_length(v_stages);
  v_i integer;
  v_new_id uuid;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_count < 1 or v_target_stage is null or v_target_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: current instance, expected timestamp, passed stages, and target Pending are required.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_current.result is not null then raise exception 'PIPELINE_NOT_CURRENT: Jump requires the current Pending stage.'; end if;
  if v_current.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.superseded_at is null and later.log_id > v_current.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_current.log_id
  order by log_id desc limit 1;

  v_current_index := app_private.pipeline_stage_index(v_current.recruitment_process);
  if v_current_index is null or v_current_index + v_count > 6 then raise exception 'PIPELINE_INVALID_TRANSITION: Jump exceeds the active pipeline.'; end if;
  if v_target_stage <> (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[v_current_index + v_count] then
    raise exception 'PIPELINE_INVALID_TRANSITION: Jump target must immediately follow all confirmed Pass stages.';
  end if;

  for v_i in 0..v_count - 1 loop
    v_item := v_stages -> v_i;
    v_stage := nullif(v_item ->> 'stage', '');
    v_pending := coalesce(v_item -> 'pending', '{}'::jsonb);
    v_outcome := coalesce(v_item -> 'outcome', '{}'::jsonb);
    v_opened_date := nullif(v_pending ->> 'opened_date', '')::date;
    v_outcome_date := nullif(v_outcome ->> 'date', '')::date;
    if lower(coalesce(v_outcome ->> 'result', '')) not in ('pass', '1') then
      raise exception 'PIPELINE_INVALID_TRANSITION: Every jump Outcome must explicitly be Pass.';
    end if;
    if v_stage <> (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[v_current_index + v_i] then
      raise exception 'PIPELINE_INVALID_TRANSITION: Passed stages must be consecutive.';
    end if;
    if v_opened_date is null or v_outcome_date is null
      or v_opened_date > app_private.pipeline_business_date()
      or v_outcome_date > app_private.pipeline_business_date()
      or v_outcome_date < v_opened_date
      or (v_previous_outcome_date is not null and v_i = 0 and v_opened_date < v_previous_outcome_date)
      or (v_previous_date is not null and v_opened_date < v_previous_date)
    then
      raise exception 'PIPELINE_DATE_ORDER: Jump stage dates must be complete and nondecreasing.';
    end if;

    if v_i = 0 then
      if v_stage <> v_current.recruitment_process or coalesce(nullif(v_item ->> 'round', '')::integer, v_current.round) <> v_current.round then
        raise exception 'PIPELINE_INVALID_TRANSITION: The first passed stage must match the current Pending stage and round.';
      end if;
      perform set_config('app.action', 'pipeline:jump-pass', true);
      update public.recruitment_logs
      set log_date = v_opened_date,
          interviewer = nullif(v_pending ->> 'interviewer', ''),
          remark = nullif(v_pending ->> 'remark', ''),
          pending_edited_at = now(),
          pending_edited_by = auth.uid(),
          result = 1,
          outcome_date = v_outcome_date,
          outcome_interviewer = nullif(v_outcome ->> 'interviewer', ''),
          outcome_remark = nullif(v_outcome ->> 'remark', ''),
          outcome_recorded_at = now()
      where log_id = v_current.log_id;
    else
      perform set_config('app.action', 'pipeline:jump-pass', true);
      insert into public.recruitment_logs (
        candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
        outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at, record_origin
      ) values (
        v_candidate_id, v_opened_date, v_stage, coalesce(nullif(v_item ->> 'round', '')::integer, 1),
        nullif(v_pending ->> 'interviewer', ''), 1, nullif(v_pending ->> 'remark', ''),
        v_outcome_date, nullif(v_outcome ->> 'interviewer', ''),
        nullif(v_outcome ->> 'remark', ''), now(), 'auto'
      );
    end if;
    v_previous_date := v_outcome_date;
  end loop;

  if v_target_date < v_previous_date or v_target_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Target Pending date must be between the last Pass and Bangkok business date.';
  end if;
  v_new_id := gen_random_uuid();
  perform set_config('app.action', 'pipeline:jump-target-pending', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin
  ) values (
    v_new_id, v_candidate_id, v_target_date, v_target_stage, coalesce(nullif(v_target ->> 'round', '')::integer, 1),
    nullif(v_target ->> 'interviewer', ''), null, nullif(v_target ->> 'remark', ''), 'auto'
  );

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'completed_stage_instance_ids', (
      select coalesce(jsonb_agg(stage_instance_id order by log_id), '[]'::jsonb)
      from public.recruitment_logs
      where candidate_id = v_candidate_id and superseded_at is null and result = 1
        and log_id >= v_current.log_id and log_id < (select log_id from public.recruitment_logs where stage_instance_id = v_new_id)
    ),
    'next_stage', jsonb_build_object('stage_instance_id', v_new_id, 'stage', v_target_stage, 'round', coalesce(nullif(v_target ->> 'round', '')::integer, 1), 'opened_date', v_target_date)
  );
end;
$$;

create or replace function public.app_correct_pipeline_outcome_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_outcome jsonb := coalesce(payload -> 'outcome', '{}'::jsonb);
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_row public.recruitment_logs%rowtype;
  v_replacement public.recruitment_logs%rowtype;
  v_replacement_id uuid := gen_random_uuid();
  v_previous_outcome_date date;
  v_next_opened_date date;
begin
  perform app_private.assert_system_admin();
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_result is null or v_outcome_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and corrected Outcome are required.';
  end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;

  select * into v_row from public.recruitment_logs
  where candidate_id = v_candidate_id and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_row.result is null then raise exception 'PIPELINE_NOT_FOUND: A canonical completed stage is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Outcome changed after it was opened.'; end if;
  if v_result is distinct from v_row.result then
    raise exception 'PIPELINE_CORRECTION_RESULT_IMMUTABLE: Outcome correction cannot change Pass/Fail.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  select log_date into v_next_opened_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and log_id > v_row.log_id
  order by log_id limit 1;
  if v_outcome_date > app_private.pipeline_business_date()
    or v_outcome_date < v_row.log_date
    or (v_previous_outcome_date is not null and v_row.log_date < v_previous_outcome_date)
    or (v_next_opened_date is not null and v_outcome_date > v_next_opened_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must satisfy previous Outcome <= Pending <= corrected Outcome <= next Pending <= Bangkok business date.';
  end if;

  perform set_config('app.action', 'pipeline:outcome-correction-supersede', true);
  update public.recruitment_logs
  set superseded_at = now(),
      superseded_by_stage_instance_id = v_replacement_id,
      superseded_reason = 'outcome corrected by system admin'
  where log_id = v_row.log_id;

  perform set_config('app.action', 'pipeline:outcome-correction-replacement', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
    outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at,
    pending_edited_at, pending_edited_by, record_origin, migration_note,
    created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_row.log_date, v_row.recruitment_process, v_row.round, v_row.interviewer,
    v_row.result, v_row.remark, v_outcome_date, nullif(v_outcome ->> 'interviewer', ''),
    nullif(v_outcome ->> 'remark', ''), now(), v_row.pending_edited_at, v_row.pending_edited_by,
    'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text),
    v_row.created_at
  ) returning * into v_replacement;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'superseded_stage_instance_id', v_row.stage_instance_id,
    'replacement_stage', jsonb_build_object(
      'stage_instance_id', v_replacement.stage_instance_id,
      'stage', v_replacement.recruitment_process,
      'round', v_replacement.round,
      'result', v_replacement.result,
      'outcome_date', v_replacement.outcome_date,
      'updated_at', v_replacement.updated_at
    )
  );
end;
$$;

-- Legacy endpoints are compatibility adapters over the locked v2 transition
-- contract. They no longer accept arbitrary manual stage insertion.
create or replace function public.app_insert_recruitment_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage text := nullif(payload ->> 'recruitment_process', '');
  v_result smallint := nullif(payload ->> 'result', '')::smallint;
  v_event_date date := nullif(payload ->> 'log_date', '')::date;
  v_current public.recruitment_logs%rowtype;
  v_next_stage text;
  v_next jsonb := null;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_event_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: Date is required.'; end if;
  if v_event_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Date cannot be after the Bangkok business date.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is null
  order by log_id desc limit 1 for update;

  if not found then
    if v_stage <> 'Phone Screen' or v_result is not null
      or exists (select 1 from public.recruitment_logs where candidate_id = v_candidate_id and superseded_at is null)
    then
      raise exception 'PIPELINE_INVALID_TRANSITION: A candidate without canonical activity must start at Phone Screen Pending.';
    end if;
    perform set_config('app.action', 'pipeline:legacy-start-pending', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin)
    values (
      v_candidate_id, v_event_date, 'Phone Screen', 1, nullif(payload ->> 'interviewer', ''), null,
      nullif(payload ->> 'remark', ''), 'user'
    ) returning * into v_current;
    update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
    return jsonb_build_object('ok', true, 'id', v_current.log_id::text, 'stage_instance_id', v_current.stage_instance_id);
  end if;

  if v_stage <> v_current.recruitment_process then
    raise exception 'PIPELINE_INVALID_TRANSITION: Legacy Process Update can edit or complete only the current Pending stage.';
  end if;
  if v_result is null then
    return public.app_update_pipeline_pending_v2(jsonb_build_object(
      'candidate_id', v_candidate_id,
      'stage_instance_id', v_current.stage_instance_id,
      'expected_updated_at', v_current.updated_at,
      'pending', jsonb_build_object(
        'opened_date', v_event_date,
        'interviewer', nullif(payload ->> 'interviewer', ''),
        'remark', nullif(payload ->> 'remark', '')
      )
    ));
  end if;

  if v_result = 1 and v_current.recruitment_process <> 'Offer' then
    v_next_stage := (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[app_private.pipeline_stage_index(v_current.recruitment_process) + 1];
    v_next := jsonb_build_object('stage', v_next_stage, 'round', 1, 'opened_date', v_event_date);
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object(
      'opened_date', v_current.log_date,
      'interviewer', coalesce(nullif(payload ->> 'interviewer', ''), v_current.interviewer),
      'remark', coalesce(nullif(payload ->> 'remark', ''), v_current.remark)
    ),
    'outcome', jsonb_build_object(
      'result', v_result,
      'date', v_event_date,
      'interviewer', nullif(payload ->> 'interviewer', ''),
      'remark', nullif(payload ->> 'remark', '')
    ),
    'next_pending', v_next
  ));
end;
$$;

create or replace function public.app_insert_pipeline_passes(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_target_stage text := nullif(payload ->> 'target_stage', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_current public.recruitment_logs%rowtype;
  v_item jsonb;
  v_passed jsonb := '[]'::jsonb;
  v_last_date date;
  v_i integer;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is null
  order by log_id desc limit 1 for update;
  if not found then raise exception 'PIPELINE_NOT_CURRENT: A current Pending stage is required.'; end if;
  if jsonb_array_length(v_stages) < 1 then raise exception 'PIPELINE_INVALID_PAYLOAD: At least one passed stage is required.'; end if;

  for v_i in 0..jsonb_array_length(v_stages) - 1 loop
    v_item := v_stages -> v_i;
    v_last_date := nullif(v_item ->> 'log_date', '')::date;
    v_passed := v_passed || jsonb_build_array(jsonb_build_object(
      'stage', nullif(v_item ->> 'stage', ''),
      'round', coalesce(nullif(v_item ->> 'round', '')::integer, 1),
      'pending', jsonb_build_object(
        'opened_date', case when v_i = 0 then v_current.log_date else v_last_date end,
        'interviewer', coalesce(nullif(v_item ->> 'interviewer', ''), case when v_i = 0 then v_current.interviewer else null end),
        'remark', case when v_i = 0 then v_current.remark else nullif(v_item ->> 'pending_remark', '') end
      ),
      'outcome', jsonb_build_object(
        'result', 'pass', 'date', v_last_date,
        'interviewer', nullif(v_item ->> 'interviewer', ''), 'remark', nullif(v_item ->> 'remark', '')
      )
    ));
  end loop;

  return public.app_pass_pipeline_jump_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'current_stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'passed_stages', v_passed,
    'target_pending', jsonb_build_object('stage', v_target_stage, 'round', 1, 'opened_date', v_last_date)
  ));
end;
$$;

create or replace function public.app_insert_test_maintenance(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_current_test jsonb := coalesce(payload -> 'current_test', '{}'::jsonb);
  v_next_test jsonb := coalesce(payload -> 'next_test', '{}'::jsonb);
  v_current public.recruitment_logs%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is null
  order by log_id desc limit 1 for update;
  if not found or v_current.recruitment_process <> 'Test' then raise exception 'PIPELINE_NOT_CURRENT: Candidate must be in a Pending Test round.'; end if;
  if coalesce(nullif(v_current_test ->> 'round', '')::integer, v_current.round) <> v_current.round then
    raise exception 'PIPELINE_INVALID_TRANSITION: Current Test round does not match.';
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object(
      'opened_date', v_current.log_date,
      'interviewer', coalesce(nullif(v_current_test ->> 'interviewer', ''), v_current.interviewer),
      'remark', coalesce(nullif(v_current_test ->> 'remark', ''), v_current.remark)
    ),
    'outcome', jsonb_build_object(
      'result', 'pass', 'date', nullif(v_current_test ->> 'log_date', '')::date,
      'interviewer', nullif(v_current_test ->> 'interviewer', ''), 'remark', nullif(v_current_test ->> 'remark', '')
    ),
    'next_pending', jsonb_build_object(
      'stage', 'Test', 'round', nullif(v_next_test ->> 'round', '')::integer,
      'opened_date', nullif(v_next_test ->> 'log_date', '')::date,
      'interviewer', nullif(v_next_test ->> 'interviewer', ''), 'remark', nullif(v_next_test ->> 'remark', '')
    )
  ));
end;
$$;

create or replace function public.app_insert_pipeline_test_exit(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_extra jsonb := coalesce(payload -> 'extra_test_rounds', '[]'::jsonb);
  v_item jsonb;
  v_current public.recruitment_logs%rowtype;
begin
  if jsonb_array_length(v_extra) > 0 then
    raise exception 'PIPELINE_INVALID_TRANSITION: Complete additional Test rounds with Test maintenance before exiting Test.';
  end if;
  if payload ->> 'target_stage' <> 'Reference Check' or jsonb_array_length(v_stages) <> 1 then
    raise exception 'PIPELINE_INVALID_TRANSITION: Test exit must Pass one current Test round into Reference Check.';
  end if;
  v_item := v_stages -> 0;
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is null
  order by log_id desc limit 1 for update;
  if not found or v_current.recruitment_process <> 'Test' or coalesce(nullif(v_item ->> 'round', '')::integer, 0) <> v_current.round then
    raise exception 'PIPELINE_NOT_CURRENT: Test exit must use the current Pending Test round.';
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object('opened_date', v_current.log_date, 'interviewer', coalesce(nullif(v_item ->> 'interviewer', ''), v_current.interviewer), 'remark', v_current.remark),
    'outcome', jsonb_build_object('result', 'pass', 'date', nullif(v_item ->> 'log_date', '')::date, 'interviewer', nullif(v_item ->> 'interviewer', ''), 'remark', nullif(v_item ->> 'remark', '')),
    'next_pending', jsonb_build_object('stage', 'Reference Check', 'round', 1, 'opened_date', nullif(v_item ->> 'log_date', '')::date)
  ));
end;
$$;

revoke all on function public.app_update_pipeline_pending_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_update_pipeline_pending_v2(jsonb) to authenticated;
revoke all on function public.app_complete_pipeline_stage_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_complete_pipeline_stage_v2(jsonb) to authenticated;
revoke all on function public.app_pass_pipeline_jump_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_pass_pipeline_jump_v2(jsonb) to authenticated;
revoke all on function public.app_correct_pipeline_outcome_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_correct_pipeline_outcome_v2(jsonb) to authenticated;

-- Recompile existing entry points whose behavior depends on paired-status rows.
create or replace function public.app_delete_recruitment_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(payload ->> 'entity', '');
  v_id text := nullif(payload ->> 'id', '');
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
  v_deleted integer := 0;
begin
  perform app_private.assert_system_admin();

  if v_entity is null or v_id is null then
    raise exception 'Entity and ID are required.';
  end if;

  if v_entity = 'requisition' then
    if exists (
      select 1
      from public.candidates c
      join public.document_groups dg on dg.doc_group_id = c.doc_group_id
      where dg.doc_id = v_id
    ) then
      raise exception 'Cannot delete requisition because candidates are linked to it.';
    end if;

    perform set_config('app.action', 'requisition:delete', true);
    delete from public.requisitions where doc_id = v_id;

  elsif v_entity = 'requisition_log' then
    perform set_config('app.action', 'requisition_log:delete', true);
    delete from public.requisition_logs where log_id = v_id::bigint;

  elsif v_entity = 'position_group' then
    if exists(select 1 from public.document_groups where group_id = v_id) then
      raise exception 'Cannot delete sourcing group because requisitions are matched to it.';
    end if;

    perform set_config('app.action', 'position_group:delete', true);
    delete from public.position_groups where group_id = v_id;

  elsif v_entity = 'document_group' then
    if exists(select 1 from public.candidates where doc_group_id = v_id) then
      raise exception 'Cannot delete match because candidates are linked to it.';
    end if;

    perform set_config('app.action', 'document_group:delete', true);
    delete from public.document_groups where doc_group_id = v_id;

  elsif v_entity = 'candidate' then
    perform set_config('app.action', 'candidate:delete', true);
    delete from public.candidates where candidate_id = v_id;

  elsif v_entity = 'recruitment_log' then
    perform app_private.assert_pipeline_log_deletable(v_id::bigint);
    perform set_config('app.action', 'recruitment_log:delete', true);
    delete from public.recruitment_logs where log_id = v_id::bigint;

  elsif v_entity = 'offer' then
    perform set_config('app.action', 'offer:delete', true);
    delete from public.offers where offer_id = v_id::bigint;

  elsif v_entity = 'sourcing_weekly_update' then
    if v_week_start is null then
      raise exception 'Week start is required to delete a sourcing weekly update.';
    end if;

    perform set_config('app.action', 'sourcing_update:delete', true);
    delete from public.sourcing_weekly_updates
    where group_id = v_id
      and week_start = v_week_start;

  elsif v_entity = 'vacancy_weekly_snapshot' then
    perform set_config('app.action', 'vacancy_snapshot:delete', true);
    delete from public.vacancy_weekly_snapshots where snapshot_id = v_id::bigint;

  else
    raise exception 'Delete is not allowed for entity "%".', v_entity;
  end if;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Record not found.';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'entity', v_entity);
end;
$$;

create or replace function public.app_upsert_candidate(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_doc_group_id text := nullif(payload ->> 'doc_group_id', '');
  v_exists boolean;
  v_initial_log_date date;
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_doc_group(v_doc_group_id) then raise exception 'You can create candidates only for requisitions where you are person in charge.'; end if;

  if v_mode = 'new' then
    v_candidate_id := app_private.next_app_id('candidates', 'CAN');
  elsif v_candidate_id is null then
    raise exception 'Candidate ID is required in Change mode.';
  end if;

  select exists(select 1 from public.candidates where candidate_id = v_candidate_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Candidate ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Candidate ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can edit candidates only for requisitions where you are person in charge.'; end if;

  perform set_config('app.action', 'candidate:' || v_mode, true);
  insert into public.candidates (candidate_id, name, phone_no, doc_group_id, channel, ref_name, first_contact_date, candidate_folder_url)
  values (
    v_candidate_id,
    nullif(payload ->> 'name', ''),
    nullif(payload ->> 'phone_no', ''),
    v_doc_group_id,
    nullif(payload ->> 'channel', ''),
    nullif(payload ->> 'ref_name', ''),
    nullif(payload ->> 'first_contact_date', '')::date,
    nullif(payload ->> 'candidate_folder_url', '')
  )
  on conflict (candidate_id) do update set
    name = excluded.name,
    phone_no = excluded.phone_no,
    doc_group_id = excluded.doc_group_id,
    channel = excluded.channel,
    ref_name = excluded.ref_name,
    first_contact_date = excluded.first_contact_date,
    candidate_folder_url = excluded.candidate_folder_url;

  if v_mode = 'new' then
    v_initial_log_date := coalesce(nullif(payload ->> 'first_contact_date', '')::date, current_date);
    if v_initial_log_date > (now() at time zone 'Asia/Bangkok')::date then
      raise exception 'PIPELINE_DATE_ORDER: Initial Pending date cannot be after the Bangkok business date.';
    end if;
    perform set_config('app.action', 'recruitment_log:auto-phone-screen', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin)
    values (v_candidate_id, v_initial_log_date, 'Phone Screen', 1, null, null, 'Initial pending phone screening', 'auto');
  end if;

  return jsonb_build_object('ok', true, 'id', v_candidate_id);
end;
$$;

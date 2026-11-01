-- Synchronize application behavior with main; preserve all records and legacy helpers.
-- New tables expose SELECT only to authenticated; mutations use service_role.
begin;

create table if not exists public."interview_invitation_templates" (
  "template_id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "language" text not null,
  "subject_template" text not null,
  "body_template" text not null,
  "active" boolean default true not null,
  "version" integer default 1 not null,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null
);

create table if not exists public."interview_meetings" (
  "meeting_id" uuid default gen_random_uuid() not null,
  "candidate_id" text not null,
  "stage_instance_id" uuid not null,
  "stage" text not null,
  "starts_at" timestamptz not null,
  "ends_at" timestamptz not null,
  "interviewer_emails" text[] not null,
  "note" text,
  "status" text not null,
  "organizer_mailbox" text,
  "teams_event_id" text,
  "join_url" text,
  "flow_run_id" text,
  "failure_summary" text,
  "created_by" uuid,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  "invitation_template_id" uuid,
  "invitation_template_version" integer,
  "invitation_language" text,
  "invitation_subject" text,
  "invitation_body" text
);

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_invitation_templates'::regclass and conname='interview_invitation_templates_body_template_check') then
alter table public."interview_invitation_templates" add constraint "interview_invitation_templates_body_template_check" CHECK ((NULLIF(btrim(body_template), ''::text) IS NOT NULL));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_invitation_templates'::regclass and conname='interview_invitation_templates_created_by_fkey') then
alter table public."interview_invitation_templates" add constraint "interview_invitation_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_invitation_templates'::regclass and conname='interview_invitation_templates_language_check') then
alter table public."interview_invitation_templates" add constraint "interview_invitation_templates_language_check" CHECK ((language = ANY (ARRAY['th'::text, 'en'::text])));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_invitation_templates'::regclass and conname='interview_invitation_templates_name_check') then
alter table public."interview_invitation_templates" add constraint "interview_invitation_templates_name_check" CHECK ((NULLIF(btrim(name), ''::text) IS NOT NULL));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_invitation_templates'::regclass and conname='interview_invitation_templates_pkey') then
alter table public."interview_invitation_templates" add constraint "interview_invitation_templates_pkey" PRIMARY KEY (template_id);
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_invitation_templates'::regclass and conname='interview_invitation_templates_subject_template_check') then
alter table public."interview_invitation_templates" add constraint "interview_invitation_templates_subject_template_check" CHECK ((NULLIF(btrim(subject_template), ''::text) IS NOT NULL));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_invitation_templates'::regclass and conname='interview_invitation_templates_updated_by_fkey') then
alter table public."interview_invitation_templates" add constraint "interview_invitation_templates_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_invitation_templates'::regclass and conname='interview_invitation_templates_version_check') then
alter table public."interview_invitation_templates" add constraint "interview_invitation_templates_version_check" CHECK ((version > 0));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_candidate_id_fkey') then
alter table public."interview_meetings" add constraint "interview_meetings_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES candidates(candidate_id) ON DELETE CASCADE;
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_check') then
alter table public."interview_meetings" add constraint "interview_meetings_check" CHECK ((ends_at > starts_at));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_created_by_fkey') then
alter table public."interview_meetings" add constraint "interview_meetings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_interviewer_emails_check') then
alter table public."interview_meetings" add constraint "interview_meetings_interviewer_emails_check" CHECK ((cardinality(interviewer_emails) > 0));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_invitation_language_check') then
alter table public."interview_meetings" add constraint "interview_meetings_invitation_language_check" CHECK ((invitation_language = ANY (ARRAY['th'::text, 'en'::text])));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_invitation_template_id_fkey') then
alter table public."interview_meetings" add constraint "interview_meetings_invitation_template_id_fkey" FOREIGN KEY (invitation_template_id) REFERENCES interview_invitation_templates(template_id) ON DELETE SET NULL;
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_pkey') then
alter table public."interview_meetings" add constraint "interview_meetings_pkey" PRIMARY KEY (meeting_id);
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_stage_check') then
alter table public."interview_meetings" add constraint "interview_meetings_stage_check" CHECK ((stage = ANY (ARRAY['HR Interview'::text, 'Line Interview'::text])));
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_stage_instance_id_fkey') then
alter table public."interview_meetings" add constraint "interview_meetings_stage_instance_id_fkey" FOREIGN KEY (stage_instance_id) REFERENCES recruitment_logs(stage_instance_id) ON DELETE CASCADE;
end if; end $sync$;

do $sync$ begin
if not exists(select 1 from pg_constraint where conrelid='public.interview_meetings'::regclass and conname='interview_meetings_status_check') then
alter table public."interview_meetings" add constraint "interview_meetings_status_check" CHECK ((status = ANY (ARRAY['creating'::text, 'scheduled'::text, 'rescheduling'::text, 'cancelling'::text, 'cancelled'::text, 'failed'::text])));
end if; end $sync$;

do $sync$ begin if exists(select 1 from pg_constraint where conrelid='public.recruitment_logs'::regclass and conname='recruitment_logs_outcome_date_check') then alter table public.recruitment_logs rename constraint "recruitment_logs_outcome_date_check" to "recruitment_logs_check2"; end if; end $sync$;

do $sync$ begin if exists(select 1 from pg_constraint where conrelid='public.recruitment_logs'::regclass and conname='recruitment_logs_paired_status_check') then alter table public.recruitment_logs rename constraint "recruitment_logs_paired_status_check" to "recruitment_logs_check1"; end if; end $sync$;

do $sync$ begin if exists(select 1 from pg_constraint where conrelid='public.recruitment_logs'::regclass and conname='recruitment_logs_recruitment_process_check') then alter table public.recruitment_logs rename constraint "recruitment_logs_recruitment_process_check" to "recruitment_logs_check"; end if; end $sync$;

do $sync$ begin if exists(select 1 from pg_constraint where conrelid='public.recruitment_logs'::regclass and conname='recruitment_logs_supersession_check') then alter table public.recruitment_logs rename constraint "recruitment_logs_supersession_check" to "recruitment_logs_check3"; end if; end $sync$;

-- Expands allowed statuses; all 13 existing development drafts remain valid.
alter table public.rejection_letter_drafts drop constraint if exists rejection_letter_drafts_status_check;
alter table public.rejection_letter_drafts add constraint rejection_letter_drafts_status_check CHECK ((status = ANY (ARRAY['creating'::text, 'draft_created'::text, 'sending'::text, 'sent'::text, 'failed'::text])));

CREATE OR REPLACE FUNCTION public.app_create_group_match(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_doc_group_id text;
  v_group public.position_groups%rowtype;
begin
  perform app_private.assert_recruitment_writer();
  if v_doc_id is null or not exists(select 1 from public.requisitions where doc_id = v_doc_id) then
    raise exception 'Requisition does not exist.';
  end if;
  if not app_private.can_manage_requisition(v_doc_id) then
    raise exception 'You can match only requisitions where you are person in charge.';
  end if;
  select * into v_group from public.position_groups where group_id = v_group_id;
  if not found then raise exception 'Group ID does not exist.'; end if;
  if exists(select 1 from public.document_groups where doc_id = v_doc_id) then
    raise exception 'This requisition is already matched.';
  end if;

  v_doc_group_id := app_private.next_app_id('document_groups', 'DGRP');
  perform set_config('app.action', 'document_group:new', true);
  insert into public.document_groups (
    doc_group_id, doc_id, group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  )
  values (
    v_doc_group_id, v_doc_id, v_group_id, v_group.group_position,
    v_group.channel_fb, v_group.channel_jobthai, v_group.channel_jobtopgun, v_group.channel_jobdb, v_group.channel_jobbkk,
    v_group.channel_linkedin, v_group.channel_walkin, v_group.channel_referral, v_group.channel_others
  );

  return jsonb_build_object('ok', true, 'id', v_doc_group_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_daily_recruitment_summary(p_report_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with accepted_by_doc as (select doc_id, count(*)::int as accepted_count from public.offers where accepted_date is not null group by doc_id),
open_requisition_docs as (select r.doc_id, r.site, coalesce(nullif(r.person_in_charge, ''), 'Unassigned') as person_in_charge, greatest(r.head_count - coalesce(a.accepted_count, 0), 0) as open_headcount from public.requisitions r left join accepted_by_doc a on a.doc_id = r.doc_id where r.status not in ('filled','cancel') and greatest(r.head_count - coalesce(a.accepted_count, 0),0)>0),
responsibility_totals as (select site, person_in_charge, sum(open_headcount)::int as responsible_vacancy, count(*)::int as open_requisition_count from open_requisition_docs group by site, person_in_charge),
responsibility_candidates as (select distinct o.site, o.person_in_charge, c.candidate_id from open_requisition_docs o join public.document_groups dg on dg.doc_id=o.doc_id join public.candidates c on c.doc_group_id=dg.doc_group_id),
latest_candidate_logs as (select distinct on (l.candidate_id) l.candidate_id,l.recruitment_process,l.result from public.recruitment_logs l where l.superseded_at is null and l.superseded_by_stage_instance_id is null order by l.candidate_id,l.log_id desc),
candidate_state_counts as (select rc.site,rc.person_in_charge,case when l.candidate_id is null then 'No activity' when l.result=1 then l.recruitment_process || ' - Passed' when l.result=0 then l.recruitment_process || ' - Failed' else l.recruitment_process || ' - Pending' end as state,count(distinct rc.candidate_id)::int as candidate_count from responsibility_candidates rc left join latest_candidate_logs l on l.candidate_id=rc.candidate_id group by rc.site,rc.person_in_charge,state),
open_responsibilities as (select rt.site,rt.person_in_charge,rt.responsible_vacancy,rt.open_requisition_count,coalesce((select jsonb_object_agg(csc.state,csc.candidate_count order by csc.state) from candidate_state_counts csc where csc.site=rt.site and csc.person_in_charge=rt.person_in_charge),'{}'::jsonb) as candidate_states from responsibility_totals rt),
yesterday_new as (select doc_id,site,position,coalesce(nullif(person_in_charge,''),'Unassigned') as person_in_charge from public.requisitions where pr_approved_date=p_report_date-1),
yesterday_filled as (select distinct on (l.doc_id) l.doc_id,r.site,r.position,coalesce(nullif(r.person_in_charge,''),'Unassigned') as person_in_charge from public.requisition_logs l join public.requisitions r on r.doc_id=l.doc_id where l.log_date=p_report_date-1 and l.status='filled' order by l.doc_id,l.log_id desc),
yesterday_candidates as (select distinct on (c.candidate_id) c.candidate_id,c.name,dg.doc_id,r.site,r.position,coalesce(nullif(r.person_in_charge,''),'Unassigned') as person_in_charge from public.candidates c join public.document_groups dg on dg.doc_group_id=c.doc_group_id join public.requisitions r on r.doc_id=dg.doc_id where (c.created_at at time zone 'Asia/Bangkok')::date=p_report_date-1 order by c.candidate_id,dg.doc_id),
yesterday_accepted as (select o.doc_id,r.site,r.position,coalesce(nullif(r.person_in_charge,''),'Unassigned') as person_in_charge from public.offers o join public.requisitions r on r.doc_id=o.doc_id where o.accepted_date=p_report_date-1)
select jsonb_build_object('report_date',p_report_date,'open_responsibilities',coalesce((select jsonb_agg(to_jsonb(row) order by row.site,row.person_in_charge) from open_responsibilities row),'[]'::jsonb),'yesterday',jsonb_build_object('new_requisitions',coalesce((select jsonb_agg(to_jsonb(row) order by row.site,row.doc_id) from yesterday_new row),'[]'::jsonb),'filled_requisitions',coalesce((select jsonb_agg(to_jsonb(row) order by row.site,row.doc_id) from yesterday_filled row),'[]'::jsonb),'new_candidates',coalesce((select jsonb_agg(to_jsonb(row) order by row.site,row.name,row.candidate_id) from yesterday_candidates row),'[]'::jsonb),'accepted_offers',coalesce((select jsonb_agg(to_jsonb(row) order by row.site,row.doc_id) from yesterday_accepted row),'[]'::jsonb)));
$function$;

CREATE OR REPLACE FUNCTION public.app_insert_requisition_log(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_status text := nullif(payload ->> 'status', '');
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_requisition(v_doc_id) then raise exception 'You can update status only for requisitions where you are person in charge.'; end if;
  if v_status not in ('ongoing', 'filled', 'cancel') then raise exception 'Status must be ongoing, filled, or cancel.'; end if;

  perform set_config('app.action', 'requisition:status', true);
  insert into public.requisition_logs (doc_id, log_date, status, remark)
  values (v_doc_id, nullif(payload ->> 'log_date', '')::date, v_status, nullif(payload ->> 'remark', ''));

  update public.requisitions set status = v_status where doc_id = v_doc_id;
  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.assert_candidate_pipeline_open(p_candidate_id text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
begin
  if exists (
    select 1
    from public.recruitment_logs
    where candidate_id = p_candidate_id
      and superseded_at is null
      and result = 0
  ) then
    raise exception 'Pipeline update unavailable because this candidate has a failed stage.';
  end if;

  if (
    select count(distinct recruitment_process)
    from public.recruitment_logs
    where candidate_id = p_candidate_id
      and superseded_at is null
      and result = 1
      and recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
  ) = 6 then
    raise exception 'Pipeline update unavailable because this candidate completed all stages.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.assert_pipeline_log_deletable(p_log_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.recruitment_logs where log_id = p_log_id and superseded_at is null) then
    raise exception 'Canonical pipeline stage records cannot be deleted; use app_correct_pipeline_outcome_v2.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.assert_reference_check_passable(p_candidate_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_unresolved_count integer;
begin
  select count(*)::integer into v_unresolved_count
  from public.candidate_references reference
  left join public.candidate_reference_checks checked on checked.reference_id = reference.reference_id
  where reference.candidate_id = p_candidate_id
    and reference.status = 'available'
    and checked.reference_id is null;

  if v_unresolved_count > 0 then
    raise exception 'PIPELINE_REFERENCE_CHECKS_REQUIRED: % available reference(s) still need a saved check.', v_unresolved_count;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb;
  v_action text;
  v_entity_id text;
  v_email text;
begin
  v_row := coalesce(to_jsonb(new), to_jsonb(old));
  v_entity_id := case
    when tg_table_name = 'candidate_references' then v_row ->> 'reference_id'
    when tg_table_name = 'candidate_reference_checks' then v_row ->> 'check_id'
    else coalesce(
      v_row ->> 'doc_id', v_row ->> 'candidate_id', v_row ->> 'group_id', v_row ->> 'doc_group_id',
      v_row ->> 'offer_id', v_row ->> 'snapshot_id', v_row ->> 'log_id', v_row ->> 'week_start', 'unknown'
    )
  end;
  v_action := coalesce(nullif(current_setting('app.action', true), ''), lower(tg_op));
  v_email := coalesce(
    (select email from public.profiles where id = auth.uid()),
    auth.jwt() ->> 'email'
  );

  insert into public.change_logs (entity, entity_id, action, changed_by, changed_by_email, old_data, new_data)
  values (
    tg_table_name,
    v_entity_id,
    v_action,
    auth.uid(),
    v_email,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.enforce_reference_check_pass_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
begin
  if new.recruitment_process = 'Reference Check'
    and new.result = 1
    and coalesce(current_setting('app.action', true), '') in ('pipeline:pass', 'pipeline:jump-pass')
  then
    perform app_private.assert_reference_check_passable(new.candidate_id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.has_open_group_requisition(p_group_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.document_groups dg
    join public.requisitions r on r.doc_id = dg.doc_id
    left join lateral (
      select count(*)::integer as accepted_count
      from public.offers o
      where o.doc_id = r.doc_id
        and o.accepted_date is not null
        and o.start_confirmation is distinct from 'did_not_start'
    ) accepted on true
    where dg.group_id = p_group_id
      and r.status = 'ongoing'
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.protect_canonical_pipeline_log_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.superseded_at is null
    and coalesce(current_setting('app.action', true), '') <> 'candidate:delete'
  then
    raise exception 'Canonical pipeline stage records cannot be deleted; use app_correct_pipeline_outcome_v2.';
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_save_candidate_reference_check_v1(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_reference_id uuid := nullif(payload ->> 'reference_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_checked_date date := nullif(payload ->> 'checked_date', '')::date;
  v_duration integer := nullif(payload ->> 'duration_minutes', '')::integer;
  v_summary text := nullif(btrim(coalesce(payload ->> 'conversation_summary', '')), '');
  v_reference public.candidate_references%rowtype;
  v_check public.candidate_reference_checks%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if v_reference_id is null or v_checked_date is null or v_duration is null or v_duration <= 0 or v_summary is null then
    raise exception 'REFERENCE_CHECK_INVALID_PAYLOAD: reference, checked date, positive duration, and summary are required.';
  end if;
  if v_checked_date > app_private.pipeline_business_date() then
    raise exception 'REFERENCE_CHECK_DATE_ORDER: Check date cannot be after the Bangkok business date.';
  end if;
  select * into v_reference from public.candidate_references
  where reference_id = v_reference_id and candidate_id = v_candidate_id for update;
  if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
  if v_reference.status <> 'available' then raise exception 'REFERENCE_NOT_AVAILABLE: Only Available references can receive a saved check.'; end if;
  select * into v_check from public.candidate_reference_checks where reference_id = v_reference_id for update;
  if found then
    if v_expected_updated_at is null or v_check.updated_at <> v_expected_updated_at then
      raise exception 'REFERENCE_STALE_WRITE: The saved check changed after it was opened.';
    end if;
    perform set_config('app.action', 'candidate-reference-check:edit', true);
    update public.candidate_reference_checks
    set checked_date = v_checked_date, duration_minutes = v_duration, conversation_summary = v_summary, checked_by = auth.uid()
    where reference_id = v_reference_id returning * into v_check;
  else
    if v_expected_updated_at is not null then raise exception 'REFERENCE_STALE_WRITE: No saved check exists for the supplied timestamp.'; end if;
    perform set_config('app.action', 'candidate-reference-check:save', true);
    insert into public.candidate_reference_checks (
      reference_id, checked_date, duration_minutes, conversation_summary, checked_by
    ) values (v_reference_id, v_checked_date, v_duration, v_summary, auth.uid()) returning * into v_check;
  end if;
  return jsonb_build_object('ok', true, 'check_id', v_check.check_id, 'updated_at', v_check.updated_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_set_candidate_reference_status_v1(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_reference_id uuid := nullif(payload ->> 'reference_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_status text := lower(coalesce(nullif(payload ->> 'status', ''), ''));
  v_reason text := nullif(btrim(coalesce(payload ->> 'reason', '')), '');
  v_row public.candidate_references%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if v_reference_id is null or v_expected_updated_at is null or v_status not in ('available', 'unavailable', 'archived') then
    raise exception 'REFERENCE_INVALID_PAYLOAD: reference, expected timestamp, and a valid status are required.';
  end if;
  if v_status in ('unavailable', 'archived') and v_reason is null then
    raise exception 'REFERENCE_STATUS_REASON_REQUIRED: Unavailable and archived references require a reason.';
  end if;
  select * into v_row from public.candidate_references
  where reference_id = v_reference_id and candidate_id = v_candidate_id for update;
  if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'REFERENCE_STALE_WRITE: The reference changed after it was opened.'; end if;
  perform set_config('app.action', 'candidate-reference:' || v_status, true);
  update public.candidate_references
  set status = v_status,
      status_reason = case when v_status = 'available' then null else v_reason end,
      updated_by = auth.uid()
  where reference_id = v_reference_id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'reference_id', v_row.reference_id, 'status', v_row.status, 'updated_at', v_row.updated_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_upsert_candidate_reference_v1(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_reference_id uuid := nullif(payload ->> 'reference_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_channel_type text := lower(coalesce(nullif(payload ->> 'channel_type', ''), ''));
  v_other_label text := nullif(btrim(coalesce(payload ->> 'other_channel_label', '')), '');
  v_row public.candidate_references%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if nullif(btrim(coalesce(payload ->> 'reference_name', '')), '') is null
    or nullif(btrim(coalesce(payload ->> 'relationship', '')), '') is null
    or nullif(btrim(coalesce(payload ->> 'channel_value', '')), '') is null
    or v_channel_type not in ('phone', 'email', 'line', 'other')
    or (v_channel_type = 'other' and v_other_label is null)
  then
    raise exception 'REFERENCE_INVALID_PAYLOAD: name, relationship, channel type, and contact value are required; Other requires a label.';
  end if;

  if v_reference_id is null then
    perform set_config('app.action', 'candidate-reference:add', true);
    insert into public.candidate_references (
      candidate_id, reference_name, relationship, channel_type, channel_value, other_channel_label, created_by, updated_by
    ) values (
      v_candidate_id, btrim(payload ->> 'reference_name'), btrim(payload ->> 'relationship'), v_channel_type,
      btrim(payload ->> 'channel_value'), case when v_channel_type = 'other' then v_other_label else null end, auth.uid(), auth.uid()
    ) returning * into v_row;
  else
    if v_expected_updated_at is null then raise exception 'REFERENCE_STALE_WRITE: expected_updated_at is required when editing a reference.'; end if;
    select * into v_row from public.candidate_references
    where reference_id = v_reference_id and candidate_id = v_candidate_id for update;
    if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
    if v_row.updated_at <> v_expected_updated_at then raise exception 'REFERENCE_STALE_WRITE: The reference changed after it was opened.'; end if;
    perform set_config('app.action', 'candidate-reference:edit', true);
    update public.candidate_references
    set reference_name = btrim(payload ->> 'reference_name'),
        relationship = btrim(payload ->> 'relationship'),
        channel_type = v_channel_type,
        channel_value = btrim(payload ->> 'channel_value'),
        other_channel_label = case when v_channel_type = 'other' then v_other_label else null end,
        updated_by = auth.uid()
    where reference_id = v_reference_id
    returning * into v_row;
  end if;
  return jsonb_build_object('ok', true, 'reference_id', v_row.reference_id, 'updated_at', v_row.updated_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_upsert_position_group(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_exists boolean;
begin
  perform app_private.assert_recruitment_writer();
  if v_mode not in ('new', 'change') then
    raise exception 'mode must be new or change';
  end if;
  if v_mode = 'new' then
    v_group_id := app_private.next_app_id('position_groups', 'GRP');
  elsif v_group_id is null then
    raise exception 'Group ID is required in Change mode.';
  end if;

  select exists(select 1 from public.position_groups where group_id = v_group_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Group ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Group ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_sourcing_group(v_group_id) then
    raise exception 'You can edit only sourcing groups linked to requisitions where you are responsible.';
  end if;

  perform set_config('app.action', 'position_group:' || v_mode, true);
  insert into public.position_groups (
    group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  )
  values (
    v_group_id,
    nullif(payload ->> 'group_position', ''),
    coalesce((payload ->> 'channel_fb')::boolean, false),
    coalesce((payload ->> 'channel_jobthai')::boolean, false),
    coalesce((payload ->> 'channel_jobtopgun')::boolean, false),
    coalesce((payload ->> 'channel_jobdb')::boolean, false),
    coalesce((payload ->> 'channel_jobbkk')::boolean, false),
    coalesce((payload ->> 'channel_linkedin')::boolean, false),
    coalesce((payload ->> 'channel_walkin')::boolean, false),
    coalesce((payload ->> 'channel_referral')::boolean, false),
    coalesce((payload ->> 'channel_others')::boolean, false)
  )
  on conflict (group_id) do update set
    group_position = excluded.group_position,
    channel_fb = excluded.channel_fb,
    channel_jobthai = excluded.channel_jobthai,
    channel_jobtopgun = excluded.channel_jobtopgun,
    channel_jobdb = excluded.channel_jobdb,
    channel_jobbkk = excluded.channel_jobbkk,
    channel_linkedin = excluded.channel_linkedin,
    channel_walkin = excluded.channel_walkin,
    channel_referral = excluded.channel_referral,
    channel_others = excluded.channel_others;

  return jsonb_build_object('ok', true, 'id', v_group_id);
end;
$function$;

drop policy if exists "interview_invitation_templates_read" on public."interview_invitation_templates";
create policy "interview_invitation_templates_read" on public."interview_invitation_templates" as PERMISSIVE for SELECT to "authenticated" using ((active OR (app_private.current_app_role() = ANY (ARRAY['system_admin'::text, 'admin_recruiter'::text]))));

drop policy if exists "interview_meetings_read" on public."interview_meetings";
create policy "interview_meetings_read" on public."interview_meetings" as PERMISSIVE for SELECT to "authenticated" using (app_private.can_read_candidate(candidate_id));

drop policy if exists "rejection_letter_templates_read" on public."rejection_letter_templates";
create policy "rejection_letter_templates_read" on public."rejection_letter_templates" as PERMISSIVE for SELECT to "authenticated" using ((active OR (app_private.current_app_role() = ANY (ARRAY['system_admin'::text, 'admin_recruiter'::text]))));

drop trigger if exists "audit_interview_invitation_templates" on public."interview_invitation_templates";
CREATE TRIGGER audit_interview_invitation_templates AFTER INSERT OR DELETE OR UPDATE ON public.interview_invitation_templates FOR EACH ROW EXECUTE FUNCTION app_private.audit_row_change();

drop trigger if exists "set_interview_invitation_templates_updated_at" on public."interview_invitation_templates";
CREATE TRIGGER set_interview_invitation_templates_updated_at BEFORE UPDATE ON public.interview_invitation_templates FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

drop trigger if exists "audit_interview_meetings" on public."interview_meetings";
CREATE TRIGGER audit_interview_meetings AFTER INSERT OR DELETE OR UPDATE ON public.interview_meetings FOR EACH ROW EXECUTE FUNCTION app_private.audit_row_change();

drop trigger if exists "set_interview_meetings_updated_at" on public."interview_meetings";
CREATE TRIGGER set_interview_meetings_updated_at BEFORE UPDATE ON public.interview_meetings FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

revoke all on function public.app_daily_recruitment_summary(date) from public, anon, authenticated, service_role;

revoke all on function app_private.assert_candidate_pipeline_open(text) from public, anon, authenticated, service_role;

revoke all on function app_private.assert_pipeline_log_deletable(bigint) from public, anon, authenticated, service_role;

revoke all on function app_private.assert_reference_check_passable(text) from public, anon, authenticated, service_role;

revoke all on function app_private.can_read_candidate(text) from public, anon, authenticated, service_role;

revoke all on function app_private.enforce_reference_check_pass_gate() from public, anon, authenticated, service_role;

revoke all on function app_private.lock_pipeline_candidate(text) from public, anon, authenticated, service_role;

revoke all on function app_private.pipeline_business_date() from public, anon, authenticated, service_role;

revoke all on function app_private.pipeline_stage_index(text) from public, anon, authenticated, service_role;

revoke all on function app_private.protect_canonical_pipeline_log_delete() from public, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_interview_invitation_templates_active_language ON public.interview_invitation_templates USING btree (language, updated_at DESC) WHERE active;

CREATE INDEX IF NOT EXISTS idx_interview_meetings_candidate_stage ON public.interview_meetings USING btree (candidate_id, stage_instance_id, starts_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_meetings_active_stage ON public.interview_meetings USING btree (stage_instance_id) WHERE (status = ANY (ARRAY['creating'::text, 'scheduled'::text, 'rescheduling'::text, 'cancelling'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS uq_rejection_letter_delivery_per_failed_stage ON public.rejection_letter_drafts USING btree (candidate_id, failed_stage_instance_id) WHERE (status = ANY (ARRAY['sending'::text, 'sent'::text]));

alter table public."interview_invitation_templates" enable row level security;
revoke all on table public."interview_invitation_templates" from public, anon, authenticated;
grant select on table public."interview_invitation_templates" to authenticated;
grant all on table public."interview_invitation_templates" to service_role;

alter table public."interview_meetings" enable row level security;
revoke all on table public."interview_meetings" from public, anon, authenticated;
grant select on table public."interview_meetings" to authenticated;
grant all on table public."interview_meetings" to service_role;

grant execute on function public.app_daily_recruitment_summary(date) to service_role;

grant execute on function app_private.assert_candidate_pipeline_open(text) to authenticated;

grant execute on function app_private.assert_pipeline_log_deletable(bigint) to authenticated;

grant execute on function app_private.assert_reference_check_passable(text) to authenticated;

grant execute on function app_private.can_read_candidate(text) to authenticated;

grant execute on function app_private.enforce_reference_check_pass_gate() to authenticated;

grant execute on function app_private.lock_pipeline_candidate(text) to authenticated;

grant execute on function app_private.pipeline_business_date() to authenticated;

grant execute on function app_private.pipeline_stage_index(text) to authenticated;

grant execute on function app_private.protect_canonical_pipeline_log_delete() to authenticated;

notify pgrst, 'reload schema';
commit;

-- Reason catalog and structured, historical candidate failure outcomes.

create table if not exists public.rejection_reasons (
  reason_id uuid primary key default gen_random_uuid(),
  reason_kind text not null check (reason_kind in ('main', 'detail')),
  actor text not null check (actor in ('candidate', 'company')),
  parent_id uuid references public.rejection_reasons(reason_id),
  label_th text not null check (btrim(label_th) <> ''),
  label_en text not null check (btrim(label_en) <> ''),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reason_kind = 'main' and parent_id is null) or (reason_kind = 'detail' and parent_id is not null))
);

alter table public.recruitment_logs
  add column if not exists failure_actor text check (failure_actor in ('candidate', 'company')),
  add column if not exists failure_main_reason_id uuid,
  add column if not exists failure_detail_reason_id uuid,
  add column if not exists failure_reason_snapshot jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.recruitment_logs'::regclass and conname = 'recruitment_logs_failure_main_reason_fk') then
    alter table public.recruitment_logs add constraint recruitment_logs_failure_main_reason_fk foreign key (failure_main_reason_id) references public.rejection_reasons(reason_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.recruitment_logs'::regclass and conname = 'recruitment_logs_failure_detail_reason_fk') then
    alter table public.recruitment_logs add constraint recruitment_logs_failure_detail_reason_fk foreign key (failure_detail_reason_id) references public.rejection_reasons(reason_id);
  end if;
end $$;

-- Stable IDs let wording change without changing saved reason references.
with seed(code, actor, th, en, position) as (values
  ('c1', 'candidate', 'ค่าตอบแทนและสวัสดิการ', 'Compensation and benefits', 1),
  ('c2', 'candidate', 'ลักษณะงานและโอกาสเติบโต', 'Job scope and growth opportunities', 2),
  ('c3', 'candidate', 'สถานที่และเงื่อนไขการทำงาน', 'Workplace and working conditions', 3),
  ('c4', 'candidate', 'ความพร้อมและเหตุผลส่วนบุคคล', 'Readiness and personal reasons', 4),
  ('c5', 'candidate', 'กระบวนการสรรหา', 'Recruitment process', 5),
  ('e1', 'company', 'คุณสมบัติและประสบการณ์', 'Qualifications and experience', 1),
  ('e2', 'company', 'ทักษะและผลการประเมิน', 'Skills and assessment results', 2),
  ('e3', 'company', 'ค่าตอบแทนและเงื่อนไขการจ้าง', 'Compensation and employment terms', 3),
  ('e4', 'company', 'ความเหมาะสมกับลักษณะงาน', 'Fit for the role', 4),
  ('e5', 'company', 'การตรวจสอบและข้อกำหนดการจ้าง', 'Employment checks and requirements', 5)
)
insert into public.rejection_reasons (reason_id, reason_kind, actor, label_th, label_en, sort_order)
select md5('rejection-reason:' || code)::uuid, 'main', actor, th, en, position from seed
on conflict (reason_id) do nothing;

with seed(code, parent, actor, th, en, position) as (values
  ('c1_1','c1','candidate','เงินเดือนต่ำกว่าความคาดหวัง','Salary below expectations',1),
  ('c1_2','c1','candidate','สวัสดิการไม่ตรงความต้องการ','Benefits do not meet needs',2),
  ('c1_3','c1','candidate','ได้รับข้อเสนอให้อยู่ต่อจากนายจ้างเดิม','Received a counteroffer from current employer',3),
  ('c1_4','c1','candidate','ได้รับข้อเสนอที่ดีกว่าจากบริษัทอื่น','Received a better offer elsewhere',4),
  ('c2_1','c2','candidate','ลักษณะงานไม่ตรงความคาดหวัง','Job scope differs from expectations',1),
  ('c2_2','c2','candidate','ไม่สนใจตำแหน่งงาน','No longer interested in the position',2),
  ('c2_3','c2','candidate','โอกาสเติบโตไม่ตรงเป้าหมายอาชีพ','Growth opportunities do not match career goals',3),
  ('c3_1','c3','candidate','ระยะทางหรือการเดินทางไม่สะดวก','Commute is inconvenient',1),
  ('c3_2','c3','candidate','ไม่สะดวกทำงานวันเสาร์','Unable to work Saturdays',2),
  ('c3_3','c3','candidate','ไม่สะดวกทำงานเป็นกะ','Unable to work shifts',3),
  ('c3_4','c3','candidate','ไม่สะดวกกับสภาพแวดล้อมการทำงาน (ฝุ่น/กลิ่น)','Work environment is unsuitable (dust or odors)',4),
  ('c3_5','c3','candidate','ไม่สะดวกย้ายพื้นที่ทำงาน','Unable to relocate work location',5),
  ('c4_1','c4','candidate','ยังไม่พร้อมเปลี่ยนงาน','Not ready to change jobs',1),
  ('c4_2','c4','candidate','เหตุผลส่วนตัว','Personal reasons',2),
  ('c5_1','c5','candidate','ไม่สะดวกเข้าร่วมสัมภาษณ์หรือทดสอบ','Unable to attend interview or test',1),
  ('c5_2','c5','candidate','ไม่พึงพอใจประสบการณ์สรรหา','Unsatisfied with recruitment experience',2),
  ('c5_3','c5','candidate','ถอนตัวโดยไม่ระบุเหตุผล','Withdrew without giving a reason',3),
  ('e1_1','e1','company','วุฒิการศึกษาไม่ตรงข้อกำหนด','Education does not meet requirements',1),
  ('e1_2','e1','company','ประสบการณ์ยังไม่เพียงพอ','Insufficient experience',2),
  ('e1_3','e1','company','ขาดคุณสมบัติหรือใบอนุญาตที่จำเป็น','Missing required qualification or license',3),
  ('e2_1','e2','company','ทักษะเฉพาะทางไม่ตรงความต้องการ','Technical skills do not meet needs',1),
  ('e2_2','e2','company','ไม่สามารถอธิบายประสบการณ์ที่เกี่ยวข้องได้ชัดเจน','Unable to clearly explain relevant experience',2),
  ('e2_3','e2','company','ไม่สามารถตอบคำถามเกี่ยวกับงานได้ตามเกณฑ์','Job-related answers did not meet criteria',3),
  ('e2_4','e2','company','ผลสัมภาษณ์ไม่ผ่านเกณฑ์','Interview result did not meet criteria',4),
  ('e2_5','e2','company','ผลการทดสอบไม่ผ่านเกณฑ์','Test result did not meet criteria',5),
  ('e3_1','e3','company','เงินเดือนที่คาดหวังเกินโครงสร้าง','Expected salary exceeds pay structure',1),
  ('e3_2','e3','company','ไม่สามารถเริ่มงานตามกำหนด','Unable to start on schedule',2),
  ('e3_3','e3','company','ไม่สามารถปฏิบัติงานในพื้นที่ที่กำหนด','Unable to work at assigned location',3),
  ('e4_1','e4','company','ความคาดหวังไม่สอดคล้องกับหน้าที่ของตำแหน่ง','Expectations do not align with role duties',1),
  ('e4_2','e4','company','ไม่สอดคล้องกับ Leadership Competency','Does not meet leadership competency criteria',2),
  ('e5_1','e5','company','ข้อมูลประสบการณ์ทำงานไม่ตรงกับข้อเท็จจริงที่ตรวจสอบได้','Work history differs from verified facts',1),
  ('e5_2','e5','company','ไม่ผ่านการตรวจสอบบุคคลอ้างอิงตามเกณฑ์','Reference check did not meet criteria',2),
  ('e5_3','e5','company','ไม่ผ่านการตรวจสอบประวัติอาชญากรรม','Criminal background check did not pass',3),
  ('e5_4','e5','company','ไม่ผ่านเกณฑ์สุขภาพที่จำเป็นสำหรับตำแหน่ง','Does not meet role health requirements',4),
  ('e5_5','e5','company','เอกสารไม่ครบถ้วน','Incomplete documents',5)
)
insert into public.rejection_reasons (reason_id, reason_kind, actor, parent_id, label_th, label_en, sort_order)
select md5('rejection-reason:' || code)::uuid, 'detail', actor, md5('rejection-reason:' || parent)::uuid, th, en, position from seed
on conflict (reason_id) do nothing;


create or replace function app_private.guard_rejection_reason_edit()
returns trigger language plpgsql set search_path = public, app_private as $$
declare parent_row public.rejection_reasons%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (new.reason_id, new.reason_kind, new.actor, new.parent_id) is distinct from (old.reason_id, old.reason_kind, old.actor, old.parent_id) then
      raise exception 'REJECTION_REASON_IDENTITY_IMMUTABLE: Archive and create a new reason to change classification.';
    end if;
  end if;
  if new.reason_kind = 'detail' then
    select * into parent_row from public.rejection_reasons where reason_id = new.parent_id;
    if not found or parent_row.reason_kind <> 'main' or parent_row.actor <> new.actor then
      raise exception 'REJECTION_REASON_PARENT_INVALID: Detail must belong to a main reason for the same actor.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_rejection_reason_edit on public.rejection_reasons;
create trigger guard_rejection_reason_edit before insert or update on public.rejection_reasons for each row execute function app_private.guard_rejection_reason_edit();
drop trigger if exists set_rejection_reasons_updated_at on public.rejection_reasons;
create trigger set_rejection_reasons_updated_at before update on public.rejection_reasons for each row execute function app_private.set_updated_at();
drop trigger if exists audit_rejection_reasons on public.rejection_reasons;
create trigger audit_rejection_reasons after insert or update on public.rejection_reasons for each row execute function app_private.audit_row_change();

alter table public.rejection_reasons enable row level security;
drop policy if exists rejection_reasons_read on public.rejection_reasons;
create policy rejection_reasons_read on public.rejection_reasons for select to authenticated using (active or app_private.current_app_role() in ('system_admin', 'admin_recruiter'));
drop policy if exists rejection_reasons_insert on public.rejection_reasons;
create policy rejection_reasons_insert on public.rejection_reasons for insert to authenticated with check (app_private.current_app_role() in ('system_admin', 'admin_recruiter'));
drop policy if exists rejection_reasons_update on public.rejection_reasons;
create policy rejection_reasons_update on public.rejection_reasons for update to authenticated using (app_private.current_app_role() in ('system_admin', 'admin_recruiter')) with check (app_private.current_app_role() in ('system_admin', 'admin_recruiter'));
grant select, insert, update on public.rejection_reasons to authenticated;

create or replace function app_private.failure_reason_snapshot(p_actor text, p_main uuid, p_detail uuid)
returns jsonb language plpgsql stable set search_path = public, app_private as $$
declare v_main public.rejection_reasons%rowtype; v_detail public.rejection_reasons%rowtype;
begin
  if p_actor not in ('candidate', 'company') or p_main is null or p_detail is null then
    raise exception 'REJECTION_REASON_REQUIRED: Select who ended the process, a main reason, and a detailed reason.';
  end if;
  select * into v_main from public.rejection_reasons where reason_id = p_main and reason_kind = 'main' and actor = p_actor and active;
  select * into v_detail from public.rejection_reasons where reason_id = p_detail and reason_kind = 'detail' and parent_id = p_main and actor = p_actor and active;
  if v_main.reason_id is null or v_detail.reason_id is null then
    raise exception 'REJECTION_REASON_INVALID: The selected reasons are no longer active or do not belong together.';
  end if;
  return jsonb_build_object('actor', p_actor, 'main_th', v_main.label_th, 'main_en', v_main.label_en, 'detail_th', v_detail.label_th, 'detail_en', v_detail.label_en);
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
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_next_estimated_action_date date := nullif(v_next ->> 'estimated_action_date', '')::date;
  v_expected_next_stage text;
  v_previous_outcome_date date;
  v_next_opened_date date;
  v_row public.recruitment_logs%rowtype;
  v_next_row public.recruitment_logs%rowtype;
  v_next_id uuid;
  v_handoff jsonb;
  v_failure_snapshot jsonb;
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
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must satisfy previous Outcome <= Pending <= Outcome <= Bangkok business date.';
  end if;

  if v_result = 0 then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Fail cannot create a next Pending stage.'; end if;
    v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
  elsif v_row.recruitment_process = 'Offer' then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Offer Pass uses handoff and cannot create a next Pending stage.'; end if;
  elsif v_row.recruitment_process in ('Line Interview', 'Test') and v_next_stage = v_row.recruitment_process then
    if v_next_round <> v_row.round + 1 then raise exception 'PIPELINE_INVALID_TRANSITION: The next repeatable-stage round must be current round plus one.'; end if;
  else
    v_expected_next_stage := (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[app_private.pipeline_stage_index(v_row.recruitment_process) + 1];
    if v_next_stage is distinct from v_expected_next_stage or v_next_round <> 1 then
      raise exception 'PIPELINE_NEXT_PENDING_REQUIRED: Pass must create the immediate next stage as round 1 Pending.';
    end if;
  end if;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    -- The next Pending is created as part of this completion, so its date is
    -- always the selected Outcome date. Ignore legacy client-supplied values.
    v_next_opened_date := v_outcome_date;
    if v_next_estimated_action_date is not null and v_next_estimated_action_date < v_next_opened_date then
      raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Next estimated action date cannot be before the next Pending opened date.';
    end if;
  end if;

  perform set_config('app.action', case when v_result = 1 then 'pipeline:pass' else 'pipeline:fail' end, true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      estimated_action_date = v_estimated_action_date,
      pending_edited_at = now(),
      pending_edited_by = auth.uid(),
      result = v_result,
      outcome_date = v_outcome_date,
      outcome_interviewer = nullif(v_outcome ->> 'interviewer', ''),
      outcome_remark = nullif(v_outcome ->> 'remark', ''),
      failure_actor = case when v_result = 0 then v_outcome ->> 'failure_actor' else null end,
      failure_main_reason_id = case when v_result = 0 then nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid else null end,
      failure_detail_reason_id = case when v_result = 0 then nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid else null end,
      failure_reason_snapshot = v_failure_snapshot,
      outcome_recorded_at = now()
  where log_id = v_row.log_id
  returning * into v_row;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    v_next_id := gen_random_uuid();
    perform set_config('app.action', 'pipeline:next-pending', true);
    insert into public.recruitment_logs (
      stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, estimated_action_date, record_origin
    ) values (
      v_next_id, v_candidate_id, v_next_opened_date, v_next_stage, v_next_round,
      nullif(v_next ->> 'interviewer', ''), null, nullif(v_next ->> 'remark', ''), v_next_estimated_action_date, 'auto'
    ) returning * into v_next_row;
    v_next_id := v_next_row.stage_instance_id;
  end if;

  if v_result = 1 and v_row.recruitment_process = 'Offer' then
    select jsonb_build_object(
      'candidate_id', v_candidate_id,
      'passed_date', v_outcome_date,
      'group_id', c.group_id,
      'requisitions', coalesce(jsonb_agg(jsonb_build_object(
        'doc_group_id', peer.doc_group_id,
        'doc_id', r.doc_id,
        'site', r.site,
        'position', r.position,
        'open_headcount', greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0)
      ) order by r.doc_id) filter (where r.doc_id is not null), '[]'::jsonb)
    ) into v_handoff
    from public.candidates c
    join public.document_groups peer on peer.group_id = c.group_id
    join public.requisitions r on r.doc_id = peer.doc_id and r.status = 'ongoing'
    left join lateral (
      select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start'
    ) accepted on true
    where c.candidate_id = v_candidate_id
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
    group by c.group_id;

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
  v_failure_snapshot jsonb;
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
  if v_row.result = 0 then
    if v_outcome ? 'failure_actor' or v_outcome ? 'failure_main_reason_id' or v_outcome ? 'failure_detail_reason_id' then
      v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
    else
      v_failure_snapshot := v_row.failure_reason_snapshot;
    end if;
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
    failure_actor, failure_main_reason_id, failure_detail_reason_id, failure_reason_snapshot,
    pending_edited_at, pending_edited_by, record_origin, migration_note,
    created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_row.log_date, v_row.recruitment_process, v_row.round, v_row.interviewer,
    v_row.result, v_row.remark, v_outcome_date, nullif(v_outcome ->> 'interviewer', ''),
    nullif(v_outcome ->> 'remark', ''), now(),
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_actor', ''), v_row.failure_actor) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, v_row.failure_main_reason_id) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid, v_row.failure_detail_reason_id) else null end,
    v_failure_snapshot, v_row.pending_edited_at, v_row.pending_edited_by,
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

create or replace function public.app_correct_pipeline_stage_record_v3(payload jsonb)
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
  v_outcome jsonb := payload -> 'outcome';
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_row public.recruitment_logs%rowtype;
  v_replacement public.recruitment_logs%rowtype;
  v_replacement_id uuid := gen_random_uuid();
  v_previous_outcome_date date;
  v_next_opened_date date;
  v_failure_snapshot jsonb;
begin
  if app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then
    raise exception 'PIPELINE_ADMIN_REQUIRED: System admin or admin recruiter role is required.';
  end if;
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and Pending date are required.';
  end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;

  select * into v_row from public.recruitment_logs
  where candidate_id = v_candidate_id and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found then raise exception 'PIPELINE_NOT_FOUND: A canonical pipeline record is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The pipeline record changed after it was opened.'; end if;
  if (v_row.result is null and v_outcome is not null) or (v_row.result is not null and (v_outcome is null or v_result is null or v_outcome_date is null)) then
    raise exception 'PIPELINE_INVALID_PAYLOAD: Pending records have no Outcome; completed records require result and Outcome date.';
  end if;
  if v_row.result is not null and v_result is distinct from v_row.result then
    raise exception 'PIPELINE_CORRECTION_RESULT_IMMUTABLE: Outcome correction cannot change Pass/Fail.';
  end if;
  if v_row.result = 0 then
    if v_outcome ? 'failure_actor' or v_outcome ? 'failure_main_reason_id' or v_outcome ? 'failure_detail_reason_id' then
      v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
    else
      v_failure_snapshot := v_row.failure_reason_snapshot;
    end if;
  end if;

  select outcome_date into v_previous_outcome_date from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
    or (v_row.result is not null and (v_outcome_date > app_private.pipeline_business_date() or v_outcome_date < v_opened_date))
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must remain within the previous Outcome and this Pending/Outcome.';
  end if;

  perform set_config('app.action', 'pipeline:admin-record-correction-supersede', true);
  update public.recruitment_logs set superseded_at = now(), superseded_by_stage_instance_id = v_replacement_id,
    superseded_reason = 'pipeline record corrected by administrator' where log_id = v_row.log_id;
  perform set_config('app.action', 'pipeline:admin-record-correction-replacement', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
    estimated_action_date, outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at,
    failure_actor, failure_main_reason_id, failure_detail_reason_id, failure_reason_snapshot,
    pending_edited_at, pending_edited_by, record_origin, migration_note, created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_opened_date, v_row.recruitment_process, v_row.round,
    nullif(v_pending ->> 'interviewer', ''), case when v_row.result is null then null else v_result end, nullif(v_pending ->> 'remark', ''),
    v_estimated_action_date,
    case when v_row.result is null then null else v_outcome_date end,
    case when v_row.result is null then null else nullif(v_outcome ->> 'interviewer', '') end,
    case when v_row.result is null then null else nullif(v_outcome ->> 'remark', '') end,
    case when v_row.result is null then null else now() end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_actor', ''), v_row.failure_actor) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, v_row.failure_main_reason_id) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid, v_row.failure_detail_reason_id) else null end,
    v_failure_snapshot,
    now(), auth.uid(), 'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text), v_row.created_at
  ) returning * into v_replacement;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'superseded_stage_instance_id', v_row.stage_instance_id,
    'replacement_stage_instance_id', v_replacement.stage_instance_id, 'updated_at', v_replacement.updated_at);
end;
$$;

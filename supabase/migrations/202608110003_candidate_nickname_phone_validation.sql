-- Candidate identity additions. Existing invalid legacy phone values remain readable,
-- but every New/Change Candidate write must now supply a valid Thai mobile number.
alter table public.candidates add column if not exists nickname text;

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
  v_nickname text := nullif(btrim(payload ->> 'nickname'), '');
  v_phone_no text := nullif(payload ->> 'phone_no', '');
  v_references jsonb := coalesce(payload -> 'references', '[]'::jsonb);
  v_reference jsonb;
  v_exists boolean;
  v_initial_log_date date;
begin
  perform app_private.assert_recruitment_writer();
  if v_phone_no is null or v_phone_no !~ '^0[0-9]{9}$' then
    raise exception 'CANDIDATE_PHONE_INVALID: Phone No. must be exactly 10 digits beginning with 0.';
  end if;
  if not app_private.can_manage_doc_group(v_doc_group_id) then raise exception 'You can create candidates only for requisitions where you are person in charge.'; end if;
  if v_mode = 'new' and not exists (
    select 1 from public.document_groups dg join public.requisitions r on r.doc_id = dg.doc_id
    left join lateral (select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null) accepted on true
    where dg.doc_group_id = v_doc_group_id and r.status = 'ongoing' and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
  ) then
    raise exception 'CANDIDATE_GROUP_NOT_AVAILABLE: Group ID must be linked to an ongoing requisition with remaining headcount.';
  end if;
  if v_mode = 'new' then v_candidate_id := app_private.next_app_id('candidates', 'CAN');
  elsif v_candidate_id is null then raise exception 'Candidate ID is required in Change mode.'; end if;
  select exists(select 1 from public.candidates where candidate_id = v_candidate_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Candidate ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Candidate ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can edit candidates only for requisitions where you are person in charge.'; end if;
  perform set_config('app.action', 'candidate:' || v_mode, true);
  insert into public.candidates (candidate_id, name, nickname, phone_no, doc_group_id, channel, ref_name, first_contact_date, candidate_folder_url)
  values (v_candidate_id, nullif(payload ->> 'name', ''), v_nickname, v_phone_no, v_doc_group_id, nullif(payload ->> 'channel', ''), nullif(payload ->> 'ref_name', ''), nullif(payload ->> 'first_contact_date', '')::date, nullif(payload ->> 'candidate_folder_url', ''))
  on conflict (candidate_id) do update set
    name = excluded.name, nickname = excluded.nickname, phone_no = excluded.phone_no, doc_group_id = excluded.doc_group_id,
    channel = excluded.channel, ref_name = excluded.ref_name, first_contact_date = excluded.first_contact_date, candidate_folder_url = excluded.candidate_folder_url;
  for v_reference in select value from jsonb_array_elements(v_references) loop
    if nullif(btrim(coalesce(v_reference ->> 'reference_name', '')), '') is null or nullif(btrim(coalesce(v_reference ->> 'relationship', '')), '') is null
      or lower(coalesce(nullif(v_reference ->> 'channel_type', ''), '')) not in ('phone', 'email', 'line', 'other') or nullif(btrim(coalesce(v_reference ->> 'channel_value', '')), '') is null
      or (lower(v_reference ->> 'channel_type') = 'other' and nullif(btrim(coalesce(v_reference ->> 'other_channel_label', '')), '') is null) then
      raise exception 'REFERENCE_INVALID_PAYLOAD: Each candidate reference needs name, relationship, channel, and contact value; Other requires a label.';
    end if;
    perform set_config('app.action', 'candidate-reference:add', true);
    insert into public.candidate_references (candidate_id, reference_name, relationship, channel_type, channel_value, other_channel_label, created_by, updated_by)
    values (v_candidate_id, btrim(v_reference ->> 'reference_name'), btrim(v_reference ->> 'relationship'), lower(v_reference ->> 'channel_type'), btrim(v_reference ->> 'channel_value'), case when lower(v_reference ->> 'channel_type') = 'other' then nullif(btrim(v_reference ->> 'other_channel_label'), '') else null end, auth.uid(), auth.uid());
  end loop;
  if v_mode = 'new' then
    v_initial_log_date := coalesce(nullif(payload ->> 'first_contact_date', '')::date, current_date);
    if v_initial_log_date > (now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER: Initial Pending date cannot be after the Bangkok business date.'; end if;
    perform set_config('app.action', 'recruitment_log:auto-phone-screen', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin)
    values (v_candidate_id, v_initial_log_date, 'Phone Screen', 1, null, null, 'Initial pending phone screening', 'auto');
  end if;
  return jsonb_build_object('ok', true, 'id', v_candidate_id);
end;
$$;

create or replace function public.app_daily_recruitment_summary(p_report_date date)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with accepted_by_doc as (select doc_id, count(*)::int as accepted_count from public.offers where accepted_date is not null group by doc_id),
  open_requisition_docs as (select r.doc_id, r.site, coalesce(nullif(r.person_in_charge, ''), 'Unassigned') as person_in_charge, greatest(r.head_count - coalesce(a.accepted_count, 0), 0) as open_headcount from public.requisitions r left join accepted_by_doc a on a.doc_id = r.doc_id where r.status not in ('filled', 'cancel') and greatest(r.head_count - coalesce(a.accepted_count, 0), 0) > 0),
  responsibility_totals as (select site, person_in_charge, sum(open_headcount)::int as responsible_vacancy, count(*)::int as open_requisition_count from open_requisition_docs group by site, person_in_charge),
  responsibility_candidates as (select distinct o.site, o.person_in_charge, c.candidate_id from open_requisition_docs o join public.document_groups dg on dg.doc_id = o.doc_id join public.candidates c on c.doc_group_id = dg.doc_group_id),
  latest_candidate_logs as (select distinct on (l.candidate_id) l.candidate_id, l.recruitment_process, l.result from public.recruitment_logs l where l.superseded_at is null and l.superseded_by_stage_instance_id is null order by l.candidate_id, l.log_id desc),
  candidate_state_counts as (select rc.site, rc.person_in_charge, case when l.candidate_id is null then 'No activity' when l.result = 1 then l.recruitment_process || ' - Passed' when l.result = 0 then l.recruitment_process || ' - Failed' else l.recruitment_process || ' - Pending' end as state, count(distinct rc.candidate_id)::int as candidate_count from responsibility_candidates rc left join latest_candidate_logs l on l.candidate_id = rc.candidate_id group by rc.site, rc.person_in_charge, state),
  open_responsibilities as (select rt.site, rt.person_in_charge, rt.responsible_vacancy, rt.open_requisition_count, coalesce((select jsonb_object_agg(csc.state, csc.candidate_count order by csc.state) from candidate_state_counts csc where csc.site = rt.site and csc.person_in_charge = rt.person_in_charge), '{}'::jsonb) as candidate_states from responsibility_totals rt),
  yesterday_new as (select doc_id, site, position, coalesce(nullif(person_in_charge, ''), 'Unassigned') as person_in_charge from public.requisitions where pr_approved_date = p_report_date - 1),
  yesterday_filled as (select distinct on (l.doc_id) l.doc_id, r.site, r.position, coalesce(nullif(r.person_in_charge, ''), 'Unassigned') as person_in_charge from public.requisition_logs l join public.requisitions r on r.doc_id = l.doc_id where l.log_date = p_report_date - 1 and l.status = 'filled' order by l.doc_id, l.log_id desc),
  yesterday_candidates as (select distinct on (c.candidate_id) c.candidate_id, c.name, c.nickname, dg.doc_id, r.site, r.position, coalesce(nullif(r.person_in_charge, ''), 'Unassigned') as person_in_charge from public.candidates c join public.document_groups dg on dg.doc_group_id = c.doc_group_id join public.requisitions r on r.doc_id = dg.doc_id where (c.created_at at time zone 'Asia/Bangkok')::date = p_report_date - 1 order by c.candidate_id, dg.doc_id),
  yesterday_accepted as (select o.doc_id, r.site, r.position, coalesce(nullif(r.person_in_charge, ''), 'Unassigned') as person_in_charge from public.offers o join public.requisitions r on r.doc_id = o.doc_id where o.accepted_date = p_report_date - 1)
  select jsonb_build_object('report_date', p_report_date, 'open_responsibilities', coalesce((select jsonb_agg(to_jsonb(row) order by row.site, row.person_in_charge) from open_responsibilities row), '[]'::jsonb), 'yesterday', jsonb_build_object('new_requisitions', coalesce((select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_new row), '[]'::jsonb), 'filled_requisitions', coalesce((select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_filled row), '[]'::jsonb), 'new_candidates', coalesce((select jsonb_agg(to_jsonb(row) order by row.site, row.name, row.candidate_id) from yesterday_candidates row), '[]'::jsonb), 'accepted_offers', coalesce((select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_accepted row), '[]'::jsonb)));
$$;

revoke all on function public.app_upsert_candidate(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_candidate(jsonb) to authenticated;
revoke all on function public.app_daily_recruitment_summary(date) from public, anon, authenticated;
grant execute on function public.app_daily_recruitment_summary(date) to service_role;

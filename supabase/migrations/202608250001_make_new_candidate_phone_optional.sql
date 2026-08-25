-- New candidates may be created before a mobile number is known. Existing
-- candidates still require a valid number when changed.
create or replace function public.app_upsert_candidate(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_doc_group_id text;
  v_legacy_doc_group_id text := nullif(payload ->> 'doc_group_id', '');
  v_nickname text := nullif(btrim(payload ->> 'nickname'), '');
  v_phone_no text := nullif(payload ->> 'phone_no', '');
  v_references jsonb := coalesce(payload -> 'references', '[]'::jsonb);
  v_reference jsonb;
  v_exists boolean;
  v_initial_log_date date;
begin
  perform app_private.assert_recruitment_writer();
  if v_group_id is null then select group_id into v_group_id from public.document_groups where doc_group_id = v_legacy_doc_group_id; end if;
  if (v_mode = 'change' and v_phone_no is null) or (v_phone_no is not null and v_phone_no !~ '^0[0-9]{9}$') then raise exception 'CANDIDATE_PHONE_INVALID: Phone No. must be exactly 10 digits beginning with 0.'; end if;
  if not app_private.can_manage_sourcing_group(v_group_id) then raise exception 'You can create candidates only for sourcing groups you manage.'; end if;
  if v_mode = 'new' and not app_private.has_open_group_requisition(v_group_id) then raise exception 'CANDIDATE_GROUP_NOT_AVAILABLE: Group ID must contain an ongoing requisition with remaining headcount.'; end if;
  select doc_group_id into v_doc_group_id from public.document_groups where group_id = v_group_id order by doc_group_id limit 1;
  if v_doc_group_id is null then raise exception 'CANDIDATE_GROUP_NOT_AVAILABLE: Group must be linked to a requisition.'; end if;
  if v_mode = 'new' then v_candidate_id := app_private.next_app_id('candidates', 'CAN'); elsif v_candidate_id is null then raise exception 'Candidate ID is required in Change mode.'; end if;
  select exists(select 1 from public.candidates where candidate_id = v_candidate_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Candidate ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Candidate ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can edit only candidates in sourcing groups you manage.'; end if;
  perform set_config('app.action', 'candidate:' || v_mode, true);
  insert into public.candidates (candidate_id, name, nickname, phone_no, doc_group_id, group_id, channel, ref_name, first_contact_date, candidate_folder_url)
  values (v_candidate_id, nullif(payload ->> 'name', ''), v_nickname, v_phone_no, v_doc_group_id, v_group_id, nullif(payload ->> 'channel', ''), nullif(payload ->> 'ref_name', ''), nullif(payload ->> 'first_contact_date', '')::date, nullif(payload ->> 'candidate_folder_url', ''))
  on conflict (candidate_id) do update set name = excluded.name, nickname = excluded.nickname, phone_no = excluded.phone_no, doc_group_id = excluded.doc_group_id, group_id = excluded.group_id, channel = excluded.channel, ref_name = excluded.ref_name, first_contact_date = excluded.first_contact_date, candidate_folder_url = excluded.candidate_folder_url;
  for v_reference in select value from jsonb_array_elements(v_references) loop
    if nullif(btrim(coalesce(v_reference ->> 'reference_name', '')), '') is null or nullif(btrim(coalesce(v_reference ->> 'relationship', '')), '') is null or lower(coalesce(nullif(v_reference ->> 'channel_type', ''), '')) not in ('phone', 'email', 'line', 'other') or nullif(btrim(coalesce(v_reference ->> 'channel_value', '')), '') is null or (lower(v_reference ->> 'channel_type') = 'other' and nullif(btrim(coalesce(v_reference ->> 'other_channel_label', '')), '') is null) then raise exception 'REFERENCE_INVALID_PAYLOAD: Each candidate reference needs name, relationship, channel, and contact value; Other requires a label.'; end if;
    perform set_config('app.action', 'candidate-reference:add', true);
    insert into public.candidate_references (candidate_id, reference_name, relationship, channel_type, channel_value, other_channel_label, created_by, updated_by)
    values (v_candidate_id, btrim(v_reference ->> 'reference_name'), btrim(v_reference ->> 'relationship'), lower(v_reference ->> 'channel_type'), btrim(v_reference ->> 'channel_value'), case when lower(v_reference ->> 'channel_type') = 'other' then nullif(btrim(v_reference ->> 'other_channel_label'), '') else null end, auth.uid(), auth.uid());
  end loop;
  if v_mode = 'new' then
    v_initial_log_date := coalesce(nullif(payload ->> 'first_contact_date', '')::date, current_date);
    if v_initial_log_date > (now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER: Initial Pending date cannot be after the Bangkok business date.'; end if;
    perform set_config('app.action', 'recruitment_log:auto-phone-screen', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin) values (v_candidate_id, v_initial_log_date, 'Phone Screen', 1, null, null, 'Initial pending phone screening', 'auto');
  end if;
  return jsonb_build_object('ok', true, 'id', v_candidate_id);
end;
$$;

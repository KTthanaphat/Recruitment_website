-- Generated from canonical requisition status and receipt definitions.
create or replace function public.app_insert_requisition_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_status text := nullif(payload ->> 'status', '');
  v_log_id bigint;
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_requisition(v_doc_id) then raise exception 'You can update only requisitions where you are the person in charge or assigned to the site.'; end if;
  if v_status not in ('ongoing', 'filled', 'cancel') then raise exception 'Status must be ongoing, filled, or cancel.'; end if;

  perform set_config('app.action', 'requisition:status', true);
  insert into public.requisition_logs (doc_id, log_date, status, remark)
  values (v_doc_id, nullif(payload ->> 'log_date', '')::date, v_status, nullif(payload ->> 'remark', '')) returning log_id into v_log_id;

  update public.requisitions set status = v_status where doc_id = v_doc_id;
  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_doc_id, 'log_id', v_log_id);
end;
$$;

-- Exact-ID committed requisition receipts. Legacy mutation interfaces remain available.
create or replace function public.app_requisition_action_v1(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_operation text := payload->>'operation';
  v_payload jsonb := payload->'payload';
  v_request text := nullif(payload->>'request_id','');
  v_previous text;
  v_id text;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_groups jsonb;
  v_source_groups jsonb;
  v_log jsonb := null;
  v_changed jsonb;
  v_display jsonb;
begin
  if auth.uid() is null then raise exception 'REQUISITION_ACTION_NOT_AUTHORIZED'; end if;
  if v_request is null or length(v_request)>100 or jsonb_typeof(v_payload) is distinct from 'object'
    or v_operation is null or v_operation not in ('app_upsert_requisition','app_insert_requisition_log','app_set_requisition_priority_v1')
  then raise exception 'REQUISITION_ACTION_INVALID'; end if;
  v_previous := coalesce(nullif(v_payload->>'previous_doc_id',''),nullif(v_payload->>'doc_id',''));
  select to_jsonb(r) into v_before from public.requisitions r where r.doc_id=v_previous;
  select coalesce(jsonb_agg(distinct d.group_id) filter(where d.group_id is not null),'[]') into v_source_groups
    from public.document_groups d join public.position_groups g using(group_id) where d.doc_id=v_previous;
  case v_operation
    when 'app_upsert_requisition' then v_result:=public.app_upsert_requisition(v_payload);
    when 'app_insert_requisition_log' then v_result:=public.app_insert_requisition_log(v_payload);
    when 'app_set_requisition_priority_v1' then v_result:=public.app_set_requisition_priority_v1(v_payload);
  end case;
  v_id:=coalesce(v_result->>'id',v_payload->>'doc_id');
  select to_jsonb(r) into v_after from public.requisitions r where r.doc_id=v_id;
  select coalesce(jsonb_agg(distinct d.group_id) filter(where d.group_id is not null),'[]') into v_groups
    from public.document_groups d join public.position_groups g using(group_id) where d.doc_id=v_id;
  if v_after is not null then
    with links as (select array_agg(distinct d.group_id order by d.group_id) filter(where d.group_id is not null) ids from public.document_groups d where d.doc_id=v_id),
    offers as (select count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')::integer accepted,
      max(o.start_confirmed_at::date) filter(where o.start_confirmation='did_not_start') restart
      from public.offers o where o.doc_id=v_id and app_private.can_read_application(o.application_id)),
    candidates as (select count(distinct c.candidate_id)::integer total from public.candidate_applications a join public.candidates c using(candidate_id),links
      where a.group_id=any(coalesce(links.ids,'{}'::text[])) and app_private.can_read_application(a.application_id) and app_private.can_read_candidate(c.candidate_id))
    select jsonb_build_object('sourcing_group_ids',coalesce(links.ids,'{}'::text[]),'accepted_count',offers.accepted,
      'open_headcount',greatest((v_after->>'head_count')::integer-offers.accepted,0),'candidate_count',candidates.total,'sla_restart_date',offers.restart)
      into v_display from links,offers,candidates;
  end if;
  if v_after is not null and v_operation='app_insert_requisition_log' then
    select to_jsonb(l) into v_log from public.requisition_logs l
      where l.doc_id=v_id and l.log_id=(v_result->>'log_id')::bigint;
  end if;
  select coalesce(jsonb_agg(k),'[]') into v_changed from jsonb_object_keys(coalesce(v_after,v_before,'{}')) k
    where v_before->k is distinct from v_after->k;
  return v_result || jsonb_build_object('action_result',jsonb_build_object(
    'version',1,'request_id',v_request,'operation',v_operation,
    'previous_doc_id',v_previous,'doc_id',v_id,
    'requisition',v_after,'display',v_display,'removed',v_after is null,'updated_at',v_after->>'updated_at',
    'source_scope',case when v_before is null then null else jsonb_build_object(
      'site',v_before->>'site','person_in_charge',v_before->>'person_in_charge',
      'is_priority',v_before->'is_priority') end,
    'source_groups',v_source_groups,'groups',v_groups,'status_log',v_log,'changed_fields',v_changed,
    'effects',case when v_operation='app_upsert_requisition' and v_before is not null and not (v_changed ?| array['doc_id','site','person_in_charge','status','head_count','pr_approved_date','position','department','section','level','request_type','is_priority']) then '["records","detail","audit"]'::jsonb
      when v_operation='app_set_requisition_priority_v1'
      then '["records","counts","summary","reports","audit"]'::jsonb
      else '["records","counts","detail","summary","calendar","reports","audit"]'::jsonb end));
end;
$$;
revoke all on function public.app_requisition_action_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_requisition_action_v1(jsonb) to authenticated;

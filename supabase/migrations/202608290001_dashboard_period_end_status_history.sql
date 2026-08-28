-- The active-requisition report calculates a historical period-end state.
-- It needs every state transition, not only filled transitions.
create or replace function public.app_dashboard_company_report()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'An authenticated application profile is required.';
  end if;
  return jsonb_build_object(
    'requisitions', coalesce((select jsonb_agg(jsonb_build_object(
      'doc_id', r.doc_id, 'pr_approved_date', r.pr_approved_date, 'site', r.site,
      'position', r.position, 'department', r.department, 'section', r.section,
      'level', r.level, 'head_count', r.head_count, 'person_in_charge', r.person_in_charge,
      'line_manager', null, 'request_type', r.request_type, 'replacement_names', null,
      'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at
    ) order by r.site, r.doc_id) from public.requisitions r), '[]'::jsonb),
    'requisition_logs', coalesce((select jsonb_agg(jsonb_build_object(
      'log_id', l.log_id, 'doc_id', l.doc_id, 'log_date', l.log_date,
      'status', l.status, 'remark', l.remark, 'created_at', l.created_at
    ) order by l.log_date, l.log_id) from public.requisition_logs l), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
      'offer_id', o.offer_id, 'candidate_id', null, 'doc_id', o.doc_id,
      'accepted_date', o.accepted_date, 'first_working_date', o.first_working_date,
      'remark', o.remark, 'start_confirmation', o.start_confirmation,
      'start_confirmed_at', o.start_confirmed_at, 'start_confirmed_by', null,
      'start_confirmation_reason', null, 'created_at', o.created_at, 'updated_at', o.updated_at
    ) order by o.accepted_date, o.offer_id) from public.offers o where o.accepted_date is not null), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.app_dashboard_company_report() from public, anon;
grant execute on function public.app_dashboard_company_report() to authenticated;

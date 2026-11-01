-- All linked group PICs can read offer context and manage the journey, without requisition write privileges.
create or replace function app_private.can_read_requisition(p_doc_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_global_recruitment_reader() or exists(select 1 from public.requisitions r where r.doc_id=p_doc_id and app_private.current_app_role()='site_recruiter' and (r.site=app_private.current_profile_site() or lower(btrim(r.person_in_charge)) in (select lower(btrim(p.nickname)) from public.profiles p where p.id=auth.uid()) or lower(btrim(r.person_in_charge)) in (select lower(btrim(p.full_name)) from public.profiles p where p.id=auth.uid()) or exists(select 1 from public.document_groups d where d.doc_id=r.doc_id and app_private.is_group_pic(d.group_id))))
$$;
create or replace function app_private.can_read_candidate_audit(p_entity text,p_id text,p_old jsonb,p_new jsonb) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v jsonb:=coalesce(p_new,p_old,'{}'::jsonb); v_candidate text; v_application uuid;
begin
 if not app_private.is_global_recruitment_reader() then return false; end if;
 if app_private.is_profile_admin() then return true; end if;
 if p_entity='candidates' then return app_private.can_read_candidate(p_id); end if;
 v_candidate:=coalesce(v->>'candidate_id',p_old->>'candidate_id');
 if p_entity='candidate_notes' then return app_private.can_read_profile_note(v_candidate); end if;
 if p_entity='candidate_references' then return app_private.can_read_candidate(v_candidate); end if;
 if p_entity in ('candidate_applications','candidate_application_assignments','recruitment_logs','offers','candidate_reference_checks','candidate_requisitions') then
   v_application:=coalesce(nullif(v->>'application_id',''),nullif(p_old->>'application_id',''))::uuid;
   if v_application is not null then return app_private.can_read_application(v_application); end if;
   return v_candidate is not null and app_private.can_read_candidate(v_candidate);
 end if;
 return true;
end $$;
drop policy if exists requisitions_read on public.requisitions;
create policy requisitions_read on public.requisitions for select to authenticated using(app_private.can_read_requisition(doc_id));
create or replace function public.app_upsert_offer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_exists boolean;
  v_offer_id bigint;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_application(app_private.current_application_id()) then
    raise exception 'You can create offers only for requisitions where you are person in charge.';
  end if;
  if not exists (
    select 1
    from public.candidate_applications c
    join public.document_groups dg on dg.group_id = c.group_id
    where c.candidate_id = v_candidate_id and c.application_id = app_private.current_application_id() and dg.doc_id = v_doc_id
  ) then
    raise exception 'OFFER_CANDIDATE_GROUP_MISMATCH: Candidate must belong to the selected requisition''s sourcing group.';
  end if;

  select exists(select 1 from public.offers where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and doc_id = v_doc_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'This offer already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'This offer does not exist. Switch to New mode to create it.'; end if;

  perform set_config('app.action', 'offer:' || v_mode, true);
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not exists(select 1 from public.recruitment_logs where application_id=app_private.current_application_id() and recruitment_process='Offer' and result=1 and superseded_at is null) then raise exception 'OFFER_PASS_REQUIRED'; end if;
  if v_mode='new' and not exists(select 1 from public.requisitions r where r.doc_id=v_doc_id and r.status='ongoing' and r.head_count>(select count(*) from public.offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')) then raise exception 'OFFER_REQUISITION_NOT_AVAILABLE'; end if;
  insert into public.offers (candidate_id, doc_id, accepted_date, first_working_date, remark)
  values (
    v_candidate_id,
    v_doc_id,
    nullif(payload ->> 'accepted_date', '')::date,
    nullif(payload ->> 'first_working_date', '')::date,
    nullif(payload ->> 'remark', '')
  )
  on conflict (application_id, doc_id) do update set
    accepted_date = excluded.accepted_date,
    first_working_date = excluded.first_working_date,
    remark = excluded.remark
  returning offer_id into v_offer_id;

  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_offer_id::text);
end;
$$;
create or replace function public.app_confirm_offer_start_v1(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare
  v_offer public.offers%rowtype;
  v_outcome text := nullif(payload ->> 'start_confirmation', '');
  v_reason text := nullif(btrim(payload ->> 'reason'), '');
  v_expected timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  select * into v_offer from public.offers where offer_id = nullif(payload ->> 'offer_id', '')::bigint for update;
  if not found then raise exception 'OFFER_NOT_FOUND: Offer not found.'; end if;
  if not app_private.can_manage_application(v_offer.application_id) then raise exception 'OFFER_PERMISSION_DENIED: You cannot confirm this offer.'; end if;
  if v_expected is null or v_offer.updated_at <> v_expected then raise exception 'OFFER_STALE_WRITE: This offer changed after it was opened.'; end if;
  if v_outcome not in ('started', 'did_not_start') then raise exception 'OFFER_CONFIRMATION_INVALID: Select Started or Did not start.'; end if;
  if v_offer.accepted_date is null or v_offer.first_working_date is null or v_offer.first_working_date > v_today then raise exception 'OFFER_CONFIRMATION_NOT_DUE: Confirmation is available on or after the first working date.'; end if;
  if v_outcome = 'did_not_start' and v_reason is null then raise exception 'OFFER_CONFIRMATION_REASON_REQUIRED: Did not start requires a reason.'; end if;
  if v_offer.start_confirmation is not null and app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then raise exception 'OFFER_CONFIRMATION_CORRECTION_DENIED: Only an administrator can correct a saved confirmation.'; end if;
  perform set_config('app.action', case when v_offer.start_confirmation is null then 'offer:start-confirmed' else 'offer:start-confirmation-corrected' end, true);
  update public.offers set start_confirmation = v_outcome, start_confirmed_at = now(), start_confirmed_by = auth.uid(), start_confirmation_reason = case when v_outcome = 'did_not_start' then v_reason else null end where offer_id = v_offer.offer_id;
  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_offer.doc_id);
  return jsonb_build_object('ok', true, 'id', v_offer.offer_id::text);
end;
$$;

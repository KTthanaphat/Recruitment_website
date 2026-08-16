alter table public.offers
  add column if not exists start_confirmation text check (start_confirmation in ('started', 'did_not_start')),
  add column if not exists start_confirmed_at timestamptz,
  add column if not exists start_confirmed_by uuid references public.profiles(id),
  add column if not exists start_confirmation_reason text;
alter table public.offers drop constraint if exists offers_start_confirmation_check;
alter table public.offers add constraint offers_start_confirmation_check check (
  (start_confirmation is null and start_confirmed_at is null and start_confirmed_by is null and start_confirmation_reason is null)
  or (start_confirmation = 'started' and start_confirmed_at is not null and start_confirmed_by is not null and start_confirmation_reason is null)
  or (start_confirmation = 'did_not_start' and start_confirmed_at is not null and start_confirmed_by is not null and nullif(btrim(start_confirmation_reason), '') is not null)
);
create index if not exists offers_start_confirmation_due_idx on public.offers (first_working_date) where accepted_date is not null and first_working_date is not null and start_confirmation is null;

create or replace function app_private.refresh_requisition_status(p_doc_id text) returns void language plpgsql security definer set search_path = public as $$
declare v_head_count integer; v_status text; v_accepted_count integer; v_next_status text;
begin
  select head_count, status into v_head_count, v_status from public.requisitions where doc_id = p_doc_id;
  if not found or v_status = 'cancel' then return; end if;
  select count(*) into v_accepted_count from public.offers where doc_id = p_doc_id and accepted_date is not null and start_confirmation is distinct from 'did_not_start';
  v_next_status := case when v_accepted_count >= v_head_count then 'filled' else 'ongoing' end;
  if v_next_status <> v_status then update public.requisitions set status = v_next_status where doc_id = p_doc_id; end if;
end; $$;

create or replace function public.app_confirm_offer_start_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_offer public.offers%rowtype; v_outcome text := nullif(payload ->> 'start_confirmation', ''); v_reason text := nullif(btrim(payload ->> 'reason'), ''); v_expected timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz; v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform app_private.assert_recruitment_writer(); select * into v_offer from public.offers where offer_id = nullif(payload ->> 'offer_id', '')::bigint for update;
  if not found then raise exception 'OFFER_NOT_FOUND: Offer not found.'; end if;
  if not app_private.can_manage_requisition(v_offer.doc_id) or not app_private.can_manage_candidate(v_offer.candidate_id) then raise exception 'OFFER_PERMISSION_DENIED: You cannot confirm this offer.'; end if;
  if v_expected is null or v_offer.updated_at <> v_expected then raise exception 'OFFER_STALE_WRITE: This offer changed after it was opened.'; end if;
  if v_outcome not in ('started', 'did_not_start') then raise exception 'OFFER_CONFIRMATION_INVALID: Select Started or Did not start.'; end if;
  if v_offer.accepted_date is null or v_offer.first_working_date is null or v_offer.first_working_date > v_today then raise exception 'OFFER_CONFIRMATION_NOT_DUE: Confirmation is available on or after the first working date.'; end if;
  if v_outcome = 'did_not_start' and v_reason is null then raise exception 'OFFER_CONFIRMATION_REASON_REQUIRED: Did not start requires a reason.'; end if;
  if v_offer.start_confirmation is not null and app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then raise exception 'OFFER_CONFIRMATION_CORRECTION_DENIED: Only an administrator can correct a saved confirmation.'; end if;
  perform set_config('app.action', case when v_offer.start_confirmation is null then 'offer:start-confirmed' else 'offer:start-confirmation-corrected' end, true);
  update public.offers set start_confirmation = v_outcome, start_confirmed_at = now(), start_confirmed_by = auth.uid(), start_confirmation_reason = case when v_outcome = 'did_not_start' then v_reason else null end where offer_id = v_offer.offer_id;
  perform set_config('app.action', 'auto-status', true); perform app_private.refresh_requisition_status(v_offer.doc_id); return jsonb_build_object('ok', true, 'id', v_offer.offer_id::text);
end; $$;
revoke all on function public.app_confirm_offer_start_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_confirm_offer_start_v1(jsonb) to authenticated;

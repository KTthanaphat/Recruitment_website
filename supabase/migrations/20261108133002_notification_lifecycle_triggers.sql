create or replace function app_private.recruitment_notifications_offer_changed_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.generate_recruitment_notifications_v1();
  return new;
end;
$$;
revoke all on function app_private.recruitment_notifications_offer_changed_v1() from public, anon, authenticated;

create or replace function app_private.recruitment_notifications_offer_deleted_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.recruitment_notifications set resolved_at = now(), resolution_reason = 'offer_removed'
  where offer_id = old.offer_id and resolved_at is null;
  return old;
end;
$$;
revoke all on function app_private.recruitment_notifications_offer_deleted_v1() from public, anon, authenticated;

create or replace function app_private.recruitment_notifications_requisition_changed_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.generate_recruitment_notifications_v1();
  return new;
end;
$$;
revoke all on function app_private.recruitment_notifications_requisition_changed_v1() from public, anon, authenticated;

drop trigger if exists recruitment_notifications_offer_inserted on public.offers;
create trigger recruitment_notifications_offer_inserted after insert on public.offers
for each row execute function app_private.recruitment_notifications_offer_changed_v1();

drop trigger if exists recruitment_notifications_offer_dates_changed on public.offers;
create trigger recruitment_notifications_offer_dates_changed
after update of accepted_date, first_working_date, start_confirmation, doc_id on public.offers
for each row execute function app_private.recruitment_notifications_offer_changed_v1();

drop trigger if exists recruitment_notifications_offer_deleted on public.offers;
create trigger recruitment_notifications_offer_deleted before delete on public.offers
for each row execute function app_private.recruitment_notifications_offer_deleted_v1();

drop trigger if exists recruitment_notifications_requisition_owner_changed on public.requisitions;
create trigger recruitment_notifications_requisition_owner_changed
after update of person_in_charge on public.requisitions
for each row execute function app_private.recruitment_notifications_requisition_changed_v1();

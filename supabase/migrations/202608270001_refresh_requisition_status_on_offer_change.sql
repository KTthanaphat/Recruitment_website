-- Keep requisition status correct even when an offer is reassigned or removed.
create or replace function app_private.refresh_requisition_status_after_offer_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.action', 'auto-status', true);

  if tg_op = 'INSERT' then
    perform app_private.refresh_requisition_status(new.doc_id);
  elsif tg_op = 'DELETE' then
    perform app_private.refresh_requisition_status(old.doc_id);
  else
    if old.doc_id is distinct from new.doc_id then
      perform app_private.refresh_requisition_status(old.doc_id);
    end if;
    perform app_private.refresh_requisition_status(new.doc_id);
  end if;

  return null;
end;
$$;

drop trigger if exists refresh_requisition_status_after_offer_insert on public.offers;
create trigger refresh_requisition_status_after_offer_insert
after insert on public.offers
for each row execute function app_private.refresh_requisition_status_after_offer_change();

drop trigger if exists refresh_requisition_status_after_offer_delete on public.offers;
create trigger refresh_requisition_status_after_offer_delete
after delete on public.offers
for each row execute function app_private.refresh_requisition_status_after_offer_change();

drop trigger if exists refresh_requisition_status_after_offer_update on public.offers;
create trigger refresh_requisition_status_after_offer_update
after update of doc_id, accepted_date, start_confirmation on public.offers
for each row execute function app_private.refresh_requisition_status_after_offer_change();

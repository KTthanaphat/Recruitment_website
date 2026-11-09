-- Allow fixed ten-row Records pages without changing legacy callers or board paging.
do $ten_row_pages$
declare
  v_function record;
  v_definition text;
  v_supported integer := 0;
begin
  for v_function in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and p.proname in (
        'app_recruitment_list_v1','app_recruitment_applications_page_v1',
        'app_recruitment_history_page_v1','app_recruitment_requisitions_page_v1',
        'app_recruitment_groups_page_v1','app_recruitment_sourcing_page_v1',
        'app_recruitment_sourcing_records_page_v1','app_recruitment_offers_page_v1',
        'app_recruitment_audit_page_v1','app_pipeline_card_location_v1'
      )
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    if v_definition ~ 'p_limit not in \(25, *50, *100\)' then
      v_definition := regexp_replace(v_definition,
        'p_limit not in \(25, *50, *100\)', 'p_limit not in (10,25,50,100)', 'g');
      execute v_definition;
      v_supported := v_supported + 1;
    elsif v_definition ~ 'p_limit not in \(10, *25, *50, *100\)' then
      v_supported := v_supported + 1;
    end if;
  end loop;
  if v_supported < 9 then
    raise exception 'Expected recruitment paging functions were not found (%).',v_supported;
  end if;
end;
$ten_row_pages$;

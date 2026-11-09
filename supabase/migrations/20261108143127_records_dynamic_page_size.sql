do $migration$
declare r record; v_definition text; v_count integer := 0;
begin
  for r in
    select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and (p.proname='app_recruitment_list_v1' or p.proname in (
        'app_recruitment_applications_page_v1','app_recruitment_audit_page_v1',
        'app_recruitment_groups_page_v1','app_recruitment_history_page_v1',
        'app_recruitment_offers_page_v1','app_recruitment_requisitions_page_v1',
        'app_recruitment_sourcing_page_v1','app_recruitment_sourcing_records_page_v1'))
  loop
    v_definition := pg_get_functiondef(r.oid);
    if position('p_limit not in (7,10,25,50,100)' in v_definition)=0 then
      raise exception 'Unexpected page limit definition for %',r.proname;
    end if;
    execute replace(v_definition,'p_limit not in (7,10,25,50,100)','(p_limit < 1 or p_limit > 100)');
    v_count:=v_count+1;
  end loop;
  if v_count<>9 then raise exception 'Expected 9 list functions, found %',v_count; end if;
end;
$migration$;

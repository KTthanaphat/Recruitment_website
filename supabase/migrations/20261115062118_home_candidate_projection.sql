-- Preserve historical view column order as well as its invoker security and ACLs.
do $migration$
declare projection text;
begin
 select string_agg(case a.attname
 when 'group_id' then $expr$case when exists(select 1 from public.position_groups g where g.group_id=c.group_id and not g.is_secret) then c.group_id end as group_id$expr$
 when 'doc_group_id' then $expr$case when exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) left join public.position_groups g using(group_id) where d.doc_group_id=c.doc_group_id and not r.is_secret and g.is_secret is not true) then c.doc_group_id end as doc_group_id$expr$
 else format('c.%I',a.attname) end, ', ' order by a.attnum) into projection
 from pg_catalog.pg_attribute a where a.attrelid='app_private.report_candidates'::regclass and a.attnum>0 and not a.attisdropped;
 if projection is null then raise exception 'REPORT_CANDIDATES_VIEW_MISSING'; end if;
 execute 'create or replace view app_private.report_candidates with (security_invoker=true) as select '||projection||$query$ from public.candidates c where not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id) or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.candidate_id=c.candidate_id and not g.is_secret)$query$;
end $migration$;

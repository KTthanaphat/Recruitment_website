-- Add a reader-scoped, active-application priority flag only to returned registry page items.
do $priority_projection$
declare v_oid oid; v_definition text;
begin
 v_oid:='public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean,boolean)'::regprocedure;
 v_definition:=pg_get_functiondef(v_oid);
 if position('has_priority_requisition' in v_definition)>0 then return; end if;
 if position($old$jsonb_agg(item order by case when v_direction='asc'$old$ in v_definition)=0 then raise exception 'Candidate registry page projection was not found'; end if;
 execute replace(v_definition,$old$jsonb_agg(item order by case when v_direction='asc'$old$,$new$jsonb_agg((item || jsonb_build_object('has_priority_requisition',case when coalesce((item->>'masked')::boolean,false) then false else exists(select 1 from public.candidate_applications priority_app join public.document_groups priority_link on priority_link.group_id=priority_app.group_id join public.requisitions priority_req on priority_req.doc_id=priority_link.doc_id where priority_app.candidate_id=page_rows.candidate_id and priority_app.state='active' and priority_req.is_priority is true and app_private.can_read_application(priority_app.application_id) and app_private.can_read_requisition(priority_req.doc_id)) end)) order by case when v_direction='asc'$new$);
end;
$priority_projection$;

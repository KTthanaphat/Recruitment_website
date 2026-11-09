do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.app_recruitment_requisitions_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean)'::regprocedure) into definition;
 if strpos(definition,'''docIds''')>0 then return; end if;
 if strpos(definition,$old$('doc_id','position'$old$)=0 then raise exception 'Requisition selected-ID migration marker missing'; end if;
 definition:=replace(definition,$old$('doc_id','position'$old$,$new$('docIds','doc_id','position'$new$);
 if strpos(definition,$old$  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;$old$)=0 then raise exception 'Requisition selected-ID migration marker missing'; end if;
 definition:=replace(definition,$old$  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;$old$,$new$  if p_filters ? 'docIds' then
    if jsonb_typeof(p_filters->'docIds')<>'array' then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
    if jsonb_array_length(p_filters->'docIds')>100 or exists(select 1 from jsonb_array_elements(p_filters->'docIds') id where jsonb_typeof(id)<>'string' or btrim(id#>>'{}')='') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;$new$);
 if strpos(definition,$old$where app_private.can_read_requisition(r.doc_id)$old$)=0 then raise exception 'Requisition selected-ID migration marker missing'; end if;
 definition:=replace(definition,$old$where app_private.can_read_requisition(r.doc_id)$old$,$new$where app_private.can_read_requisition(r.doc_id)
      and (not (p_filters ? 'docIds') or r.doc_id in (select jsonb_array_elements_text(p_filters->'docIds')))$new$);
 execute definition;
end;
$migration$;

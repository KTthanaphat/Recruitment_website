-- All classification/link transitions serialize through one transaction lock.
-- Row triggers protect legacy RPCs and direct writes as well as the new UI.
create or replace function app_private.guard_secret_requisition() returns trigger language plpgsql security definer set search_path='' as $$
declare v_conflicts text;
begin
 if tg_op='UPDATE' and new.is_secret is not distinct from old.is_secret then return new; end if;
 if tg_op='INSERT' and not new.is_secret then return new; end if;
 perform pg_advisory_xact_lock(714213,1);
 if tg_op='INSERT' then
   if new.is_secret and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 elsif new.is_secret is distinct from old.is_secret then
   if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
   if not old.is_secret then raise exception 'ORDINARY_CANNOT_BECOME_SECRET'; end if;
   if current_setting('app.secret_reveal',true) is distinct from old.doc_id then raise exception 'SECRET_REVEAL_CONFIRMATION_REQUIRED'; end if;
   select string_agg(distinct d.group_id,', ' order by d.group_id) into v_conflicts from public.document_groups d
     join public.document_groups other on other.group_id=d.group_id and other.doc_id<>old.doc_id
     join public.requisitions r on r.doc_id=other.doc_id where d.doc_id=old.doc_id and r.is_secret;
   if v_conflicts is not null then raise exception 'SECRET_MIXED_GROUPS: %',v_conflicts; end if;
 end if;
 return new;
end $$;
create or replace function app_private.guard_secret_group() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.is_secret is not distinct from old.is_secret then return new; end if;
 if tg_op='INSERT' and not new.is_secret then return new; end if;
 perform pg_advisory_xact_lock(714213,1);
 if tg_op='INSERT' then
   if new.is_secret and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 elsif new.is_secret is distinct from old.is_secret then
   if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
   if new.is_secret then
     if current_setting('app.secret_link_ack',true) is distinct from old.group_id then raise exception 'SECRET_LINK_CONFIRMATION_REQUIRED'; end if;
     if exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=old.group_id and not r.is_secret) then raise exception 'SECRET_MIXED_GROUPS'; end if;
     if exists(select 1 from public.candidate_application_assignments x join public.candidate_applications a using(application_id) where x.group_id=old.group_id and a.group_id<>old.group_id) or exists(select 1 from public.candidate_application_assignments x join public.candidate_applications a using(application_id) where a.group_id=old.group_id and x.group_id<>old.group_id) then raise exception 'SECRET_CROSS_TYPE_HISTORY: Use a separate group and applications.'; end if;
   else
     if current_setting('app.secret_group_reveal',true) is distinct from old.group_id then raise exception 'SECRET_REVEAL_CONFIRMATION_REQUIRED'; end if;
     if exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=old.group_id and r.is_secret) then raise exception 'SECRET_MIXED_GROUPS'; end if;
   end if;
 end if;
 return new;
end $$;
create or replace function app_private.guard_secret_link() returns trigger language plpgsql security definer set search_path='' as $$
declare v_req boolean; v_group boolean;
begin
 perform pg_advisory_xact_lock(714213,1);
 if tg_op='DELETE' then return old; end if;
 select is_secret into v_req from public.requisitions where doc_id=new.doc_id for update;
 if new.group_id is null then if v_req and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;return new; end if;
 select is_secret into v_group from public.position_groups where group_id=new.group_id for update;
 if (v_req or v_group) and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 if v_req and not v_group then
   if exists(select 1 from public.document_groups where group_id=new.group_id) then raise exception 'SECRET_MIXED_GROUPS'; end if;
   if current_setting('app.secret_link_ack',true) is distinct from new.group_id then raise exception 'SECRET_LINK_CONFIRMATION_REQUIRED'; end if;
   update public.position_groups set is_secret=true where group_id=new.group_id;
 elsif not v_req and v_group then raise exception 'SECRET_MIXED_GROUPS'; end if;
 return new;
end $$;
create or replace function app_private.guard_secret_transfer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.group_id=old.group_id then return new; end if;
 perform pg_advisory_xact_lock(714213,1);
 if tg_op='UPDATE' and new.group_id<>old.group_id and (select is_secret from public.position_groups where group_id=new.group_id) is distinct from (select is_secret from public.position_groups where group_id=old.group_id) then raise exception 'SECRET_CROSS_TYPE_TRANSFER: Create a separate application.'; end if;
 if (select is_secret from public.position_groups where group_id=new.group_id) and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 return new;
end $$;
create or replace function app_private.after_secret_reveal() returns trigger language plpgsql security definer set search_path='' as $$
declare v_group text;
begin
 if old.is_secret and not new.is_secret then
  for v_group in select distinct group_id from public.document_groups where doc_id=new.doc_id and group_id is not null order by group_id loop
   perform set_config('app.secret_group_reveal',v_group,true);
   update public.position_groups set is_secret=false where group_id=v_group;
  end loop;
 end if;return new;
end $$;
create or replace function app_private.stamp_secret_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb:=coalesce(new.new_data,new.old_data,'{}');v_group text;v_doc text;v_app uuid;
begin
 v_group:=coalesce(v->>'group_id',new.old_data->>'group_id');v_doc:=coalesce(v->>'doc_id',new.old_data->>'doc_id');v_app:=nullif(coalesce(v->>'application_id',new.old_data->>'application_id'),'')::uuid;
 new.is_secret:=coalesce((v->>'is_secret')::boolean,false) or coalesce((new.old_data->>'is_secret')::boolean,false)
   or coalesce((select is_secret from public.position_groups where group_id=v_group),false)
   or coalesce((select is_secret from public.requisitions where doc_id=v_doc),false)
   or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where application_id=v_app and g.is_secret);
 return new;
end $$;
create or replace function app_private.classify_group_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.is_secret and not old.is_secret then
   update public.change_logs l set is_secret=true where (l.entity='position_groups' and l.entity_id=new.group_id)
    or coalesce(l.new_data->>'group_id',l.old_data->>'group_id')=new.group_id
    or coalesce(l.new_data->>'application_id',l.old_data->>'application_id') in (select application_id::text from public.candidate_applications where group_id=new.group_id)
    or (l.entity='candidates' and l.entity_id in(select candidate_id from public.candidate_applications where group_id=new.group_id));
 end if;return new;
end $$;
drop trigger if exists guard_secret_requisition on public.requisitions;
create trigger guard_secret_requisition before insert or update on public.requisitions for each row execute function app_private.guard_secret_requisition();
drop trigger if exists after_secret_reveal on public.requisitions;
create trigger after_secret_reveal after update on public.requisitions for each row execute function app_private.after_secret_reveal();
drop trigger if exists guard_secret_group on public.position_groups;
create trigger guard_secret_group before insert or update on public.position_groups for each row execute function app_private.guard_secret_group();
drop trigger if exists classify_group_audit on public.position_groups;
create trigger classify_group_audit after update on public.position_groups for each row execute function app_private.classify_group_audit();
drop trigger if exists guard_secret_link on public.document_groups;
create trigger guard_secret_link before insert or update or delete on public.document_groups for each row execute function app_private.guard_secret_link();
drop trigger if exists guard_secret_transfer on public.candidate_applications;
create trigger guard_secret_transfer before insert or update on public.candidate_applications for each row execute function app_private.guard_secret_transfer();
drop trigger if exists stamp_secret_audit on public.change_logs;
create trigger stamp_secret_audit before insert on public.change_logs for each row execute function app_private.stamp_secret_audit();

create or replace function public.app_reveal_secret_requisition_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.requisitions%rowtype;
begin
 if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 if coalesce((payload->>'confirmed')::boolean,false) is not true then raise exception 'SECRET_REVEAL_CONFIRMATION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(714213,1);
 select * into v from public.requisitions where doc_id=payload->>'doc_id' for update;
 if not found or not v.is_secret then raise exception 'SECRET_REQUISITION_UNAVAILABLE'; end if;
 if v.updated_at is distinct from (payload->>'expected_updated_at')::timestamptz then raise exception 'SECRET_STALE_WRITE'; end if;
 perform set_config('app.secret_reveal',v.doc_id,true);perform set_config('app.action','requisition:reveal',true);
 update public.requisitions set is_secret=false where doc_id=v.doc_id;
 return jsonb_build_object('ok',true,'id',v.doc_id);
end $$;
create or replace function public.app_reveal_secret_group_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.position_groups%rowtype;
begin
 if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 if coalesce((payload->>'confirmed')::boolean,false) is not true then raise exception 'SECRET_REVEAL_CONFIRMATION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(714213,1);
 select * into v from public.position_groups where group_id=payload->>'group_id' for update;
 if not found or not v.is_secret then raise exception 'SECRET_GROUP_UNAVAILABLE'; end if;
 if exists(select 1 from public.document_groups where group_id=v.group_id) then raise exception 'SECRET_GROUP_MUST_BE_UNLINKED'; end if;
 if v.updated_at is distinct from (payload->>'expected_updated_at')::timestamptz then raise exception 'SECRET_STALE_WRITE'; end if;
 perform set_config('app.secret_group_reveal',v.group_id,true);perform set_config('app.action','group:reveal',true);
 update public.position_groups set is_secret=false where group_id=v.group_id;
 return jsonb_build_object('ok',true,'id',v.group_id);
end $$;
revoke all on function public.app_reveal_secret_requisition_v1(jsonb),public.app_reveal_secret_group_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_reveal_secret_requisition_v1(jsonb),public.app_reveal_secret_group_v1(jsonb) to authenticated;
do $$ declare f record;begin for f in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in ('guard_secret_requisition','guard_secret_group','guard_secret_link','guard_secret_transfer','after_secret_reveal','stamp_secret_audit','classify_group_audit') loop execute format('revoke all on function %s from public,anon,authenticated',f.name);end loop;end $$;

drop policy if exists secret_audit_visibility on public.change_logs;
create policy secret_audit_visibility on public.change_logs as restrictive for select to authenticated using(not is_secret or app_private.secret_admin());
drop policy if exists secret_notification_visibility on public.recruitment_notifications;
create policy secret_notification_visibility on public.recruitment_notifications as restrictive for all to authenticated using(app_private.secret_requisition_access(doc_id) and app_private.secret_application_access(application_id)) with check(app_private.secret_requisition_access(doc_id) and app_private.secret_application_access(application_id));

create or replace function public.app_secret_link_review_v1(payload jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_ids text[];v_group text:=nullif(payload->>'group_id','');v_secret boolean;
begin
 if auth.uid() is null or not app_private.is_recruitment_writer() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
 if jsonb_typeof(payload->'doc_ids')='array' then select array_agg(value) into v_ids from jsonb_array_elements_text(payload->'doc_ids');else v_ids:=array[payload->>'doc_id'];end if;
 if cardinality(v_ids) is null or cardinality(v_ids)<1 or exists(select 1 from unnest(v_ids) id where not app_private.can_read_requisition(id)) then raise exception 'REQUISITION_UNAVAILABLE';end if;
 select bool_or(is_secret) into v_secret from public.requisitions where doc_id=any(v_ids);
 if (select count(*) from public.requisitions where doc_id=any(v_ids))<>cardinality(v_ids) then raise exception 'REQUISITION_UNAVAILABLE';end if;
 if v_group is not null and not app_private.secret_group_access(v_group) then raise exception 'GROUP_UNAVAILABLE';end if;
 return jsonb_build_object('requires_confirmation',coalesce(v_secret,false));
end $$;
revoke all on function public.app_secret_link_review_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_secret_link_review_v1(jsonb) to authenticated;
revoke all on function public.app_create_and_match_sourcing_group_v2(jsonb) from public,anon,authenticated;
grant execute on function public.app_create_and_match_sourcing_group_v2(jsonb) to authenticated;

create or replace function public.app_unlinked_groups_page_v1(p_after_id text default null,p_limit integer default 10)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
 if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED';end if;
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'GROUP_PAGE_LIMIT_INVALID';end if;
 with matches as materialized (
  select g.group_id,g.group_position,g.is_secret,g.updated_at from public.position_groups g
  where not exists(select 1 from public.document_groups d where d.group_id=g.group_id) and (p_after_id is null or g.group_id>p_after_id)
  order by g.group_id limit p_limit+1
 ),page as (select * from matches order by group_id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by group_id) from page p),'[]'::jsonb),'next_cursor',case when (select count(*) from matches)>p_limit then (select group_id from page order by group_id desc limit 1) end) into v_result;
 return v_result;
end $$;
revoke all on function public.app_unlinked_groups_page_v1(text,integer) from public,anon,authenticated;
grant execute on function public.app_unlinked_groups_page_v1(text,integer) to authenticated;

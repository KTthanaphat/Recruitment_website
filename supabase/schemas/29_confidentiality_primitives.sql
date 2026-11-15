-- Non-reporting access and reporting membership are deliberately separate.
create or replace function app_private.secret_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role in ('system_admin','admin_recruiter'))
$$;
create or replace function app_private.secret_requisition_access(p_id text) returns boolean language sql stable security definer set search_path='' as $$
 select case when app_private.secret_admin() then true else exists(select 1 from public.requisitions where doc_id=p_id and not is_secret) end
$$;
create or replace function app_private.secret_group_access(p_id text) returns boolean language sql stable security definer set search_path='' as $$
 select case when app_private.secret_admin() then true else exists(select 1 from public.position_groups where group_id=p_id and not is_secret) end
$$;
create or replace function app_private.secret_application_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when app_private.secret_admin() then true else exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where application_id=p_id and not g.is_secret) end
$$;
create or replace function app_private.secret_candidate_access(p_id text) returns boolean language sql stable security definer set search_path='' as $$
 select case when app_private.secret_admin() then true else
   not exists(select 1 from public.candidate_applications where candidate_id=p_id)
   or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.candidate_id=p_id and not g.is_secret) end
$$;
create or replace function app_private.report_application(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.application_id=p_id and not g.is_secret)
$$;
create or replace function app_private.secret_audit_access(p_entity text,p_id text,p_old jsonb,p_new jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v jsonb:=coalesce(p_new,p_old,'{}'); v_group text; v_doc text; v_app uuid;
begin
 if app_private.secret_admin() then return true; end if;
 if coalesce((p_old->>'is_secret')::boolean,false) or coalesce((p_new->>'is_secret')::boolean,false) then return false; end if;
 if p_entity='requisitions' then return app_private.secret_requisition_access(p_id); end if;
 if p_entity='position_groups' then return app_private.secret_group_access(p_id); end if;
 v_group:=coalesce(v->>'group_id',p_old->>'group_id'); v_doc:=coalesce(v->>'doc_id',p_old->>'doc_id');
 v_app:=coalesce(nullif(v->>'application_id',''),nullif(p_old->>'application_id',''))::uuid;
 if v_group is not null and not app_private.secret_group_access(v_group) then return false; end if;
 if v_doc is not null and not app_private.secret_requisition_access(v_doc) then return false; end if;
 if v_app is not null and not app_private.secret_application_access(v_app) then return false; end if;
 if p_entity='candidates' then return app_private.secret_candidate_access(p_id); end if;
 if v->>'candidate_id' is not null then return app_private.secret_candidate_access(v->>'candidate_id'); end if;
 return true;
end $$;

create or replace view app_private.report_requisitions with (security_invoker=true) as select * from public.requisitions where not is_secret;
create or replace view app_private.report_position_groups with (security_invoker=true) as select * from public.position_groups where not is_secret;
create or replace view app_private.report_document_groups with (security_invoker=true) as select d.* from public.document_groups d join public.requisitions r using(doc_id) left join public.position_groups g using(group_id) where not r.is_secret and g.is_secret is not true;
create or replace view app_private.report_requisition_logs with (security_invoker=true) as select l.* from public.requisition_logs l join public.requisitions r using(doc_id) where not r.is_secret;
create or replace view app_private.report_candidate_applications with (security_invoker=true) as select a.* from public.candidate_applications a join public.position_groups g using(group_id) where not g.is_secret;
create or replace view app_private.report_candidate_application_assignments with (security_invoker=true) as select x.* from public.candidate_application_assignments x join public.position_groups g using(group_id) where not g.is_secret and app_private.report_application(x.application_id);
create or replace view app_private.report_recruitment_logs with (security_invoker=true) as select l.* from public.recruitment_logs l where app_private.report_application(l.application_id);
create or replace view app_private.report_offers with (security_invoker=true) as select o.* from public.offers o join public.requisitions r using(doc_id) where not r.is_secret and app_private.report_application(o.application_id);
create or replace view app_private.report_sourcing_weekly_updates with (security_invoker=true) as select s.* from public.sourcing_weekly_updates s join public.position_groups g using(group_id) where not g.is_secret;
create or replace view app_private.report_candidate_requisitions with (security_invoker=true) as select c.* from public.candidate_requisitions c join public.requisitions r using(doc_id) where not r.is_secret and app_private.report_application(c.application_id);
-- Keep this projection aligned with candidates when adding columns; direct fields allow
-- PostgreSQL to prune unused masking expressions from count/summary queries.
create or replace view app_private.report_candidates with (security_invoker=true) as select c.candidate_id,
 c.name,
 c.nickname,
 c.phone_no,
 c.email,
 case when exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) left join public.position_groups g using(group_id) where d.doc_group_id=c.doc_group_id and not r.is_secret and g.is_secret is not true) then c.doc_group_id end as doc_group_id,
 case when exists(select 1 from public.position_groups g where g.group_id=c.group_id and not g.is_secret) then c.group_id end as group_id,
 c.channel,
 c.ref_name,
 c.first_contact_date,
 c.candidate_folder_url,
 c.created_at,
 c.updated_at,
 c.home_site,
 c.responsible_recruiter_id,
 c.position_interests,
 c.created_by from public.candidates c where not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id) or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.candidate_id=c.candidate_id and not g.is_secret);
create or replace view app_private.report_change_logs with (security_invoker=true) as select l.* from public.change_logs l where not l.is_secret;

revoke all on function app_private.secret_admin(),app_private.secret_requisition_access(text),app_private.secret_group_access(text),app_private.secret_application_access(uuid),app_private.secret_candidate_access(text),app_private.report_application(uuid),app_private.secret_audit_access(text,text,jsonb,jsonb) from public,anon;
grant execute on function app_private.secret_admin(),app_private.secret_requisition_access(text),app_private.secret_group_access(text),app_private.secret_application_access(uuid),app_private.secret_candidate_access(text),app_private.report_application(uuid),app_private.secret_audit_access(text,text,jsonb,jsonb) to authenticated,service_role;
grant select on app_private.report_requisitions,app_private.report_position_groups,app_private.report_document_groups,app_private.report_requisition_logs,app_private.report_candidate_applications,app_private.report_candidate_application_assignments,app_private.report_recruitment_logs,app_private.report_offers,app_private.report_sourcing_weekly_updates,app_private.report_candidate_requisitions,app_private.report_candidates,app_private.report_change_logs to authenticated,service_role;

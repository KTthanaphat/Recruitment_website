create or replace function public.app_dashboard_active_requisitions_page_v1(
  p_start date,p_end date,p_period text,p_stage_mode text,p_scope jsonb default '{}'::jsonb,
  p_after_value text default null,p_after_id text default null,p_limit integer default 25,
  p_search text default '',p_filters jsonb default '{}'::jsonb,p_sort text default null,p_direction text default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_needs_metric_membership boolean; v_sort text:=coalesce(nullif(p_sort,''),'report'); v_direction text:=lower(coalesce(nullif(p_direction,''),'asc'));
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_period not in ('mtd','ytd','pim','custom') then raise exception 'REPORT_RANGE_INVALID'; end if;
  if p_stage_mode not in ('status','activity','accum') then raise exception 'REPORT_STAGE_MODE_INVALID'; end if;
  if p_limit is null or p_limit not in (25,50) then raise exception 'REPORT_PAGE_LIMIT_INVALID'; end if;
  if (p_after_value is null)<>(p_after_id is null) then raise exception 'REPORT_CURSOR_INVALID'; end if;
  if p_search is null or length(p_search)>200 or jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('site','department','section','position','level','vacancy','request_type','requisition_date','person_in_charge','status','detail','applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer','actual_age','sla','filled_date'))
    or exists(select 1 from jsonb_each(coalesce(p_filters,'{}'::jsonb)) f where jsonb_typeof(f.value)<>'string' or length(f.value #>> '{}')>200) then raise exception 'REPORT_FILTER_INVALID'; end if;
  if v_direction not in ('asc','desc') or v_sort not in ('report','site','department','section','position','level','vacancy','request_type','requisition_date','person_in_charge','status','detail','applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer','actual_age','sla','filled_date') then raise exception 'REPORT_SORT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'REPORT_SCOPE_INVALID'; end if;
  v_needs_metric_membership := p_search<>'' or exists(select 1 from jsonb_each_text(coalesce(p_filters,'{}'::jsonb)) f where f.key in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and f.value<>'');
  with base as materialized (
    select r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.status,r.person_in_charge,r.pr_approved_date,r.is_priority
    from app_private.report_requisitions r where app_private.can_read_requisition(r.doc_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), evaluated as materialized (
    select b.*,
      (select l.status from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_status,
      (select l.remark from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_remark,
      (select l.log_date from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.status='filled' and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) logged_filled,
      exists(select 1 from app_private.report_requisition_logs l where l.doc_id=b.doc_id) has_logs,
      coalesce((select count(*) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date<p_end+1 and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'UTC')::date>=p_end+1)),0)::integer covered_end,
      (select max(o.accepted_date) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date<=p_end and
        (select count(*) from app_private.report_offers q where q.doc_id=b.doc_id and q.accepted_date<o.accepted_date+1 and (q.start_confirmation is distinct from 'did_not_start' or q.start_confirmed_at is null or (q.start_confirmed_at at time zone 'UTC')::date>=o.accepted_date+1))>=b.head_count) offer_filled
    from base b
  ), eligible0 as (
    select e.*,case when e.offer_filled is not null or e.last_status='filled' then 'filled' else 'ongoing' end period_status,
      case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end filled_date,
      coalesce(e.pr_approved_date,'9999-12-31'::date) req_date,
      coalesce((select max((o.start_confirmed_at at time zone 'UTC')::date) from app_private.report_offers o where o.doc_id=e.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at is not null),e.pr_approved_date) sla_start,
      case when nullif(substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)'), '') is null then null
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 0 and 6 then 30
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 7 and 9 then 45
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 10 and 14 then 60 else null end sla_days
    from evaluated e
  ), eligible as materialized (
    select e.* from eligible0 e where e.req_date<=p_end and e.last_status is distinct from 'cancel'
      and not (not e.has_logs and e.status='cancel')
      and (case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end is null
        or case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end>=p_start)
      and (p_period in ('pim','custom') or (case when nullif(substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)'), '') is not null and substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 0 and 14 then case when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=6 then 30 when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=9 then 45 else 60 end end is not null and e.pr_approved_date+(case when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=6 then 30 when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=9 then 45 else 60 end)>=p_start))
  ), cheap_rows as (
    select e.*,
      case v_sort when 'site' then lower(e.site) when 'department' then lower(e.department) when 'section' then lower(coalesce(e.section,'')) when 'position' then lower(e.position)
        when 'level' then lower(coalesce(e.level,'')) when 'vacancy' then lpad(e.head_count::text,12,'0') when 'request_type' then lower(coalesce(e.request_type,''))
        when 'requisition_date' then e.req_date::text when 'person_in_charge' then lower(coalesce(e.person_in_charge,''))
        when 'status' then case e.period_status when 'ongoing' then '0-ongoing' else '1-filled' end when 'detail' then lower(coalesce(e.last_remark,''))
        when 'actual_age' then lpad(greatest((timezone('Asia/Bangkok',now())::date-e.req_date),0)::text,12,'0')
        when 'sla' then lpad(greatest((coalesce(case when e.period_status='filled' then e.filled_date end,p_end)-e.sla_start),0)::text,12,'0')
        when 'filled_date' then coalesce(e.filled_date::text,'9999-12-31')
        else concat(e.site,chr(31),case when e.period_status='ongoing' then '0' else '1' end,chr(31),coalesce(e.filled_date::text,'9999-12-31'),chr(31),e.req_date::text) end sort_value
    from eligible e
  ), base_matches as materialized (
    select r.* from cheap_rows r where true
      and (coalesce((p_filters->>'site'),'')='' or r.site ilike '%'||(p_filters->>'site')||'%')
      and (coalesce((p_filters->>'department'),'')='' or r.department ilike '%'||(p_filters->>'department')||'%')
      and (coalesce((p_filters->>'section'),'')='' or coalesce(r.section,'-') ilike '%'||(p_filters->>'section')||'%')
      and (coalesce((p_filters->>'position'),'')='' or r.position ilike '%'||(p_filters->>'position')||'%')
      and (coalesce((p_filters->>'level'),'')='' or coalesce(r.level,'-') ilike '%'||(p_filters->>'level')||'%')
      and (coalesce((p_filters->>'vacancy'),'')='' or r.head_count::text ilike '%'||(p_filters->>'vacancy')||'%')
      and (coalesce((p_filters->>'request_type'),'')='' or case lower(btrim((p_filters->>'request_type'))) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike '%'||(p_filters->>'request_type')||'%' end)
      and (coalesce((p_filters->>'requisition_date'),'')='' or concat_ws(' ',r.req_date::text,to_char(r.req_date,'DD/MM/YYYY')) ilike '%'||(p_filters->>'requisition_date')||'%')
      and (coalesce((p_filters->>'person_in_charge'),'')='' or coalesce(r.person_in_charge,'-') ilike '%'||(p_filters->>'person_in_charge')||'%')
      and (coalesce((p_filters->>'status'),'')='' or case lower(btrim((p_filters->>'status'))) when 'ongoing' then r.period_status='ongoing' when 'กำลังดำเนินการ' then r.period_status='ongoing' when 'filled' then r.period_status='filled' when 'ครบแล้ว' then r.period_status='filled' else concat_ws(' ',r.period_status,r.site,r.department) ilike '%'||(p_filters->>'status')||'%' end)
      and (coalesce((p_filters->>'detail'),'')='' or coalesce(r.last_remark,'-') ilike '%'||(p_filters->>'detail')||'%')
      and (coalesce((p_filters->>'actual_age'),'')='' or greatest((timezone('Asia/Bangkok',now())::date-r.req_date),0)::text ilike '%'||replace((p_filters->>'actual_age'),'d','')||'%')
      and (coalesce((p_filters->>'sla'),'')='' or (case when r.sla_start is null or r.sla_days is null then '-' else (case when greatest((coalesce(case when r.period_status='filled' then r.filled_date end,p_end)-r.sla_start),0)<=r.sla_days then 'In SLA อยู่ใน SLA' else 'Over SLA เกิน SLA' end)||' ('||greatest((coalesce(case when r.period_status='filled' then r.filled_date end,p_end)-r.sla_start),0)||'d)' end) ilike '%'||(p_filters->>'sla')||'%')
      and (coalesce((p_filters->>'filled_date'),'')='' or concat_ws(' ',coalesce(r.filled_date::text,'-'),coalesce(to_char(r.filled_date,'DD/MM/YYYY'),'-'),coalesce(to_char(r.filled_date,'Mon DD, YYYY'),'-')) ilike '%'||(p_filters->>'filled_date')||'%')
  ), enrichment_keys as materialized (
    select doc_id from base_matches where v_needs_metric_membership or v_sort in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
    union all
    select doc_id from (
      select doc_id from base_matches r where not v_needs_metric_membership and v_sort not in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and (case when v_sort='report' or v_direction='asc' then p_after_value is null or r.sort_value>p_after_value or (r.sort_value=p_after_value and r.doc_id>p_after_id)
        else p_after_value is null or r.sort_value<p_after_value or (r.sort_value=p_after_value and r.doc_id>p_after_id) end)
      order by case when v_direction='asc' then sort_value end asc,case when v_direction='desc' then sort_value end desc,doc_id asc limit p_limit+1
    ) page_keys
  ), stage_apps as materialized (
    select distinct k.doc_id,d.group_id,ca.application_id,ca.candidate_id
    from enrichment_keys k join app_private.report_document_groups d using(doc_id)
    join lateral (select a.application_id,a.candidate_id from app_private.report_candidate_applications a where a.group_id=d.group_id offset 0) ca on true
  ), allowed_stage_applications as materialized (
    select application_id from (select distinct application_id from stage_apps) a
    where app_private.can_read_application(a.application_id)
  ), allowed_stage_candidates as materialized (
    select c.candidate_id from (select distinct candidate_id from stage_apps join allowed_stage_applications using(application_id)) k
    join app_private.report_candidates c using(candidate_id) where app_private.can_read_candidate(c.candidate_id)
  ), stage_counts as (
    select e.doc_id,l.recruitment_process,count(distinct case when p_stage_mode='status' then ca.application_id::text else l.candidate_id end)::integer n
    from stage_apps ca join allowed_stage_applications aa using(application_id) join base_matches e using(doc_id)
    join allowed_stage_candidates c on c.candidate_id=ca.candidate_id
    join lateral (
      select l.* from app_private.report_recruitment_logs l
      where l.application_id=ca.application_id and l.candidate_id=c.candidate_id offset 0
    ) l on true
    left join app_private.report_candidate_application_assignments a on a.assignment_id=case when l.result is null then l.entry_assignment_id else l.outcome_assignment_id end and a.application_id=ca.application_id
    where l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (p_stage_mode='status' or a.group_id=ca.group_id or a.assignment_id is null)
      and case p_stage_mode when 'activity' then (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between p_start and p_end
        when 'accum' then l.superseded_at is null and l.log_date between coalesce(e.pr_approved_date,p_end) and p_end
        else l.log_date<=p_end and (l.outcome_date is null or l.outcome_date>p_end or l.result is null)
          and not exists(select 1 from app_private.report_recruitment_logs newer where newer.application_id=ca.application_id and newer.candidate_id=c.candidate_id
            and newer.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
            and newer.log_date<=p_end and (newer.outcome_date is null or newer.outcome_date>p_end or newer.result is null)
            and (newer.log_date>l.log_date or (newer.log_date=l.log_date and newer.log_id>l.log_id))) end
    group by e.doc_id,l.recruitment_process
  ), stage_pivot as materialized (
    select doc_id,
      coalesce(max(n) filter(where recruitment_process='Phone Screen'),0)::integer phone_screen,
      coalesce(max(n) filter(where recruitment_process='HR Interview'),0)::integer hr_interview,
      coalesce(max(n) filter(where recruitment_process='Line Interview'),0)::integer line_interview,
      coalesce(max(n) filter(where recruitment_process='Test'),0)::integer test_count,
      coalesce(max(n) filter(where recruitment_process='Reference Check'),0)::integer reference_check,
      coalesce(max(n) filter(where recruitment_process='Offer'),0)::integer offer_count
    from stage_counts group by doc_id
  ), rows as (
    select e.*, coalesce(metric_sort.value,e.sort_value) as report_sort_value,
      coalesce(st.phone_screen,0)::integer phone_screen,coalesce(st.hr_interview,0)::integer hr_interview,coalesce(st.line_interview,0)::integer line_interview,
      coalesce(st.test_count,0)::integer test_count,coalesce(st.reference_check,0)::integer reference_check,coalesce(st.offer_count,0)::integer offer_count,
      coalesce(src.applicants,0)::integer applicant_count,coalesce(src.channel_fb,0)::integer channel_fb,coalesce(src.channel_jobthai,0)::integer channel_jobthai,
      coalesce(src.channel_jobtopgun,0)::integer channel_jobtopgun,coalesce(src.channel_jobdb,0)::integer channel_jobdb,coalesce(src.channel_jobbkk,0)::integer channel_jobbkk,
      coalesce(src.channel_linkedin,0)::integer channel_linkedin,coalesce(src.channel_walkin,0)::integer channel_walkin,coalesce(src.channel_referral,0)::integer channel_referral,coalesce(src.channel_others,0)::integer channel_others
    from enrichment_keys k join base_matches e using(doc_id) left join stage_pivot st using(doc_id) left join lateral (
      select sum(coalesce(u.applicants_fb,0)+coalesce(u.applicants_jobthai,0)+coalesce(u.applicants_jobtopgun,0)+coalesce(u.applicants_jobdb,0)+coalesce(u.applicants_jobbkk,0)+coalesce(u.applicants_linkedin,0)+coalesce(u.applicants_walkin,0)+coalesce(u.applicants_referral,0)+coalesce(u.applicants_others,0))::integer applicants,
        sum(coalesce(u.applicants_fb,0))::integer channel_fb,sum(coalesce(u.applicants_jobthai,0))::integer channel_jobthai,sum(coalesce(u.applicants_jobtopgun,0))::integer channel_jobtopgun,sum(coalesce(u.applicants_jobdb,0))::integer channel_jobdb,
        sum(coalesce(u.applicants_jobbkk,0))::integer channel_jobbkk,sum(coalesce(u.applicants_linkedin,0))::integer channel_linkedin,sum(coalesce(u.applicants_walkin,0))::integer channel_walkin,sum(coalesce(u.applicants_referral,0))::integer channel_referral,sum(coalesce(u.applicants_others,0))::integer channel_others
      from app_private.report_document_groups d join app_private.report_sourcing_weekly_updates u on u.group_id=d.group_id
      where d.doc_id=e.doc_id and u.week_start between p_start and p_end and app_private.can_read_sourcing_group(u.group_id)
    ) src on true
    cross join lateral (select case v_sort
      when 'applicants' then lpad(coalesce(src.applicants,0)::text,12,'0')
      when 'Phone Screen' then lpad(coalesce(st.phone_screen,0)::text,12,'0')
      when 'HR Interview' then lpad(coalesce(st.hr_interview,0)::text,12,'0')
      when 'Line Interview' then lpad(coalesce(st.line_interview,0)::text,12,'0')
      when 'Test' then lpad(coalesce(st.test_count,0)::text,12,'0')
      when 'Reference Check' then lpad(coalesce(st.reference_check,0)::text,12,'0')
      when 'Offer' then lpad(coalesce(st.offer_count,0)::text,12,'0') end value) metric_sort
  ), matched as materialized (
    select r.* from rows r where true
      and (coalesce(p_search,'')='' or concat_ws(' ',r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.req_date,r.person_in_charge,r.period_status,r.last_remark,r.applicant_count,r.phone_screen,r.hr_interview,r.line_interview,r.test_count,r.reference_check,r.offer_count,r.filled_date) ilike '%'||btrim(p_search)||'%')
      and (coalesce((p_filters->>'applicants'),'')='' or r.applicant_count::text ilike '%'||(p_filters->>'applicants')||'%')
      and (coalesce((p_filters->>'Phone Screen'),'')='' or r.phone_screen::text ilike '%'||(p_filters->>'Phone Screen')||'%')
      and (coalesce((p_filters->>'HR Interview'),'')='' or r.hr_interview::text ilike '%'||(p_filters->>'HR Interview')||'%')
      and (coalesce((p_filters->>'Line Interview'),'')='' or r.line_interview::text ilike '%'||(p_filters->>'Line Interview')||'%')
      and (coalesce((p_filters->>'Test'),'')='' or r.test_count::text ilike '%'||(p_filters->>'Test')||'%')
      and (coalesce((p_filters->>'Reference Check'),'')='' or r.reference_check::text ilike '%'||(p_filters->>'Reference Check')||'%')
      and (coalesce((p_filters->>'Offer'),'')='' or r.offer_count::text ilike '%'||(p_filters->>'Offer')||'%')
  ), page_raw as (
    select * from matched r where (case when v_sort='report' or v_direction='asc' then p_after_value is null or r.report_sort_value>p_after_value or (r.report_sort_value=p_after_value and r.doc_id>p_after_id)
        else p_after_value is null or r.report_sort_value<p_after_value or (r.report_sort_value=p_after_value and r.doc_id>p_after_id) end)
    order by case when v_direction='asc' then report_sort_value end asc,case when v_direction='desc' then report_sort_value end desc,doc_id asc limit p_limit+1
  ), page_rows as (
    select * from page_raw order by case when v_direction='asc' then report_sort_value end asc,case when v_direction='desc' then report_sort_value end desc,doc_id asc limit p_limit
  ), counted as (
    select case when v_needs_metric_membership then (select count(*) from matched) else (select count(*) from base_matches) end::integer total
  ),
  page_info as (select count(*)>p_limit more from page_raw)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('doc_id',p.doc_id,'site',p.site,'department',p.department,'section',p.section,'position',p.position,'level',coalesce(p.level,'-'),'vacancy',p.head_count,
      'applicant_count',p.applicant_count,'applicant_channels',jsonb_build_object('applicants_fb',p.channel_fb,'applicants_jobthai',p.channel_jobthai,'applicants_jobtopgun',p.channel_jobtopgun,'applicants_jobdb',p.channel_jobdb,'applicants_jobbkk',p.channel_jobbkk,'applicants_linkedin',p.channel_linkedin,'applicants_walkin',p.channel_walkin,'applicants_referral',p.channel_referral,'applicants_others',p.channel_others),
      'request_type',p.request_type,'requisition_date',p.req_date,'actual_age_days',greatest((timezone('Asia/Bangkok',now())::date-p.req_date),0),'person_in_charge',coalesce(p.person_in_charge,'-'),
      'stage_counts',jsonb_build_object('Phone Screen',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Phone Screen'),0),'HR Interview',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='HR Interview'),0),'Line Interview',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Line Interview'),0),'Test',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Test'),0),'Reference Check',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Reference Check'),0),'Offer',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Offer'),0)),
      'sla_state',jsonb_build_object('ageDays',case when p.sla_start is null then null else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0) end,
        'endDate',coalesce(case when p.period_status='filled' then p.filled_date end,p_end),'inSla',case when p.sla_start is null or p.sla_days is null then null else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)<=p.sla_days end,
        'isOverdue',case when p.sla_start is null or p.sla_days is null then false else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)>p.sla_days end,
        'label',case when p.sla_start is null or p.sla_days is null then '-' else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)||'d / '||p.sla_days||'d' end,
        'slaDays',p.sla_days,'startDate',p.sla_start),
      'filled_date',p.filled_date,'period_status',p.period_status,'period_detail',p.last_remark) order by case when v_direction='asc' then p.report_sort_value end asc,case when v_direction='desc' then p.report_sort_value end desc,p.doc_id asc) from page_rows p),'[]'::jsonb),
    'total',(select total from counted),'hasMore',(select more from page_info),
    'nextCursor',case when (select more from page_info) then (select jsonb_build_object('value',report_sort_value,'id',doc_id) from page_rows order by case when v_direction='asc' then report_sort_value end desc,case when v_direction='desc' then report_sort_value end asc,doc_id desc limit 1) else null end)
  into v_result;
  return v_result;
end $$;
revoke all on function public.app_dashboard_active_requisitions_page_v1(date,date,text,text,jsonb,text,text,integer,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.app_dashboard_active_requisitions_page_v1(date,date,text,text,jsonb,text,text,integer,text,jsonb,text,text) to authenticated;
-- Read-only reconciliation. No candidate/contact data is returned.
-- Repeat on mppnlkldlctvketcsald; all counts use one statement snapshot.
with scenarios(id,mode,start_date,end_date,header_site,department_filter,level_min,level_max,pic_filter,priority_only,channel) as (
 values
 ('aug-pim','pim',date '2026-08-01',date '2026-08-31',null::text,null::text,null::int,null::int,null::text,false,'all'),
 ('aug-mtd','mtd',date '2026-08-01',date '2026-08-31',null,null,null,null,null,false,'all'),
 ('aug-ytd','ytd',date '2026-01-01',date '2026-08-31',null,null,null,null,null,false,'all'),
 ('jul-pim','pim',date '2026-07-01',date '2026-07-31',null,null,null,null,null,false,'all'),
 ('sep-pim','pim',date '2026-09-01',date '2026-09-30',null,null,null,null,null,false,'all'),
 ('oct-mtd','mtd',date '2026-10-01',date '2026-10-04',null,null,null,null,null,false,'all'),
 ('aug-hq','pim',date '2026-08-01',date '2026-08-31','HQ',null,null,null,null,false,'all'),
 ('aug-department','pim',date '2026-08-01',date '2026-08-31','HQ','Personnel Administration Department',null,null,null,false,'all'),
 ('aug-level','pim',date '2026-08-01',date '2026-08-31',null,null,4,6,null,false,'all'),
 ('aug-pic','pim',date '2026-08-01',date '2026-08-31',null,null,null,null,'Vena',false,'all'),
 ('aug-priority','pim',date '2026-08-01',date '2026-08-31',null,null,null,null,null,true,'all'),
 ('aug-facebook','pim',date '2026-08-01',date '2026-08-31',null,null,null,null,null,false,'Facebook')
), r as (
 select s.*,q.*,case when q.level ~* '^L?([0-9]|1[0-4])$' then regexp_replace(q.level,'^[Ll]','')::int end as numeric_level
 from scenarios s cross join requisitions q
 where (s.header_site is null or q.site=s.header_site) and (s.department_filter is null or q.department=s.department_filter)
 and (s.pic_filter is null or q.person_in_charge=s.pic_filter) and (not s.priority_only or q.is_priority)
), snapshot as (
 select r.*,case when numeric_level<=6 then 30 when numeric_level<=9 then 45 when numeric_level<=14 then 60 end as sla_days,
 (select l.status from requisition_logs l where l.doc_id=r.doc_id and l.log_date<=r.end_date order by l.log_date desc,l.log_id desc limit 1) as last_status,
 (select count(*) from requisition_logs l where l.doc_id=r.doc_id) as log_count,
 (select count(*) from offers o where o.doc_id=r.doc_id and o.accepted_date<r.start_date and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at::date>=r.start_date)) as covered_before,
 (select count(*) from offers o where o.doc_id=r.doc_id and o.accepted_date<=r.end_date and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at::date>r.end_date)) as covered_end,
 (select max(o.accepted_date) from offers o where o.doc_id=r.doc_id and o.accepted_date<=r.end_date) as last_accepted,
 (select max(l.log_date) from requisition_logs l where l.doc_id=r.doc_id and l.log_date<=r.end_date and l.status='filled') as last_filled_log,
 exists(select 1 from offers o where o.doc_id=r.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at::date between r.start_date and r.end_date) as reopened,
 exists(select 1 from requisition_logs l where l.doc_id=r.doc_id and l.status='filled' and l.log_date<r.start_date) as filled_before,
 (select count(*) from offers o where o.doc_id=r.doc_id) as offer_count
 from r where level_min is null or numeric_level between level_min and level_max
), eligible as (
 select *,
 (pr_approved_date<=end_date and coalesce(last_status,case when created_at::date>end_date then 'ongoing' else status end)<>'cancel'
 and not ((covered_before>=head_count or (offer_count=0 and filled_before)) and not reopened)
 and (mode in ('pim','custom') or pr_approved_date+sla_days>=start_date)) as performance_eligible,
 (pr_approved_date<=end_date and not (coalesce(last_status='cancel',false) or (log_count=0 and status='cancel'))
 and coalesce(case when covered_end>=head_count then last_accepted when last_status='filled' then last_filled_log end,end_date)>=start_date
 and (mode in ('pim','custom') or pr_approved_date+sla_days>=start_date)) as report_eligible
 from snapshot
), accepted as (
 select e.id,e.doc_id,e.site,e.numeric_level,e.request_type,e.head_count,e.pr_approved_date,e.sla_days,o.offer_id,o.accepted_date,
 row_number() over(partition by e.id,e.doc_id order by o.accepted_date,o.offer_id) as slot,
 coalesce((select max(x.start_confirmed_at::date) from offers x where x.doc_id=e.doc_id and x.start_confirmation='did_not_start' and x.start_confirmed_at::date<=o.accepted_date),e.pr_approved_date) as sla_start
 from eligible e join offers o using(doc_id)
 where e.performance_eligible and o.accepted_date between e.start_date and e.end_date
 and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at::date>e.end_date)
), perf as (
 select s.id,
 coalesce((select sum(head_count) from eligible e where e.id=s.id and performance_eligible),0) as vacancies,
 (select count(*) from accepted a where a.id=s.id and slot<=head_count) as filled,
 (select count(*) from accepted a where a.id=s.id and slot<=head_count and accepted_date>=sla_start and accepted_date-sla_start<=sla_days) as on_time,
 (select count(*) from accepted a where a.id=s.id and slot<=head_count and accepted_date-sla_start>sla_days) as late,
 (select avg(accepted_date-pr_approved_date) from accepted a where a.id=s.id and slot<=head_count and accepted_date>=pr_approved_date) as avg_ttf,
 (select jsonb_agg(t order by site,band) from (
   select e.site,case when e.numeric_level<=3 then 'NML' when e.numeric_level<=6 then 'FML' when e.numeric_level<=9 then 'MML' when e.numeric_level<=12 then 'SML' when e.numeric_level<=14 then 'Executive' else 'Unknown' end as band,
   sum(e.head_count) as vacancies,sum(case when e.request_type='Replacement' then 0 else e.head_count end) as new,sum(case when e.request_type='Replacement' then e.head_count else 0 end) as replacement,
   sum((select count(*) from accepted a where a.id=e.id and a.doc_id=e.doc_id and slot<=head_count)) as filled
   from eligible e where e.id=s.id and performance_eligible group by 1,2
 )t) as cells
 from scenarios s
), movement as (
 select s.id,
 (select count(*) from eligible e where e.id=s.id and report_eligible) as requisitions,
 coalesce((select sum(greatest(head_count-covered_before,0)) from eligible e where e.id=s.id and report_eligible and pr_approved_date<start_date),0) as opening,
 coalesce((select sum(head_count) from eligible e where e.id=s.id and report_eligible and pr_approved_date between start_date and end_date),0) as new_open,
 (select count(*) from eligible e join offers o using(doc_id) where e.id=s.id and report_eligible and o.start_confirmation='did_not_start' and o.start_confirmed_at::date between start_date and end_date) as reopened,
 (select count(*) from eligible e join offers o using(doc_id) where e.id=s.id and report_eligible and o.accepted_date between start_date and end_date and o.start_confirmation is distinct from 'did_not_start') as effective_fills,
 (select count(*) from eligible e join offers o using(doc_id) where e.id=s.id and report_eligible and o.accepted_date between start_date and end_date) as acceptance_movements,
 coalesce((select sum(greatest(head_count-covered_end,0)) from eligible e where e.id=s.id and report_eligible),0) as actual_closing
 from scenarios s
), groups as (
 select distinct e.id,d.group_id from eligible e join document_groups d using(doc_id) where report_eligible and d.group_id is not null
), candidate_scope as (
 select distinct g.id,c.candidate_id,trim(c.channel) as channel from groups g join candidates c on c.group_id=g.group_id or (c.group_id is null and exists(select 1 from document_groups d where d.doc_group_id=c.doc_group_id and d.group_id=g.group_id))
), stage as (
 select c.id,l.recruitment_process,count(distinct l.candidate_id) filter(where l.result=1) as passed,
 count(distinct l.candidate_id) filter(where l.recruitment_process='Phone Screen') as reached
 from candidate_scope c join scenarios s using(id) join recruitment_logs l using(candidate_id)
 where l.superseded_at is null and l.superseded_by_stage_instance_id is null
 and (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between s.start_date and s.end_date
 and (s.channel='all' or c.channel=s.channel) group by c.id,l.recruitment_process
), channels(label,field) as (
 values ('Facebook','applicants_fb'),('JobThai','applicants_jobthai'),('JobTopGun','applicants_jobtopgun'),('JobsDB','applicants_jobdb'),('JobBKK','applicants_jobbkk'),('LinkedIn','applicants_linkedin'),('Walk-in','applicants_walkin'),('Referral','applicants_referral'),('Others','applicants_others'),('Unknown',null)
), source as (
 select s.id,h.label,
 coalesce((select sum((to_jsonb(w)->>h.field)::int) from groups g join sourcing_weekly_updates w using(group_id) where g.id=s.id and w.week_start between s.start_date and s.end_date),0) as applicants,
 (select count(distinct c.candidate_id) from candidate_scope c join recruitment_logs l using(candidate_id) where c.id=s.id and l.recruitment_process='Phone Screen' and l.result=1 and coalesce(l.outcome_date,l.log_date) between s.start_date and s.end_date and l.superseded_at is null and l.superseded_by_stage_instance_id is null and (c.channel=h.label or (h.label='Unknown' and not exists(select 1 from channels z where z.label=c.channel and z.field is not null)))) as phone,
 (select count(distinct o.candidate_id) from eligible e join offers o using(doc_id) join candidates c using(candidate_id) where e.id=s.id and report_eligible and o.accepted_date between s.start_date and s.end_date and (trim(c.channel)=h.label or (h.label='Unknown' and not exists(select 1 from channels z where z.label=trim(c.channel) and z.field is not null)))) as hired
 from scenarios s cross join channels h where s.channel='all' or s.channel=h.label
)
select jsonb_agg(jsonb_build_object('scenario',s.id,'period',s.mode,'start',s.start_date,'end',s.end_date,
 'performance',to_jsonb(p)-'id','waterfall',to_jsonb(m)-'id',
 'pipeline',coalesce((select jsonb_object_agg(recruitment_process,passed) from stage where id=s.id),'{}'::jsonb),
 'resume_screening',coalesce((select reached from stage where id=s.id and recruitment_process='Phone Screen'),0),
 'source',coalesce((select jsonb_agg(to_jsonb(x)-'id' order by label) from source x where x.id=s.id and (applicants>0 or phone>0 or hired>0)),'[]'::jsonb))
 order by s.id) as reconciliation from scenarios s join perf p using(id) join movement m using(id);

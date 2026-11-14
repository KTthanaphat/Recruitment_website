create or replace view app_private.report_candidates with (security_invoker=true) as
 select (jsonb_populate_record(null::public.candidates,to_jsonb(c)||jsonb_build_object('group_id',case when exists(select 1 from public.position_groups g where g.group_id=c.group_id and not g.is_secret) then c.group_id end,'doc_group_id',case when exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) left join public.position_groups g using(group_id) where d.doc_group_id=c.doc_group_id and not r.is_secret and g.is_secret is not true) then c.doc_group_id end))).*
 from public.candidates c where not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id) or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.candidate_id=c.candidate_id and not g.is_secret);

create or replace function app_private.dashboard_sourcing_stage_channels_v1(p_group_id text,p_selected_week date,p_today date) returns jsonb
language sql stable security invoker set search_path='' as $$
with cutoff as (select least(p_selected_week+6,p_today) cutoff_day), candidates as (
  select c.candidate_id,c.channel from app_private.report_candidates c cross join cutoff t
  where app_private.can_read_candidate(c.candidate_id)
    and coalesce((to_jsonb(c)->>'first_contact_date')::date,left(to_jsonb(c)->>'created_at',10)::date)<=t.cutoff_day
    and exists(select 1 from app_private.report_recruitment_logs l join app_private.report_candidate_application_assignments a on a.assignment_id=l.entry_assignment_id where l.candidate_id=c.candidate_id and a.group_id=p_group_id)
), logs as (
  select c.candidate_id,c.channel,l.log_id,l.stage_instance_id,l.recruitment_process,l.round,l.result,l.log_date,l.superseded_at,l.superseded_by_stage_instance_id
  from candidates c join app_private.report_recruitment_logs l on l.candidate_id=c.candidate_id cross join cutoff t
  where l.log_date<=t.cutoff_day and l.superseded_at is null and l.superseded_by_stage_instance_id is null
    and exists(select 1 from app_private.report_candidate_application_assignments a where a.assignment_id=l.entry_assignment_id and a.group_id=p_group_id)
    and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
), canonical as (
  select candidate_id,recruitment_process stage,channel from logs where stage_instance_id is not null
  and exists(select 1 from logs x where x.candidate_id=logs.candidate_id and x.stage_instance_id is not null)
), legacy as (
  select distinct on(candidate_id,recruitment_process,round) candidate_id,recruitment_process stage,channel
  from logs where stage_instance_id is null order by candidate_id,recruitment_process,round,case when result is null then 0 else 1 end,case when result is null then log_id end asc,case when result is not null then log_id end desc
), reached as (select * from canonical union all select l.* from legacy l where not exists(select 1 from canonical c where c.candidate_id=l.candidate_id)),
stages as (select unnest(array['Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer']) stage,unnest(array[1,2,3,4,5,6]) rank),
keys as (select unnest(array['channel_fb','channel_jobthai','channel_jobtopgun','channel_jobdb','channel_jobbkk','channel_linkedin','channel_walkin','channel_referral','channel_others','unknown']) key),
counts as (select s.stage,s.rank,k.key,count(distinct r.candidate_id)::integer count from stages s cross join keys k left join reached r on r.stage=s.stage and k.key=case lower(btrim(coalesce(r.channel,''))) when 'facebook' then 'channel_fb' when 'jobthai' then 'channel_jobthai' when 'jobtopgun' then 'channel_jobtopgun' when 'jobsdb' then 'channel_jobdb' when 'jobbkk' then 'channel_jobbkk' when 'linkedin' then 'channel_linkedin' when 'walk-in' then 'channel_walkin' when 'referral' then 'channel_referral' when 'others' then 'channel_others' else 'unknown' end group by s.stage,s.rank,k.key),
stage_json as (select stage,rank,sum(count)::integer total,coalesce(jsonb_agg(jsonb_build_object('key',key,'count',count) order by case key when 'channel_fb' then 1 when 'channel_jobthai' then 2 when 'channel_jobtopgun' then 3 when 'channel_jobdb' then 4 when 'channel_jobbkk' then 5 when 'channel_linkedin' then 6 when 'channel_walkin' then 7 when 'channel_referral' then 8 when 'channel_others' then 9 else 10 end) filter(where count>0),'[]'::jsonb) segments from counts group by stage,rank)
select jsonb_build_object('cutoff',least(p_selected_week+6,p_today),'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'total',total,'segments',segments) order by rank) from stage_json),'[]'::jsonb),
 'legend',coalesce((select jsonb_agg(key order by ord) from (select k.key,case k.key when 'channel_fb' then 1 when 'channel_jobthai' then 2 when 'channel_jobtopgun' then 3 when 'channel_jobdb' then 4 when 'channel_jobbkk' then 5 when 'channel_linkedin' then 6 when 'channel_walkin' then 7 when 'channel_referral' then 8 when 'channel_others' then 9 else 10 end ord from keys k where exists(select 1 from counts c where c.key=k.key and c.count>0)) x),'[]'::jsonb))
$$;

create or replace function public.app_recruitment_sourcing_summary_v1(p_selected_week date,p_group_id text default null,p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;v_today date:=(timezone('Asia/Bangkok',now())::date);
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_selected_week is null or jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'SOURCING_SUMMARY_SCOPE_INVALID'; end if;
  with group_bounds as materialized (
    select d.group_id,min(r.pr_approved_date) first_approved,bool_and(r.status in ('filled','cancel')) all_terminal,
      max(case when r.status in ('filled','cancel') then coalesce((select max(l.log_date) from app_private.report_requisition_logs l where l.doc_id=r.doc_id and l.status in ('filled','cancel')),r.updated_at::date) end) terminal_day,
      bool_or(pg.channel_fb) channel_fb,bool_or(pg.channel_jobthai) channel_jobthai,bool_or(pg.channel_jobtopgun) channel_jobtopgun,bool_or(pg.channel_jobdb) channel_jobdb,
      bool_or(pg.channel_jobbkk) channel_jobbkk,bool_or(pg.channel_linkedin) channel_linkedin,bool_or(pg.channel_walkin) channel_walkin,bool_or(pg.channel_referral) channel_referral,bool_or(pg.channel_others) channel_others
    from app_private.report_document_groups d join app_private.report_requisitions r on r.doc_id=d.doc_id join app_private.report_position_groups pg on pg.group_id=d.group_id
    where app_private.can_read_requisition(r.doc_id) and app_private.can_read_sourcing_group(d.group_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
    group by d.group_id
  ), bounds as (
    select b.*,coalesce(first_approved,v_today)-((extract(dow from coalesce(first_approved,v_today))::integer+1)%7) start_week,
      case when all_terminal then coalesce(terminal_day,v_today)-((extract(dow from coalesce(terminal_day,v_today))::integer+1)%7) else v_today-((extract(dow from v_today)::integer+1)%7) end end_week
    from group_bounds b where p_group_id is null or b.group_id=p_group_id
  ), slots as (
    select b.group_id,g.group_position,gs.week_start::date week_start,b.channel_fb,b.channel_jobthai,b.channel_jobtopgun,b.channel_jobdb,b.channel_jobbkk,b.channel_linkedin,b.channel_walkin,b.channel_referral,b.channel_others,
      u.week_start update_week,u.updated_at update_at,u.channel_fb u_fb,u.channel_jobthai u_jobthai,u.channel_jobtopgun u_jobtopgun,u.channel_jobdb u_jobdb,u.channel_jobbkk u_jobbkk,u.channel_linkedin u_linkedin,u.channel_walkin u_walkin,u.channel_referral u_referral,u.channel_others u_others,
      u.applicants_fb,u.applicants_jobthai,u.applicants_jobtopgun,u.applicants_jobdb,u.applicants_jobbkk,u.applicants_linkedin,u.applicants_walkin,u.applicants_referral,u.applicants_others
    from bounds b join app_private.report_position_groups g using(group_id) cross join lateral generate_series(b.start_week,b.end_week,interval '7 days') gs(week_start)
    left join lateral(select x.* from app_private.report_sourcing_weekly_updates x where x.group_id=b.group_id and x.week_start in (gs.week_start::date,gs.week_start::date+2) and app_private.can_read_sourcing_group(x.group_id) order by case when x.week_start=gs.week_start::date then 0 else 1 end,x.updated_at desc limit 1) u on true
    where gs.week_start::date<=p_selected_week
  ), normalized as (
    select s.*,coalesce(u_fb,channel_fb,false) efb,coalesce(u_jobthai,channel_jobthai,false) ejobthai,coalesce(u_jobtopgun,channel_jobtopgun,false) ejobtopgun,
      coalesce(u_jobdb,channel_jobdb,false) ejobdb,coalesce(u_jobbkk,channel_jobbkk,false) ejobbkk,coalesce(u_linkedin,channel_linkedin,false) elinkedin,
      coalesce(u_walkin,channel_walkin,false) ewalkin,coalesce(u_referral,channel_referral,false) ereferral,coalesce(u_others,channel_others,false) eothers
    from slots s
  ), calculated as (
    select n.*,case when update_week is null then null when (efb or ejobthai or ejobtopgun or ejobdb or ejobbkk or elinkedin or ewalkin or ereferral or eothers)
      and ((efb and applicants_fb is null) or (ejobthai and applicants_jobthai is null) or (ejobtopgun and applicants_jobtopgun is null) or (ejobdb and applicants_jobdb is null) or (ejobbkk and applicants_jobbkk is null) or (elinkedin and applicants_linkedin is null) or (ewalkin and applicants_walkin is null) or (ereferral and applicants_referral is null) or (eothers and applicants_others is null)) then null
      when not (efb or ejobthai or ejobtopgun or ejobdb or ejobbkk or elinkedin or ewalkin or ereferral or eothers) then null
      else (case when efb then applicants_fb else 0 end)+(case when ejobthai then applicants_jobthai else 0 end)+(case when ejobtopgun then applicants_jobtopgun else 0 end)+(case when ejobdb then applicants_jobdb else 0 end)+(case when ejobbkk then applicants_jobbkk else 0 end)+(case when elinkedin then applicants_linkedin else 0 end)+(case when ewalkin then applicants_walkin else 0 end)+(case when ereferral then applicants_referral else 0 end)+(case when eothers then applicants_others else 0 end) end::integer applicants,
      (update_week is not null and (efb or ejobthai or ejobtopgun or ejobdb or ejobbkk or elinkedin or ewalkin or ereferral or eothers)
        and not ((efb and applicants_fb is null) or (ejobthai and applicants_jobthai is null) or (ejobtopgun and applicants_jobtopgun is null) or (ejobdb and applicants_jobdb is null) or (ejobbkk and applicants_jobbkk is null) or (elinkedin and applicants_linkedin is null) or (ewalkin and applicants_walkin is null) or (ereferral and applicants_referral is null) or (eothers and applicants_others is null))) saved
    from normalized n
  ), totals as (
    select count(*)::integer expected_rows,count(*) filter(where update_week is not null)::integer updated_weeks,
      coalesce(sum(applicants) filter(where saved),0)::integer total_applicants,
      count(*) filter(where group_id=p_group_id and week_start=p_selected_week and saved)::integer selected_saved,
      count(*) filter(where saved)::integer saved_rows,
      sum(applicants) filter(where group_id=p_group_id and week_start=p_selected_week and saved)::integer selected_applicants
    from calculated
  ), channels as (
    select coalesce(sum(applicants_fb) filter(where saved and efb),0)::integer channel_fb,coalesce(sum(applicants_jobthai) filter(where saved and ejobthai),0)::integer channel_jobthai,
      coalesce(sum(applicants_jobtopgun) filter(where saved and ejobtopgun),0)::integer channel_jobtopgun,coalesce(sum(applicants_jobdb) filter(where saved and ejobdb),0)::integer channel_jobdb,
      coalesce(sum(applicants_jobbkk) filter(where saved and ejobbkk),0)::integer channel_jobbkk,coalesce(sum(applicants_linkedin) filter(where saved and elinkedin),0)::integer channel_linkedin,
      coalesce(sum(applicants_walkin) filter(where saved and ewalkin),0)::integer channel_walkin,coalesce(sum(applicants_referral) filter(where saved and ereferral),0)::integer channel_referral,
      coalesce(sum(applicants_others) filter(where saved and eothers),0)::integer channel_others from calculated
  ), weekly as (
    select week_start,count(*)::integer expected_rows,count(*) filter(where update_week is not null)::integer updated_rows,
      case when count(*) filter(where not saved)>0 then null when bool_or(applicants is null) then null else coalesce(sum(applicants),0)::integer end applicants
    from calculated group by week_start order by week_start desc limit 8
  ), selected_update as (
    select * from calculated where group_id=p_group_id and week_start=p_selected_week limit 1
  )
  select jsonb_build_object('selectedWeek',p_selected_week,'groupId',p_group_id,'totalApplicants',case when t.saved_rows=0 then null else t.total_applicants end,
    'selectedApplicants',case when t.selected_saved>0 then t.selected_applicants else null end,'expectedRows',t.expected_rows,'updatedWeeks',t.updated_weeks,
    'completeness',case when t.expected_rows=0 then 0 else round(t.updated_weeks::numeric/t.expected_rows*100)::integer end,
    'channels',jsonb_build_object('channel_fb',ch.channel_fb,'channel_jobthai',ch.channel_jobthai,'channel_jobtopgun',ch.channel_jobtopgun,'channel_jobdb',ch.channel_jobdb,'channel_jobbkk',ch.channel_jobbkk,'channel_linkedin',ch.channel_linkedin,'channel_walkin',ch.channel_walkin,'channel_referral',ch.channel_referral,'channel_others',ch.channel_others),
    'weeks',coalesce((select jsonb_agg(jsonb_build_object('week_start',week_start,'expectedRows',expected_rows,'updatedRows',updated_rows,'applicants',applicants) order by week_start desc) from weekly),'[]'::jsonb),
    'stageChannels',case when p_group_id is null then null else app_private.dashboard_sourcing_stage_channels_v1(p_group_id,p_selected_week,v_today) end)
  into v_result from totals t cross join channels ch;
  return v_result;
end $$;

-- Explicitly target a test/development project. All synthetic rows and audit writes
-- are rolled back by the PZ001 subtransaction before the result is returned.
-- Existing profiles supply role claims only; no real candidate is read or modified.
create temp table qa_candidate_delete_checks(checks jsonb);
do $verification$
declare
  v_admin uuid;
  v_other record;
  v_prefix text := '__qa_delete_' || replace(gen_random_uuid()::text, '-', '');
  v_pool text;
  v_person text;
  v_g1 text;
  v_g2 text;
  v_d1 text;
  v_d2 text;
  v_a1 uuid;
  v_a2 uuid;
  v_result jsonb;
  v_checks text[] := '{}';
  v_denied boolean;
begin
  v_pool := v_prefix || '_pool'; v_person := v_prefix || '_person';
  v_g1 := v_prefix || '_g1'; v_g2 := v_prefix || '_g2';
  v_d1 := v_prefix || '_r1'; v_d2 := v_prefix || '_r2';
  begin
    select id into v_admin from public.profiles where role='system_admin' order by id limit 1;
    if v_admin is null then raise exception 'System-admin fixture context is required.'; end if;
    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
    insert into public.candidates(candidate_id,name,created_by) values(v_pool,'Synthetic delete pool',v_admin);

    for v_other in select distinct on (role) id,role from public.profiles where role <> 'system_admin' order by role,id loop
      perform set_config('request.jwt.claim.sub',v_other.id::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',v_other.id,'role','authenticated')::text,true);
      v_denied := false;
      begin
        perform public.app_delete_recruitment_record(jsonb_build_object('entity','candidate','id',v_pool));
      exception when others then
        if sqlerrm not like '%System admin role is required%' then raise; end if;
        v_denied := true;
      end;
      if not v_denied or not exists(select 1 from public.candidates where candidate_id=v_pool) then
        raise exception 'Non-admin deletion was not safely denied: %',v_other.role;
      end if;
      v_checks := array_append(v_checks,v_other.role || ' denied by server');
    end loop;

    perform set_config('request.jwt.claim.sub',v_admin::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
    v_result := public.app_delete_recruitment_record(jsonb_build_object('entity','candidate','id',v_pool));
    if v_result->>'ok' <> 'true' or exists(select 1 from public.candidates where candidate_id=v_pool) then
      raise exception 'Talent-pool candidate was not deleted.';
    end if;
    v_checks := array_append(v_checks,'talent-pool deletion without requisitions or offers');

    insert into public.requisitions(doc_id,site,position,department,head_count,status)
      values(v_d1,'KT1','Synthetic delete role 1','QA',1,'ongoing'),(v_d2,'KT1','Synthetic delete role 2','QA',1,'ongoing');
    insert into public.position_groups(group_id,group_position) values(v_g1,'Synthetic group 1'),(v_g2,'Synthetic group 2');
    insert into public.document_groups(doc_group_id,doc_id,group_id,group_position)
      values(v_prefix || '_dg1',v_d1,v_g1,'Synthetic group 1'),(v_prefix || '_dg2',v_d2,v_g2,'Synthetic group 2');
    insert into public.candidates(candidate_id,name,created_by) values(v_person,'Synthetic delete applications',v_admin);
    insert into public.candidate_applications(candidate_id,group_id,created_by) values(v_person,v_g1,v_admin) returning application_id into v_a1;
    insert into public.candidate_applications(candidate_id,group_id,created_by) values(v_person,v_g2,v_admin) returning application_id into v_a2;
    insert into public.candidate_application_assignments(application_id,group_id,actor_id)
      values(v_a1,v_g1,v_admin),(v_a2,v_g2,v_admin);
    insert into public.candidate_notes(candidate_id,body,created_by) values(v_person,'Synthetic delete note',v_admin);
    insert into public.candidate_references(candidate_id,reference_name,relationship,channel_type,channel_value)
      values(v_person,'Synthetic referee','QA','email','qa-delete@example.test');
    insert into public.recruitment_logs(candidate_id,application_id,log_date,recruitment_process,round)
      values(v_person,v_a1,current_date,'Phone Screen',1);
    if exists(select 1 from public.candidates where candidate_id=v_person and (group_id is not null or doc_group_id is not null)) then
      raise exception 'Independent profile unexpectedly has a legacy anchor.';
    end if;
    v_result := public.app_delete_recruitment_record(jsonb_build_object('entity','candidate','id',v_person));
    if v_result->>'ok' <> 'true'
      or exists(select 1 from public.candidates where candidate_id=v_person)
      or exists(select 1 from public.candidate_applications where candidate_id=v_person)
      or exists(select 1 from public.candidate_application_assignments where application_id in (v_a1,v_a2))
      or exists(select 1 from public.candidate_notes where candidate_id=v_person)
      or exists(select 1 from public.candidate_references where candidate_id=v_person)
      or exists(select 1 from public.recruitment_logs where candidate_id=v_person)
      or exists(select 1 from app_private.candidate_group_journey_claims where candidate_id=v_person) then
      raise exception 'Candidate deletion left linked data behind.';
    end if;
    if (select count(*) from public.requisitions where doc_id in (v_d1,v_d2)) <> 2
      or (select count(*) from public.position_groups where group_id in (v_g1,v_g2)) <> 2 then
      raise exception 'Candidate deletion removed shared requisitions or groups.';
    end if;
    if not exists(select 1 from public.change_logs where entity='candidates' and entity_id=v_person and action='candidate:delete') then
      raise exception 'Candidate deletion did not retain its audit entry.';
    end if;
    v_checks := array_append(v_checks,'independent applications, assignments, notes, references, logs and claims cascade');
    v_checks := array_append(v_checks,'shared groups/requisitions and delete audit retained');

    v_denied := false;
    begin
      perform public.app_delete_recruitment_record(jsonb_build_object('entity','candidate','id',v_person));
    exception when others then
      if sqlerrm not like '%Record not found%' then raise; end if;
      v_denied := true;
    end;
    if not v_denied then raise exception 'Repeated deletion did not report missing record.'; end if;
    v_checks := array_append(v_checks,'repeated deletion returns Record not found');
    raise exception using errcode='PZ001',message='Rollback all synthetic fixtures';
  exception when sqlstate 'PZ001' then null;
  end;
  if exists(select 1 from public.candidates where candidate_id in (v_pool,v_person))
    or exists(select 1 from public.requisitions where doc_id in (v_d1,v_d2))
    or exists(select 1 from public.position_groups where group_id in (v_g1,v_g2)) then
    raise exception 'Synthetic verification fixtures were not rolled back.';
  end if;
  insert into qa_candidate_delete_checks values(jsonb_build_object('passed',v_checks,'fixtures_rolled_back',true));
end;
$verification$;
select checks from qa_candidate_delete_checks;

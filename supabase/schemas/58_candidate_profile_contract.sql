-- Authenticated, minimal projections. Definer RPCs explicitly filter every returned row.
create or replace function public.app_masked_candidate_pool_v1() returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.candidate_id,'position_interests',c.position_interests,'created_by',c.created_by,'creator_label',coalesce(p.nickname,p.full_name,'Unknown'),'created_at',c.created_at) order by c.created_at desc),'[]'::jsonb)
 from public.candidates c left join public.profiles p on p.id=c.created_by where auth.uid() is not null and app_private.is_recruitment_reader() and not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id) and not app_private.can_read_candidate(c.candidate_id)
$$;
create or replace function public.app_candidate_profile_capabilities_v1() returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.candidate_id,'creator_label',coalesce(p.nickname,p.full_name,'Unknown'),'can_edit',app_private.can_manage_candidate(c.candidate_id),'can_read_note',app_private.can_read_profile_note(c.candidate_id),'can_edit_note',app_private.can_edit_profile_note(c.candidate_id),'can_add_application',app_private.can_match_candidate(c.candidate_id),'is_unmatched',not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id),'note_editor_label',case when app_private.can_read_profile_note(c.candidate_id) then (select coalesce(pn.nickname,pn.full_name,'Recruiter') from public.candidate_notes n left join public.profiles pn on pn.id=coalesce(n.updated_by,n.created_by) where n.candidate_id=c.candidate_id) end)),'[]'::jsonb)
 from public.candidates c left join public.profiles p on p.id=c.created_by where auth.uid() is not null and app_private.can_read_candidate(c.candidate_id)
$$;
create or replace function public.app_application_destinations_v1() returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('group_id',g.group_id,'group_position',g.group_position,'sites',x.sites,'owners',x.owners,'doc_ids',x.doc_ids) order by g.group_position,g.group_id),'[]'::jsonb)
 from public.position_groups g join lateral (
 select array_agg(distinct r.site) sites,array_remove(array_agg(distinct r.person_in_charge),null) owners,array_agg(distinct r.doc_id) doc_ids from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=g.group_id and r.status='ongoing' and r.head_count>(select count(*) from public.offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')
 ) x on cardinality(x.doc_ids)>0 where auth.uid() is not null and app_private.is_recruitment_writer()
$$;
create or replace function public.app_candidate_duplicate_matches_v1(payload jsonb) returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.candidate_id,'phone',nullif(regexp_replace(payload->>'phone_no','[^0-9]','','g'),'') is not null and regexp_replace(c.phone_no,'[^0-9]','','g')=regexp_replace(payload->>'phone_no','[^0-9]','','g'),'email',nullif(lower(btrim(payload->>'email')),'') is not null and lower(btrim(c.email))=lower(btrim(payload->>'email'))) order by c.candidate_id),'[]'::jsonb)
 from public.candidates c where auth.uid() is not null and app_private.is_recruitment_writer() and c.candidate_id is distinct from nullif(payload->>'candidate_id','') and app_private.can_read_candidate(c.candidate_id) and (
 (nullif(regexp_replace(payload->>'phone_no','[^0-9]','','g'),'') is not null and regexp_replace(c.phone_no,'[^0-9]','','g')=regexp_replace(payload->>'phone_no','[^0-9]','','g')) or (nullif(lower(btrim(payload->>'email')),'') is not null and lower(btrim(c.email))=lower(btrim(payload->>'email'))))
$$;

create or replace function public.app_upsert_candidate_note_v2(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_candidate text:=payload->>'candidate_id'; v_note public.candidate_notes%rowtype; v_body text:=nullif(btrim(payload->>'body'),'');
begin
 perform app_private.assert_recruitment_writer();
 if not app_private.can_edit_profile_note(v_candidate) then raise exception 'PROFILE_NOTE_NOT_AUTHORIZED'; end if;
 perform 1 from public.candidates where candidate_id=v_candidate for update;
 select * into v_note from public.candidate_notes where candidate_id=v_candidate for update;
 if v_note.note_id is not null then
  if v_note.note_id is distinct from nullif(payload->>'expected_note_id','')::uuid or v_note.version is distinct from nullif(payload->>'expected_version','')::integer then raise exception 'PROFILE_NOTE_STALE_WRITE: Reload the current note before saving.'; end if;
 elsif nullif(payload->>'expected_note_id','') is not null then raise exception 'PROFILE_NOTE_STALE_WRITE'; end if;
 perform set_config('app.action','candidate-note:save',true);
 if v_body is null then delete from public.candidate_notes where candidate_id=v_candidate;
 elsif v_note.note_id is null then insert into public.candidate_notes(candidate_id,body,created_by,updated_by) values(v_candidate,v_body,auth.uid(),auth.uid()) returning * into v_note;
 else update public.candidate_notes set body=v_body,updated_by=auth.uid(),updated_at=clock_timestamp(),version=version+1 where candidate_id=v_candidate returning * into v_note;
 end if;
 return jsonb_build_object('ok',true,'id',v_candidate,'note_id',case when v_body is not null then v_note.note_id end,'version',case when v_body is not null then v_note.version end);
end $$;
create or replace function public.app_add_candidate_note_v1(payload jsonb) returns jsonb language sql security definer set search_path=public,app_private as $$
 select public.app_upsert_candidate_note_v2(payload)
$$;

create or replace function public.app_upsert_candidate_profile_v2(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_id text:=nullif(payload->>'candidate_id',''); v_mode text:=coalesce(payload->>'mode','new'); v_previous public.candidates%rowtype;
 v_home text; v_creator uuid:=auth.uid(); v_owner uuid:=auth.uid(); v_phone text:=nullif(btrim(payload->>'phone_no'),''); v_email text:=nullif(btrim(payload->>'email'),''); v_matches jsonb; v_result jsonb; v_ref jsonb; v_note public.candidate_notes%rowtype;
begin
 perform app_private.assert_recruitment_writer();
 if v_mode not in ('new','change') then raise exception 'PROFILE_MODE_INVALID'; end if;
 if v_mode='change' then
  if not app_private.can_manage_candidate(v_id) then raise exception 'PROFILE_NOT_AUTHORIZED'; end if;
  select * into v_previous from public.candidates where candidate_id=v_id for update;
  v_home:=v_previous.home_site;v_creator:=v_previous.created_by;v_owner:=v_previous.responsible_recruiter_id;
 else
  v_id:=app_private.next_app_id('candidates','CAN');
  if app_private.current_app_role()='site_recruiter' then
   v_home:=nullif(btrim(app_private.current_profile_site()),'');
   if v_home is null then raise exception 'PROFILE_ACCOUNT_SITE_REQUIRED: Ask an administrator to configure your account site.'; end if;
  end if;
 end if;
 if nullif(btrim(payload->>'name'),'') is null then raise exception 'PROFILE_REQUIRED: Candidate name is required.'; end if;
 if (v_mode='change' and v_phone is null) or (v_phone is not null and v_phone !~ '^0[0-9]{9}$') then raise exception 'CANDIDATE_PHONE_INVALID'; end if;
 if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'CANDIDATE_EMAIL_INVALID'; end if;
 if nullif(payload->>'first_contact_date','')::date>(now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER'; end if;
 v_matches:=public.app_candidate_duplicate_matches_v1(payload||jsonb_build_object('candidate_id',case when v_mode='change' then v_id end));
 if jsonb_array_length(v_matches)>0 and not(coalesce(payload->'duplicate_review'->'matches','null'::jsonb)=v_matches and coalesce(payload->'duplicate_review'->>'phone','')=coalesce(v_phone,'') and coalesce(payload->'duplicate_review'->>'email','')=coalesce(lower(v_email),'')) then
  raise exception 'PROFILE_DUPLICATE_REVIEW_REQUIRED' using detail=jsonb_build_object('code','PROFILE_DUPLICATE_REVIEW_REQUIRED','matches',v_matches)::text;
 end if;
 perform set_config('app.action','candidate-profile:'||v_mode,true);
 insert into public.candidates(candidate_id,created_by,name,nickname,phone_no,email,home_site,responsible_recruiter_id,position_interests,channel,ref_name,first_contact_date,candidate_folder_url)
 values(v_id,v_creator,btrim(payload->>'name'),nullif(btrim(payload->>'nickname'),''),v_phone,v_email,v_home,v_owner,nullif(btrim(payload->>'position_interests'),''),nullif(payload->>'channel',''),nullif(payload->>'ref_name',''),nullif(payload->>'first_contact_date','')::date,nullif(payload->>'candidate_folder_url',''))
 on conflict(candidate_id) do update set name=excluded.name,nickname=excluded.nickname,phone_no=excluded.phone_no,email=excluded.email,position_interests=excluded.position_interests,channel=excluded.channel,ref_name=excluded.ref_name,first_contact_date=excluded.first_contact_date,candidate_folder_url=excluded.candidate_folder_url;
 if payload ? 'note' then
  select * into v_note from public.candidate_notes where candidate_id=v_id;
  if nullif(btrim(payload->>'note'),'') is distinct from v_note.body then
   perform public.app_upsert_candidate_note_v2(jsonb_build_object('candidate_id',v_id,'body',payload->>'note','expected_note_id',payload->>'expected_note_id','expected_version',payload->>'expected_note_version'));
  end if;
 end if;
 for v_ref in select value from jsonb_array_elements(coalesce(payload->'references','[]'::jsonb)) loop
  perform public.app_upsert_candidate_reference_v1(v_ref||jsonb_build_object('candidate_id',v_id));
 end loop;
 v_result:=jsonb_build_object('ok',true,'id',v_id,'candidate_id',v_id);
 if v_mode='new' and nullif(payload->>'group_id','') is not null then
  v_result:=public.app_create_candidate_application_v1(jsonb_build_object('candidate_id',v_id,'group_id',payload->>'group_id','opened_date',payload->>'first_contact_date'));
 end if;
 return v_result;
end $$;
create or replace function public.app_upsert_candidate_profile_v1(payload jsonb) returns jsonb language sql security definer set search_path=public,app_private as $$
 select public.app_upsert_candidate_profile_v2(payload)
$$;

-- Shared server capability for service-backed meeting and letter handlers.
create or replace function public.app_can_manage_application_v1(p_application_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select auth.uid() is not null and app_private.can_manage_application(p_application_id)
$$;

revoke all on function public.app_masked_candidate_pool_v1(),public.app_candidate_profile_capabilities_v1(),public.app_application_destinations_v1(),public.app_candidate_duplicate_matches_v1(jsonb),public.app_upsert_candidate_note_v2(jsonb),public.app_upsert_candidate_profile_v2(jsonb),public.app_can_manage_application_v1(uuid) from public,anon,authenticated;
grant execute on function public.app_masked_candidate_pool_v1(),public.app_candidate_profile_capabilities_v1(),public.app_application_destinations_v1(),public.app_candidate_duplicate_matches_v1(jsonb),public.app_upsert_candidate_note_v2(jsonb),public.app_upsert_candidate_profile_v2(jsonb),public.app_can_manage_application_v1(uuid) to authenticated;
revoke all on all functions in schema app_private from public,anon;
grant execute on all functions in schema app_private to authenticated;

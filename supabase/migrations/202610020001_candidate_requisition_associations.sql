begin;

create table if not exists public.candidate_requisitions (
  candidate_id text not null references public.candidates(candidate_id) on delete cascade,
  doc_id text not null references public.requisitions(doc_id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (candidate_id, doc_id)
);
create index if not exists candidate_requisitions_doc_candidate_idx
  on public.candidate_requisitions(doc_id, candidate_id);

-- Backfill only explicit evidence. Shared position-group membership does not
-- associate a candidate with every requisition in that group.
insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
select c.candidate_id, dg.doc_id, null
from public.candidates c
join public.document_groups dg on dg.doc_group_id = c.doc_group_id
on conflict (candidate_id, doc_id) do nothing;

insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
select o.candidate_id, o.doc_id, null
from public.offers o
on conflict (candidate_id, doc_id) do nothing;

create or replace function app_private.associate_candidate_with_anchor_requisition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.doc_group_id is not null then
    insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
    select new.candidate_id, dg.doc_id, auth.uid()
    from public.document_groups dg
    where dg.doc_group_id = new.doc_group_id
    on conflict (candidate_id, doc_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists associate_candidate_with_anchor_requisition on public.candidates;
create trigger associate_candidate_with_anchor_requisition after insert on public.candidates
for each row execute function app_private.associate_candidate_with_anchor_requisition();

create or replace function app_private.associate_candidate_with_offer_requisition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
  values (new.candidate_id, new.doc_id, auth.uid())
  on conflict (candidate_id, doc_id) do nothing;
  return new;
end;
$$;
drop trigger if exists associate_candidate_with_offer_requisition on public.offers;
create trigger associate_candidate_with_offer_requisition after insert or update of candidate_id, doc_id on public.offers
for each row execute function app_private.associate_candidate_with_offer_requisition();

alter table public.candidate_requisitions enable row level security;
grant select on public.candidate_requisitions to authenticated;
drop policy if exists candidate_requisitions_scoped_read on public.candidate_requisitions;
create policy candidate_requisitions_scoped_read on public.candidate_requisitions
for select to authenticated
using (app_private.can_read_requisition(doc_id) and app_private.can_read_candidate(candidate_id));

drop trigger if exists audit_candidate_requisitions on public.candidate_requisitions;
create trigger audit_candidate_requisitions after insert or update or delete on public.candidate_requisitions
for each row execute function app_private.audit_row_change();

-- Preserve the selected document-group requisition instead of picking an
-- arbitrary sibling from the shared sourcing group.
create or replace function public.app_upsert_candidate(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_doc_group_id text;
  v_legacy_doc_group_id text := nullif(payload ->> 'doc_group_id', '');
  v_nickname text := nullif(btrim(payload ->> 'nickname'), '');
  v_phone_no text := nullif(payload ->> 'phone_no', '');
  v_email text := nullif(btrim(payload ->> 'email'), '');
  v_references jsonb := coalesce(payload -> 'references', '[]'::jsonb);
  v_reference jsonb;
  v_exists boolean;
  v_initial_log_date date;
begin
  perform app_private.assert_recruitment_writer();
  if v_group_id is null then
    select group_id into v_group_id from public.document_groups where doc_group_id = v_legacy_doc_group_id;
  end if;
  if (v_mode = 'change' and v_phone_no is null) or (v_phone_no is not null and v_phone_no !~ '^0[0-9]{9}$') then
    raise exception 'CANDIDATE_PHONE_INVALID: Phone No. must be exactly 10 digits beginning with 0.';
  end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'CANDIDATE_EMAIL_INVALID: Enter a valid email address.';
  end if;
  if not app_private.can_manage_sourcing_group(v_group_id) then raise exception 'You can create candidates only for sourcing groups you manage.'; end if;

  if v_mode = 'new' and not exists (
    select 1
    from public.document_groups dg
    join public.requisitions r on r.doc_id = dg.doc_id
    left join lateral (
      select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null
    ) accepted on true
    where dg.group_id = v_group_id
      and r.status = 'ongoing'
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
  ) then
    raise exception 'CANDIDATE_GROUP_NOT_AVAILABLE: Group ID must contain an ongoing requisition with remaining headcount.';
  end if;
  select dg.doc_group_id into v_doc_group_id
  from public.document_groups dg
  where dg.group_id = v_group_id
    and (v_legacy_doc_group_id is null or dg.doc_group_id = v_legacy_doc_group_id)
    and app_private.can_manage_requisition(dg.doc_id)
  order by dg.doc_group_id
  limit 1;
  if v_legacy_doc_group_id is not null and v_doc_group_id is null then
    raise exception 'CANDIDATE_REQUISITION_DENIED: Select a requisition you manage from this sourcing group.';
  end if;

  if v_mode = 'new' then
    v_candidate_id := app_private.next_app_id('candidates', 'CAN');
  elsif v_candidate_id is null then
    raise exception 'Candidate ID is required in Change mode.';
  end if;

  select exists(select 1 from public.candidates where candidate_id = v_candidate_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Candidate ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Candidate ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can edit candidates only for requisitions where you are person in charge.'; end if;

  perform set_config('app.action', 'candidate:' || v_mode, true);
  insert into public.candidates (candidate_id, name, nickname, phone_no, email, doc_group_id, group_id, channel, ref_name, first_contact_date, candidate_folder_url)
  values (
    v_candidate_id, nullif(payload ->> 'name', ''), v_nickname, v_phone_no, v_email, v_doc_group_id, v_group_id,
    nullif(payload ->> 'channel', ''), nullif(payload ->> 'ref_name', ''),
    nullif(payload ->> 'first_contact_date', '')::date, nullif(payload ->> 'candidate_folder_url', '')
  )
  on conflict (candidate_id) do update set
    name = excluded.name, nickname = excluded.nickname, phone_no = excluded.phone_no,
    email = excluded.email, doc_group_id = excluded.doc_group_id, group_id = excluded.group_id,
    channel = excluded.channel, ref_name = excluded.ref_name,
    first_contact_date = excluded.first_contact_date, candidate_folder_url = excluded.candidate_folder_url;

  if v_mode = 'new' then
    insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
    select v_candidate_id, dg.doc_id, auth.uid()
    from public.document_groups dg where dg.doc_group_id = v_doc_group_id
    on conflict (candidate_id, doc_id) do nothing;
  end if;

  for v_reference in select value from jsonb_array_elements(v_references) loop
    if nullif(btrim(coalesce(v_reference ->> 'reference_name', '')), '') is null
      or nullif(btrim(coalesce(v_reference ->> 'relationship', '')), '') is null
      or lower(coalesce(nullif(v_reference ->> 'channel_type', ''), '')) not in ('phone', 'email', 'line', 'other')
      or nullif(btrim(coalesce(v_reference ->> 'channel_value', '')), '') is null
      or (lower(v_reference ->> 'channel_type') = 'other' and nullif(btrim(coalesce(v_reference ->> 'other_channel_label', '')), '') is null)
    then
      raise exception 'REFERENCE_INVALID_PAYLOAD: Each candidate reference needs name, relationship, channel, and contact value; Other requires a label.';
    end if;
    perform set_config('app.action', 'candidate-reference:add', true);
    insert into public.candidate_references (
      candidate_id, reference_name, relationship, channel_type, channel_value, other_channel_label, created_by, updated_by
    ) values (
      v_candidate_id, btrim(v_reference ->> 'reference_name'), btrim(v_reference ->> 'relationship'), lower(v_reference ->> 'channel_type'),
      btrim(v_reference ->> 'channel_value'), case when lower(v_reference ->> 'channel_type') = 'other' then nullif(btrim(v_reference ->> 'other_channel_label'), '') else null end,
      auth.uid(), auth.uid()
    );
  end loop;

  if v_mode = 'new' then
    v_initial_log_date := coalesce(nullif(payload ->> 'first_contact_date', '')::date, current_date);
    if v_initial_log_date > (now() at time zone 'Asia/Bangkok')::date then
      raise exception 'PIPELINE_DATE_ORDER: Initial Pending date cannot be after the Bangkok business date.';
    end if;
    perform set_config('app.action', 'recruitment_log:auto-phone-screen', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin)
    values (v_candidate_id, v_initial_log_date, 'Phone Screen', 1, null, null, 'Initial pending phone screening', 'auto');
  end if;

  return jsonb_build_object('ok', true, 'id', v_candidate_id);
end;
$$;

create or replace function public.app_set_candidate_requisition_association_v1(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_associate boolean;
begin
  perform app_private.assert_recruitment_writer();
  if jsonb_typeof(payload -> 'associate') is distinct from 'boolean' then
    raise exception 'CANDIDATE_REQUISITION_INVALID: Association action must be true or false.';
  end if;
  v_associate := (payload ->> 'associate')::boolean;
  if v_candidate_id is null or v_doc_id is null then
    raise exception 'CANDIDATE_REQUISITION_INVALID: Candidate and requisition are required.';
  end if;
  if not exists (select 1 from public.candidates where candidate_id = v_candidate_id) then
    raise exception 'CANDIDATE_REQUISITION_INVALID: Candidate does not exist.';
  end if;
  if not exists (select 1 from public.requisitions where doc_id = v_doc_id) then
    raise exception 'CANDIDATE_REQUISITION_INVALID: Requisition does not exist.';
  end if;
  if not app_private.can_manage_candidate(v_candidate_id)
     or not app_private.can_manage_requisition(v_doc_id) then
    raise exception 'CANDIDATE_REQUISITION_DENIED: You can change associations only for candidates and requisitions you manage.';
  end if;

  perform set_config('app.action', case when v_associate
    then 'candidate-requisition:add' else 'candidate-requisition:remove' end, true);
  if v_associate then
    insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
    values (v_candidate_id, v_doc_id, auth.uid())
    on conflict (candidate_id, doc_id) do nothing;
  else
    delete from public.candidate_requisitions
    where candidate_id = v_candidate_id and doc_id = v_doc_id;
  end if;
  return jsonb_build_object('ok', true, 'candidate_id', v_candidate_id,
    'doc_id', v_doc_id, 'associated', v_associate);
end;
$$;
revoke all on function public.app_set_candidate_requisition_association_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.app_set_candidate_requisition_association_v1(jsonb)
  to authenticated;

commit;

create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.recruitment_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_key text not null,
  notification_type text not null check (notification_type in ('new_hire_confirmation', 'probation')),
  offer_id bigint references public.offers(offer_id) on delete set null,
  candidate_id text not null,
  application_id uuid,
  candidate_name text not null,
  doc_id text not null,
  position text,
  site text,
  first_working_date date not null,
  milestone_days smallint,
  reminder_days_before smallint,
  due_date date not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text,
  constraint recruitment_notifications_milestone_shape check (
    (notification_type = 'new_hire_confirmation' and milestone_days is null and reminder_days_before is null)
    or (notification_type = 'probation' and milestone_days in (45, 90, 119) and reminder_days_before in (0, 3, 7))
  ),
  constraint recruitment_notifications_recipient_key unique (recipient_id, notification_key)
);

create index if not exists recruitment_notifications_recipient_created_idx
  on public.recruitment_notifications (recipient_id, created_at desc);

alter table public.recruitment_notifications enable row level security;
revoke all on public.recruitment_notifications from anon, authenticated;
grant select, update (read_at) on public.recruitment_notifications to authenticated;

drop policy if exists recruitment_notifications_read_own on public.recruitment_notifications;
create policy recruitment_notifications_read_own
  on public.recruitment_notifications for select to authenticated
  using ((select auth.uid()) = recipient_id);

drop policy if exists recruitment_notifications_update_own_read_state on public.recruitment_notifications;
create policy recruitment_notifications_update_own_read_state
  on public.recruitment_notifications for update to authenticated
  using ((select auth.uid()) = recipient_id)
  with check ((select auth.uid()) = recipient_id);

create or replace function app_private.generate_recruitment_notifications_v1()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  with assignments as (
    select o.offer_id, o.candidate_id, o.application_id, o.doc_id, o.accepted_date,
      o.first_working_date, o.start_confirmation, r.position, r.site, p.id recipient_id,
      c.name candidate_name
    from public.offers o
    join public.requisitions r on r.doc_id = o.doc_id
    join public.candidates c on c.candidate_id = o.candidate_id
    join public.profiles p on p.role in ('site_recruiter', 'admin_recruiter', 'system_admin')
      and (
        (nullif(btrim(p.nickname), '') is not null and position(lower(btrim(p.nickname)) in lower(coalesce(r.person_in_charge, ''))) > 0)
        or (nullif(btrim(p.full_name), '') is not null and position(lower(btrim(p.full_name)) in lower(coalesce(r.person_in_charge, ''))) > 0)
      )
    where o.accepted_date is not null and o.first_working_date is not null
  ), targets as (
    select a.*, 'new_hire_confirmation'::text notification_type, null::smallint milestone_days,
      null::smallint reminder_days_before, a.first_working_date due_date,
      'confirmation|' || a.offer_id::text || '|' || a.first_working_date::text notification_key
    from assignments a
    where a.first_working_date <= v_today and a.start_confirmation is null
    union all
    select a.*, 'probation'::text, m.milestone_days::smallint, d.reminder_days_before::smallint,
      a.first_working_date + (m.milestone_days - d.reminder_days_before),
      'probation|' || a.offer_id::text || '|' || a.first_working_date::text || '|' || m.milestone_days::text || '|' || d.reminder_days_before::text
    from assignments a
    cross join (values (45), (90), (119)) as m(milestone_days)
    cross join (values (7), (3), (0)) as d(reminder_days_before)
    where a.start_confirmation = 'started'
      and a.first_working_date + (m.milestone_days - d.reminder_days_before) <= v_today
  )
  insert into public.recruitment_notifications (
    recipient_id, notification_key, notification_type, offer_id, candidate_id, application_id,
    candidate_name, doc_id, position, site, first_working_date, milestone_days,
    reminder_days_before, due_date
  )
  select recipient_id, notification_key, notification_type, offer_id, candidate_id, application_id,
    candidate_name, doc_id, position, site, first_working_date, milestone_days,
    reminder_days_before, due_date
  from targets
  on conflict (recipient_id, notification_key) do nothing;

  update public.recruitment_notifications n
  set resolved_at = now(),
      resolution_reason = case
        when o.start_confirmation = 'started' and n.notification_type = 'new_hire_confirmation' then 'start_confirmed'
        when o.start_confirmation = 'did_not_start' then 'did_not_start'
        when n.notification_type = 'probation' and o.first_working_date + n.milestone_days < v_today then 'milestone_passed'
        else 'offer_or_assignment_changed'
      end
  from public.offers o
  where n.offer_id = o.offer_id and n.resolved_at is null
    and not exists (
      select 1
      from public.requisitions r
      join public.profiles p on p.id = n.recipient_id
        and p.role in ('site_recruiter', 'admin_recruiter', 'system_admin')
        and (
          (nullif(btrim(p.nickname), '') is not null and position(lower(btrim(p.nickname)) in lower(coalesce(r.person_in_charge, ''))) > 0)
          or (nullif(btrim(p.full_name), '') is not null and position(lower(btrim(p.full_name)) in lower(coalesce(r.person_in_charge, ''))) > 0)
        )
      where r.doc_id = o.doc_id and o.accepted_date is not null
        and o.first_working_date = n.first_working_date
        and (
          (n.notification_type = 'new_hire_confirmation' and o.start_confirmation is null and o.first_working_date <= v_today)
          or (n.notification_type = 'probation' and o.start_confirmation = 'started' and o.first_working_date + n.milestone_days >= v_today)
        )
    );
end;
$$;

revoke all on function app_private.generate_recruitment_notifications_v1() from public, anon, authenticated;

create or replace function public.app_mark_recruitment_notification_read_v1(p_notification_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.recruitment_notifications
  set read_at = coalesce(read_at, now())
  where notification_id = p_notification_id
    and recipient_id = (select auth.uid());
$$;

revoke all on function public.app_mark_recruitment_notification_read_v1(uuid) from public, anon;
grant execute on function public.app_mark_recruitment_notification_read_v1(uuid) to authenticated;

select app_private.generate_recruitment_notifications_v1();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'recruitment-notifications-daily') then
    perform cron.unschedule('recruitment-notifications-daily');
  end if;
  perform cron.schedule(
    'recruitment-notifications-daily',
    '0 2 * * *',
    'select app_private.generate_recruitment_notifications_v1();'
  );
end;
$$;

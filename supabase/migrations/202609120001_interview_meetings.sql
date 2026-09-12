create table if not exists public.interview_meetings (
  meeting_id uuid primary key default gen_random_uuid(), candidate_id text not null references public.candidates(candidate_id) on delete cascade,
  stage_instance_id uuid not null references public.recruitment_logs(stage_instance_id) on delete cascade,
  stage text not null check (stage in ('HR Interview', 'Line Interview')), starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  interviewer_emails text[] not null check (cardinality(interviewer_emails) > 0), note text,
  status text not null check (status in ('creating','scheduled','rescheduling','cancelling','cancelled','failed')),
  organizer_mailbox text, teams_event_id text, join_url text, flow_run_id text, failure_summary text,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_interview_meetings_candidate_stage on public.interview_meetings(candidate_id, stage_instance_id, starts_at desc);
create unique index if not exists uq_interview_meetings_active_stage on public.interview_meetings(stage_instance_id) where status in ('creating','scheduled','rescheduling','cancelling');
alter table public.interview_meetings enable row level security;
create policy interview_meetings_read on public.interview_meetings for select to authenticated using (app_private.can_read_candidate(candidate_id));
grant select on public.interview_meetings to authenticated;
drop trigger if exists set_interview_meetings_updated_at on public.interview_meetings;
create trigger set_interview_meetings_updated_at before update on public.interview_meetings for each row execute function app_private.set_updated_at();
drop trigger if exists audit_interview_meetings on public.interview_meetings;
create trigger audit_interview_meetings after insert or update or delete on public.interview_meetings for each row execute function app_private.audit_row_change();

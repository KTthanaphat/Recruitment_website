create table if not exists public.interview_invitation_templates (
  template_id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(btrim(name), '') is not null),
  language text not null check (language in ('th', 'en')),
  subject_template text not null check (nullif(btrim(subject_template), '') is not null),
  body_template text not null check (nullif(btrim(body_template), '') is not null),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_interview_invitation_templates_active_language on public.interview_invitation_templates(language, updated_at desc) where active;
alter table public.interview_invitation_templates enable row level security;
create policy interview_invitation_templates_read on public.interview_invitation_templates for select to authenticated using (active or app_private.current_app_role() in ('system_admin', 'admin_recruiter'));
grant select on public.interview_invitation_templates to authenticated;
drop trigger if exists set_interview_invitation_templates_updated_at on public.interview_invitation_templates;
create trigger set_interview_invitation_templates_updated_at before update on public.interview_invitation_templates for each row execute function app_private.set_updated_at();
drop trigger if exists audit_interview_invitation_templates on public.interview_invitation_templates;
create trigger audit_interview_invitation_templates after insert or update or delete on public.interview_invitation_templates for each row execute function app_private.audit_row_change();

alter table public.interview_meetings
  add column if not exists invitation_template_id uuid references public.interview_invitation_templates(template_id) on delete set null,
  add column if not exists invitation_template_version integer,
  add column if not exists invitation_language text check (invitation_language in ('th', 'en')),
  add column if not exists invitation_subject text,
  add column if not exists invitation_body text;

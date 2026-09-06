-- Human-reviewed rejection letters: the application creates Outlook drafts only.
create table if not exists public.rejection_letter_templates (
  template_id uuid primary key default gen_random_uuid(), name text not null check (nullif(btrim(name), '') is not null), language text not null check (language in ('th','en')),
  subject_template text not null check (nullif(btrim(subject_template), '') is not null), body_template text not null check (nullif(btrim(body_template), '') is not null),
  active boolean not null default true, version integer not null default 1 check (version > 0), created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.rejection_letter_drafts (
  draft_id uuid primary key default gen_random_uuid(), candidate_id text not null references public.candidates(candidate_id) on delete cascade,
  failed_stage_instance_id uuid not null references public.recruitment_logs(stage_instance_id), template_id uuid references public.rejection_letter_templates(template_id) on delete set null, template_version integer,
  language text not null check (language in ('th','en')), recipient_email text not null check (recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'), subject text not null check (nullif(btrim(subject), '') is not null), body text not null check (nullif(btrim(body), '') is not null),
  status text not null check (status in ('creating','draft_created','failed')), shared_mailbox text, outlook_draft_id text, flow_run_id text, response_metadata jsonb, failure_summary text,
  retry_of_draft_id uuid references public.rejection_letter_drafts(draft_id), created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), finalized_at timestamptz
);
create index if not exists idx_rejection_letter_drafts_candidate_created on public.rejection_letter_drafts(candidate_id, created_at desc);
create index if not exists idx_rejection_letter_templates_active_language on public.rejection_letter_templates(language, updated_at desc) where active;
alter table public.rejection_letter_templates enable row level security;
alter table public.rejection_letter_drafts enable row level security;
create policy rejection_letter_templates_read on public.rejection_letter_templates for select to authenticated using (active or app_private.is_system_admin());
create policy rejection_letter_drafts_read on public.rejection_letter_drafts for select to authenticated using (app_private.can_read_candidate(candidate_id));
grant select on public.rejection_letter_templates, public.rejection_letter_drafts to authenticated;
drop trigger if exists set_rejection_letter_templates_updated_at on public.rejection_letter_templates;
create trigger set_rejection_letter_templates_updated_at before update on public.rejection_letter_templates for each row execute function app_private.set_updated_at();
drop trigger if exists audit_rejection_letter_templates on public.rejection_letter_templates;
create trigger audit_rejection_letter_templates after insert or update or delete on public.rejection_letter_templates for each row execute function app_private.audit_row_change();
drop trigger if exists audit_rejection_letter_drafts on public.rejection_letter_drafts;
create trigger audit_rejection_letter_drafts after insert or update or delete on public.rejection_letter_drafts for each row execute function app_private.audit_row_change();

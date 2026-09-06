-- Recruiter admins can manage rejection-letter formats from Configuration.
drop policy if exists rejection_letter_templates_read on public.rejection_letter_templates;
create policy rejection_letter_templates_read on public.rejection_letter_templates
  for select to authenticated
  using (active or app_private.current_app_role() in ('system_admin', 'admin_recruiter'));

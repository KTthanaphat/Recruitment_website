-- Admin recruiters need eligible recruiter profiles to assign a requisition owner.
-- Profile updates remain restricted to system administrators by the separate UPDATE policy.
drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_select_self_or_recruiter_admin on public.profiles;

create policy profiles_select_self_or_recruiter_admin on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.current_app_role() in ('system_admin', 'admin_recruiter')
);

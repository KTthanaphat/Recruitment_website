-- Keep the deployed explicit anon revoke in repository migration history.
revoke all on function public.app_dashboard_company_report() from anon;
revoke all on function public.app_dashboard_company_report() from public;
grant execute on function public.app_dashboard_company_report() to authenticated;

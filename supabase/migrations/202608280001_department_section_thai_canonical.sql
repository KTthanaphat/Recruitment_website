-- Deploy after loading dep_sec_data.csv into public.department_section_directory.
-- The review query is intentionally non-mutating and lists values requiring approval.
create table if not exists public.department_section_directory (
  dep_sec_id text primary key,
  site text not null,
  department_th text not null,
  section_th text,
  department_en text,
  section_en text
);

update public.requisitions r
set department = d.department_th,
    section = coalesce(d.section_th, r.section)
from public.department_section_directory d
where d.site = r.site
  and (r.department = d.department_th or r.department = d.department_en)
  and (r.section is null or r.section = d.section_th or r.section = d.section_en);

-- Review before closing the deployment change:
-- select r.site, r.department, r.section, count(*) from public.requisitions r
-- left join public.department_section_directory d on d.site = r.site
--   and (r.department = d.department_th or r.department = d.department_en)
--   and (r.section is null or r.section = d.section_th or r.section = d.section_en)
-- where d.dep_sec_id is null group by 1,2,3 order by 1,2,3;

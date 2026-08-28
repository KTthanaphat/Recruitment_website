# Historical active-requisition reporting

- Requisition department/section values are canonical Thai values; `dep_sec_data.csv` supplies English display labels.
- Dashboard period reporting uses the latest requisition status log at or before the selected end date. Without a log, the requisition is ongoing with no detail.
- Active Requisitions offers in-period pipeline-activity and passed-stage counts, each de-duplicated per candidate and stage.
- Its Export dialog controls columns/order and previews five rows before XLSX or PNG export.

Ownership: `VacancyWaterfallView.tsx` (report/UI/export), `department-section-data.ts` (mapping), and `202608280001_department_section_thai_canonical.sql` (database conversion/review).

Stage totals are interactive only when non-zero. They open a read-only Dashboard candidate list and then a report-safe candidate detail containing identity and matching pipeline facts only.

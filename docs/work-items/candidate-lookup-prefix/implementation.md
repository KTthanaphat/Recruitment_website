# Candidate lookup prefix and active filter

Direct extension of the existing lookup in the active KT checkout. [Behavior owner](../../WEBSITE_STRUCTURE.md#candidate-contact-lookup); [design](../../design/candidate-lookup.md); [schema](../../../supabase/schemas/67_candidate_contact_lookup.sql).

Migration `20261114031559_candidate_lookup_prefix_active.sql` applied to `mppnlkldlctvketcsald` before enabling the v2 frontend. CLI 3.1.0 generated the local migration, populated from the reviewed canonical delta; its filename was aligned to the connected migration version. Existing v1 exact-contact calls remain compatible; no existing candidate data changed.

Database evidence: disposable real-RLS role matrix, phone/+66 prefix normalization, full email, active candidate/application pagination, unauthorized/no-match parity, anonymous/missing-auth denial, secret-only active exclusion, forward upgrade and canonical fresh install passed. Connected checks confirm invoker security, empty search paths, authenticated-only execution, normalized-prefix/missing-record smoke checks and a usable prefix index under a forced generic-plan probe. An existing unlinked-group fixture read was increased to its supported 50-item limit because the new fixtures exceeded the old first page.

Checks: `node scripts/rehearse-profile-contract.cjs --contact-lookup --confidentiality`; `node scripts/rehearse-confidentiality-fresh.cjs`; focused lookup browser suite 7/7 passed; TypeScript and documentation link/graph validation passed. Rendered desktop, Thai 360px phone idle/results and 390px bounds were checked. The switch is keyboard/touch accessible and toggling does not submit a query.

Real end-to-end p95 remains unverified without representative authenticated benchmark inputs. The query-plan probe does not establish latency. [Original privacy/performance delivery evidence](../confidential-recruitment/implementation.md). No push or deployment.

Security advisors: no new findings versus the pre-migration baseline (three existing advisory groups). Performance notices list contact indexes as unused under recorded traffic; retained because the explicit generic-plan probe confirms the prefix index is usable and representative application traffic has not been benchmarked.

Adjacent Save review and confidential-requisition browser regressions: 13/13 passed. Verified local page and stylesheet HTTP 200 at http://127.0.0.1:3100/candidates?lang=th; configured database mppnlkldlctvketcsald.supabase.co. The serving Next process and rendered updated UI correspond to the active KT checkout. No pushes or app deployment.

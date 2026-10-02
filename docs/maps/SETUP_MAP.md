# Setup map

Purpose: environment, verification, schema and release navigation. Product/UI ownership is in [System](SYSTEM_MAP.md). Read the matching node below; setup steps are not prerequisites for a routine component edit.

## SETUP-FEATURE-LOOP

For new features, follow the [feature delivery process](../workflows/FEATURE_DELIVERY_LOOP.md) for the user's agent choice, then use the relevant system node and SETUP-VERIFY.

## SETUP-LOCAL

Use for install, run or local-server problems.

- Commands/dependencies: [package.json](../../package.json), [README local development](../../README.md#local-development), [deployment local run](../DEPLOYMENT.md#local-run).
- Inspect the active checkout, current branch and existing server/port before starting or replacing a process; `3000` is the documented default, not guaranteed live state.
- A browser-default-styled Login can mean a generated Next CSS asset is unavailable. Inspect its network response and running dev/build processes before deciding on recovery; do not delete an active process's output blindly.
- Edges: `configured by` → SETUP-ENVIRONMENT; `checked by` → SETUP-VERIFY.

## SETUP-ENVIRONMENT

Use for auth/configuration or branch-to-service mismatch.

- Variable names and server-only boundaries: [environment variables](../DEPLOYMENT.md#environment-variables).
- Branch mapping: [README Supabase mapping](../../README.md#supabase-branch-mapping). Read configured identifiers without exposing secret values.
- Provider instructions in Deployment describe a Vercel target; the Teams contract mentions Render. Verify the actual configured host for the requested deployment instead of inferring it from either document alone.
- Edges: `configures` → [SYS-PLATFORM](system/platform.md), [SYS-INTEGRATIONS](system/integrations.md); `used by` → SETUP-LOCAL / SETUP-RELEASE.

## SETUP-DATABASE

Use for a schema/RPC change or migration rollout, not merely a UI that displays data.

- Source of truth: [declarative schemas](../../supabase/schemas/README.md); edit `supabase/schemas/`, generate/review the migration, and keep dependent types/callers aligned.
- Bootstrap and access setup: [Supabase setup](../DEPLOYMENT.md#supabase-setup). `supabase/restructured/` is not the future source of truth designated by the schema README; do not follow the archived handover's conflicting update instruction.
- Current role/data semantics: [Security](../WEBSITE_STRUCTURE.md#security), [Data Model](../WEBSITE_STRUCTURE.md#data-model).
- Edges: `affects` → relevant [system node](SYSTEM_MAP.md); `configured by` → SETUP-ENVIRONMENT; `verified by` → SETUP-VERIFY; `released by` → SETUP-RELEASE.

## SETUP-INTEGRATIONS

Use for Power Automate configuration, external payloads or delivery failures.

- [Rejection-letter contract](../REJECTION_LETTER_POWER_AUTOMATE_CONTRACT.md): current behavior sends approved content despite historical draft naming. Do not reuse archived draft-only guidance.
- [Teams contract](../TEAMS_INTERVIEW_POWER_AUTOMATE_CONTRACT.md): create/reschedule/cancel meeting contract and configuration.
- Edges: `implements` → [SYS-INTEGRATIONS](system/integrations.md); `configured by` → SETUP-ENVIRONMENT; `verified by` → SETUP-VERIFY.

## SETUP-VERIFY

Choose evidence appropriate to the change. The system node lists existing check/search leads; inspect actual tests/configuration before running them. Do not assume all tests are isolated from external services.

Use [verification environments and exact checks](../workflows/TEST_ENVIRONMENTS.md) for known mock boundaries, named browser scenarios and local documentation-check commands. This is the canonical test-routing reference; maps link to it rather than inventing coverage labels.

| Change | Relevant evidence |
| --- | --- |
| Documentation or skill | Frontmatter, resolvable links, valid owner symbols and graph routing |
| Component/interaction | Typecheck where appropriate, affected UI checks, rendered phone/desktop and keyboard states |
| Shared theme/control | Caller inspection plus affected routes, language/site variants and Login fallback when relevant |
| Schema/RPC | Focused role/data tests and reviewed migration in intended test environment |
| Product release | [Deployment verification](../DEPLOYMENT.md#3-run-verification), including typecheck/build and affected flow |

Edges: `checks` → changed [system node](SYSTEM_MAP.md); `gates` → SETUP-RELEASE. Failure loops back to the owner rather than restarting all documentation reading.

## SETUP-RELEASE

Use when a push/deploy is part of the authorized task.

- Follow [develop workflow](../DEPLOYMENT.md#how-to-push-product-changes-to-develop-without-error), review the scoped diff, and preserve unrelated work.
- [Environment](#setup-environment) identifies service/branch mapping; existing deployment guidance retains its company-approval boundary for real HR data.
- Edges: `depends on` → SETUP-VERIFY / SETUP-ENVIRONMENT; `includes when changed` → SETUP-DATABASE / SETUP-INTEGRATIONS.

## Navigation examples

Local CSS missing → SETUP-LOCAL → process/asset evidence → SYS-PLATFORM if code is involved. Schema change → SETUP-DATABASE → affected system owner → focused verification. Deploy → SETUP-RELEASE → relevant environment and verification nodes. These paths are task-specific; there is no mandatory all-node tour.

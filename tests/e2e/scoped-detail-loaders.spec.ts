import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadScopedRequisitionDetail } from "@/lib/requisition-detail-loader";
import { loadScopedGroupWorkspace } from "@/lib/group-workspace-loader";
import { readCompleteScopedPages, readScopedActivityPage, ScopedReadError, verifyScopedIdentity } from "@/lib/scoped-detail-read";
import { clearDashboardSummaryCache, loadHomeQualityPage } from "@/lib/dashboard-summary-client";
import { clearScopedDetailCache, loadCachedScopedDetail } from "@/lib/scoped-detail-cache";
import { loadAuthorizedRecruiterOptions } from "@/lib/recruiter-options-client";

type Row = Record<string, unknown>;
type Fixture = { tables: Record<string, Row[]>; groups: Record<string, string[]>; calls: Array<{ table?: string; rpc?: string; filters: Record<string, unknown> }> };

function mockClient(fixture: Fixture, profileId = "profile-1"): SupabaseClient & { __authState: { profileId: string } } {
  const authState = { profileId };
  const client = {
    __authState: authState,
    auth: { getSession: async () => ({ data: { session: { user: { id: authState.profileId } } }, error: null }) },
    from(table: string) {
      const state: { filters: Array<(row: Row) => boolean>; order: Array<{ key: string; ascending: boolean }>; start: number; end: number; head: boolean; count: boolean; operators: Record<string, unknown> } = { filters: [], order: [], start: 0, end: 999_999, head: false, count: false, operators: {} };
      const query: any = {
        select(_columns: string, options?: { count?: string; head?: boolean }) { state.count = options?.count === "exact"; state.head = options?.head ?? false; return query; },
        eq(key: string, value: unknown) { state.filters.push(row => row[key] === value); state.operators[key] = value; return query; },
        in(key: string, values: unknown[]) { const allowed = new Set(values); state.filters.push(row => allowed.has(row[key])); state.operators[key] = values; return query; },
        is(key: string, value: unknown) { state.filters.push(row => row[key] === value); return query; },
        not(key: string, operator: string, value: unknown) { if (operator === "is" && value === null) state.filters.push(row => row[key] !== null && row[key] !== undefined); return query; },
        neq(key: string, value: unknown) { state.filters.push(row => row[key] !== value); return query; },
        or(expression: string) {
          if (expression.startsWith("start_confirmation.")) state.filters.push(row => row.start_confirmation === null || row.start_confirmation !== "did_not_start");
          else if (expression.startsWith("changed_at.lt.")) {
            const match = /^changed_at\.lt\.([^,]+),and\(changed_at\.eq\.([^,]+),log_id\.lt\.(\d+)\)$/.exec(expression);
            if (match) state.filters.push(row => String(row.changed_at) < match[1] || String(row.changed_at) === match[2] && Number(row.log_id) < Number(match[3]));
          }
          return query;
        },
        order(key: string, options?: { ascending?: boolean }) { state.order.push({ key, ascending: options?.ascending ?? true }); return query; },
        range(start: number, end: number) { state.start = start; state.end = end; return query; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          try {
            fixture.calls.push({ table, filters: state.operators });
            let rows = (fixture.tables[table] ?? []).filter(row => state.filters.every(filter => filter(row)));
            for (const order of [...state.order].reverse()) rows = [...rows].sort((a, b) => String(a[order.key] ?? "").localeCompare(String(b[order.key] ?? "")) * (order.ascending ? 1 : -1));
            const count = state.count ? rows.length : null;
            const data = state.head ? null : rows.slice(state.start, state.end + 1);
            return Promise.resolve({ data, error: null, count }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        }
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      fixture.calls.push({ rpc: name, filters: args });
      if (name === "app_recruitment_groups_page_v1") {
        const groupId = String((args.p_filters as Row).exactGroupId);
        const docIds = fixture.groups[groupId];
        return { data: { items: docIds ? [{ group_id: groupId, group_position: `Position ${groupId}`, doc_ids: docIds, open_headcount: 2, candidate_count: 1, active_candidate_count: 1, demand_count: 3, filled_count: 1 }] : [] }, error: null };
      }
      if (name === "app_pipeline_summary_v1") return { data: { active: 1, aging: 0, failed: 1, passed_offer: 0, no_activity: 2, by_stage: [{ stage: "Phone Screen", count: 1 }] }, error: null };
      return { data: null, error: { message: `Unexpected RPC ${name}` } };
    }
  };
  return client as unknown as SupabaseClient & { __authState: { profileId: string } };
}

function requisition(docId: string): Row { return { doc_id: docId, head_count: 4, position: "Operator", site: "KT1", department: "Production", section: null, level: "L2", person_in_charge: "Recruiter", line_manager: null, request_type: "New", replacement_names: null, status: "ongoing", pr_approved_date: "2026-10-01", is_priority: false, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }; }
function offer(id: number, accepted = true): Row { return { offer_id: id, application_id: `app-${id}`, candidate_id: `CAN-${id}`, doc_id: "REQ-1", accepted_date: accepted ? "2026-10-12" : null, first_working_date: null, start_confirmation: null, start_confirmed_at: null, start_confirmed_by: null, start_confirmation_reason: null, remark: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }; }
function baseFixture(): Fixture {
  return { tables: {
    requisitions: [requisition("REQ-1"), requisition("REQ-10")],
    document_groups: [{ doc_group_id: "DG-1", doc_id: "REQ-1", group_id: "GRP-1", group_position: "Operator", channel_fb: true, channel_jobthai: false, channel_jobtopgun: false, channel_jobdb: false, channel_jobbkk: false, channel_linkedin: false, channel_walkin: false, channel_referral: false, channel_others: false, created_at: "", updated_at: "" }, { doc_group_id: "DG-10", doc_id: "REQ-10", group_id: "GRP-2", group_position: "Other", channel_fb: false, channel_jobthai: false, channel_jobtopgun: false, channel_jobdb: false, channel_jobbkk: false, channel_linkedin: false, channel_walkin: false, channel_referral: false, channel_others: false, created_at: "", updated_at: "" }],
    position_groups: ["GRP-1", "GRP-2"].map(id => ({ group_id: id, group_position: `Position ${id}`, channel_fb: true, channel_jobthai: false, channel_jobtopgun: false, channel_jobdb: false, channel_jobbkk: false, channel_linkedin: false, channel_walkin: false, channel_referral: false, channel_others: false, created_at: "", updated_at: "" })),
    offers: [offer(1), offer(2, false)],
    requisition_logs: [{ log_id: 1, doc_id: "REQ-1", log_date: "2026-10-01", status: "ongoing", remark: null, created_at: "" }],
    candidate_applications: [{ application_id: "journey-a", candidate_id: "CAN-PARALLEL", group_id: "GRP-1", state: "active" }, { application_id: "journey-b", candidate_id: "CAN-PARALLEL", group_id: "GRP-1", state: "closed" }],
    sourcing_weekly_updates: [{ group_id: "GRP-1", week_start: "2026-10-31", updated_at: "2026-11-01T00:00:00Z", applicants_fb: 7 }],
    change_logs: [{ log_id: 1, entity: "requisitions", entity_id: "REQ-1", action: "update", changed_at: "2026-11-01T00:00:00Z", changed_by: null, changed_by_email: null, old_data: null, new_data: null }, { log_id: 2, entity: "requisitions", entity_id: "REQ-10", action: "update", changed_at: "2026-11-01T00:00:01Z", changed_by: null, changed_by_email: null, old_data: null, new_data: null }],
  }, groups: { "GRP-1": ["REQ-1"], "GRP-2": ["REQ-10"] }, calls: [] };
}

const accessScope = { profileId: "profile-1", key: "project-a:profile-1:admin_recruiter:v1" };

test("requisition loader starts from an empty bootstrap and resolves exact raw IDs, not prefixes", async () => {
  const fixture = baseFixture();
  const result = await loadScopedRequisitionDetail(mockClient(fixture), { docId: "REQ-1", accessScope });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.requisition.doc_id).toBe("REQ-1");
  expect(result.documentGroups.map(row => row.doc_id)).toEqual(["REQ-1"]);
  expect(result.metrics).toMatchObject({ candidateCount: 1, acceptedOfferCount: 1, pendingOfferCount: 1, openHeadcount: 3 });
  for (const table of ["requisitions", "document_groups", "offers", "requisition_logs"]) expect(fixture.calls.filter(call => call.table === table).every(call => call.filters.doc_id === "REQ-1")).toBe(true);
  expect(result.activity.items.map(row => row.entity_id)).toEqual(["REQ-1"]);
  expect(fixture.calls.filter(call => call.table === "change_logs").every(call => call.filters.entity_id === "REQ-1")).toBe(true);
  expect(fixture.calls.some(call => call.table === "candidates")).toBe(false);
});

test("scoped detail warm cache is client and access-scope isolated and can be invalidated", async () => {
  const fixture = baseFixture();
  const client = mockClient(fixture);
  const first = await loadScopedRequisitionDetail(client, { docId: "REQ-1", accessScope });
  const callCount = fixture.calls.length;
  const warm = await loadScopedRequisitionDetail(client, { docId: "REQ-1", accessScope });
  expect(warm).toEqual(first);
  expect(fixture.calls).toHaveLength(callCount);
  await loadScopedRequisitionDetail(mockClient(fixture, "profile-2"), { docId: "REQ-1", accessScope: { profileId: "profile-2", key: "project-a:profile-2:admin_recruiter:v1" } });
  expect(fixture.calls.length).toBeGreaterThan(callCount);
  clearScopedDetailCache(client);
  const afterInvalidate = fixture.calls.length;
  await loadScopedRequisitionDetail(client, { docId: "REQ-1", accessScope });
  expect(fixture.calls.length).toBeGreaterThan(afterInvalidate);
});

test("recruiter options are read through profile RLS and reject a stale profile identity", async () => {
  const fixture = baseFixture();
  fixture.tables.profiles = [
    { id: "profile-1", email: "one@example.test", full_name: "One", nickname: "One", site: "KT1", role: "admin_recruiter", created_at: "", updated_at: "" },
    { id: "profile-2", email: "two@example.test", full_name: "Two", nickname: "Two", site: "KT2", role: "admin_recruiter", created_at: "", updated_at: "" },
  ];
  const result = await loadAuthorizedRecruiterOptions(mockClient(fixture), accessScope);
  expect(result.map(profile => profile.id)).toEqual(["profile-1", "profile-2"]);
  expect(fixture.calls.filter(call => call.table === "profiles").every(call => call.filters.id === undefined)).toBe(true);
  const sameClient = mockClient(fixture);
  await loadAuthorizedRecruiterOptions(sameClient, accessScope);
  const warmCount = fixture.calls.length;
  sameClient.__authState.profileId = "other";
  await expect(loadAuthorizedRecruiterOptions(sameClient, accessScope)).rejects.toThrow();
  expect(fixture.calls).toHaveLength(warmCount);
  await expect(loadAuthorizedRecruiterOptions(mockClient(fixture), { profileId: "other", key: "other" })).rejects.toThrow();
  expect(fixture.calls).toHaveLength(warmCount);
});

test("late unavailable detail result cannot evict a newer same-key cache entry", async () => {
  const client = mockClient(baseFixture());
  let resolveOld!: (value: { status: string }) => void;
  let freshLoads = 0;
  let markStarted!: () => void;
  const oldStarted = new Promise<void>(resolve => { markStarted = resolve; });
  const old = loadCachedScopedDetail(client, accessScope, "requisition-detail:test\u001fREQ-1", () => new Promise(resolve => { resolveOld = resolve; markStarted(); }));
  await oldStarted;
  clearScopedDetailCache(client);
  const fresh = loadCachedScopedDetail(client, accessScope, "requisition-detail:test\u001fREQ-1", async () => { freshLoads++; return { status: "ready" }; });
  await expect(fresh).resolves.toEqual({ status: "ready" });
  resolveOld({ status: "unavailable" });
  await old;
  await expect(loadCachedScopedDetail(client, accessScope, "requisition-detail:test\u001fREQ-1", async () => { freshLoads++; return { status: "ready" }; })).resolves.toEqual({ status: "ready" });
  expect(freshLoads).toBe(1);
});

test("a warmed detail cache rechecks the active session before returning profile-scoped data", async () => {
  const fixture = baseFixture(), client = mockClient(fixture);
  expect((await loadScopedRequisitionDetail(client, { docId: "REQ-1", accessScope })).status).toBe("ready");
  const priorReadCount = fixture.calls.length;
  client.__authState.profileId = "profile-2";
  await expect(verifyScopedIdentity(client, accessScope)).rejects.toMatchObject({ reason: "not_found_or_not_authorized" });
  expect(await loadScopedRequisitionDetail(client, { docId: "REQ-1", accessScope })).toEqual({ status: "unavailable", reason: "not_found_or_not_authorized" });
  expect(fixture.calls).toHaveLength(priorReadCount);
});

test("scoped requisition relations page completely beyond 1000 rows and collapse parallel journeys to people", async () => {
  const fixture = baseFixture();
  fixture.tables.offers = Array.from({ length: 1003 }, (_, index) => offer(index + 1, index % 2 === 0));
  fixture.tables.requisition_logs = Array.from({ length: 1001 }, (_, index) => ({ log_id: index + 1, doc_id: "REQ-1", log_date: "2026-10-01", status: "ongoing", remark: null, created_at: "" }));
  fixture.tables.candidate_applications = Array.from({ length: 1003 }, (_, index) => ({ application_id: `journey-${index}`, candidate_id: "CAN-PARALLEL", group_id: "GRP-1", state: "active" }));
  const result = await loadScopedRequisitionDetail(mockClient(fixture), { docId: "REQ-1", accessScope });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.offers).toHaveLength(1003);
  expect(result.history).toHaveLength(1001);
  expect(result.metrics.candidateCount).toBe(1);
  expect(fixture.calls.filter(call => call.table === "offers").length).toBeGreaterThan(5);
});

test("unreadable raw requisition IDs return explicit unavailable", async () => {
  const fixture = baseFixture();
  fixture.tables.requisitions = fixture.tables.requisitions.filter(row => row.doc_id !== "REQ-1");
  const result = await loadScopedRequisitionDetail(mockClient(fixture), { docId: "REQ-1", accessScope });
  expect(result).toEqual({ status: "unavailable", reason: "not_found_or_not_authorized" });
  expect(fixture.calls.some(call => call.table === "document_groups")).toBe(false);
});

test("loader rejects a stale profile identity before reading any rows", async () => {
  const fixture = baseFixture();
  const client = mockClient(fixture);
  const result = await loadScopedRequisitionDetail(client, { docId: "REQ-1", accessScope: { profileId: "profile-2", key: "project-a:profile-2:admin_recruiter:v1" } });
  expect(result).toEqual({ status: "unavailable", reason: "not_found_or_not_authorized" });
  expect(fixture.calls).toHaveLength(0);
});

test("activity uses bounded descending cursor pages with an exact entity key", async () => {
  const fixture = baseFixture();
  fixture.tables.change_logs = Array.from({ length: 30 }, (_, index) => ({ log_id: index + 1, entity: "requisitions", entity_id: "REQ-1", action: "update", changed_at: `2026-11-01T00:00:${String(index).padStart(2, "0")}Z`, changed_by: null, changed_by_email: null, old_data: null, new_data: null }));
  const client = mockClient(fixture);
  const first = await readScopedActivityPage(client, "requisitions", "REQ-1");
  expect(first.items).toHaveLength(25);
  expect(first.totalCount).toBe(30);
  expect(first.hasMore).toBe(true);
  expect(first.nextCursor).not.toBeNull();
  const second = await readScopedActivityPage(client, "requisitions", "REQ-1", first.nextCursor);
  expect(second.items).toHaveLength(5);
  expect(second.totalCount).toBe(30);
  expect(second.hasMore).toBe(false);
  expect(new Set([...first.items, ...second.items].map(row => row.log_id)).size).toBe(30);
  expect(fixture.calls.filter(call => call.table === "change_logs").every(call => call.filters.entity_id === "REQ-1")).toBe(true);
});

test("group loader follows exact group and selected Saturday week without hydrating global people", async () => {
  const fixture = baseFixture();
  const client = mockClient(fixture);
  const first = await loadScopedGroupWorkspace(client, { groupId: "GRP-1", selectedWeek: "2026-10-31", asOf: "2026-11-02", accessScope });
  const second = await loadScopedGroupWorkspace(client, { groupId: "GRP-2", selectedWeek: "2026-11-07", asOf: "2026-11-02", accessScope });
  expect(first.status).toBe("ready");
  expect(second.status).toBe("ready");
  if (first.status !== "ready" || second.status !== "ready") return;
  expect(first.requisitions.map(row => row.doc_id)).toEqual(["REQ-1"]);
  expect(first.offers.map(row => row.doc_id)).toEqual(["REQ-1", "REQ-1"]);
  expect(first.sourcingUpdates.map(row => row.week_start)).toEqual(["2026-10-31"]);
  expect(second.group.group_id).toBe("GRP-2");
  expect(second.selectedWeek).toBe("2026-11-07");
  expect(first.metrics).toMatchObject({ linkedRequisitionCount: 1, candidateCount: 1, openHeadcount: 2, activeJourneyCount: 1, agingJourneyCount: 0, acceptedOfferCount: 1, pendingOfferCount: 1 });
  expect(fixture.calls.some(call => call.table === "candidates")).toBe(false);
  const offerReads = fixture.calls.filter(call => call.table === "offers");
  expect(offerReads.every(call => Array.isArray(call.filters.doc_id) && call.filters.doc_id.every(id => id === "REQ-1" || id === "REQ-10"))).toBe(true);
  expect([...new Set(offerReads.flatMap(call => Array.isArray(call.filters.doc_id) ? call.filters.doc_id : []))].sort()).toEqual(["REQ-1", "REQ-10"]);
  const exactLookups = fixture.calls.filter(call => call.rpc === "app_recruitment_groups_page_v1");
  expect(exactLookups.map(call => [(call.filters.p_filters as Row).exactGroupId, (call.filters.p_filters as Row).weekStart])).toEqual([["GRP-1", "2026-10-31"], ["GRP-2", "2026-11-07"]]);
  const pipelineCalls = fixture.calls.filter(call => call.rpc === "app_pipeline_summary_v1");
  expect(pipelineCalls.map(call => call.filters.p_as_of)).toEqual(["2026-11-02", "2026-11-02"]);
  expect(pipelineCalls.map(call => call.filters.p_group_id)).toEqual(["GRP-1", "GRP-2"]);
});

test("complete scoped page reader rejects duplicate IDs and short pages", async () => {
  await expect(readCompleteScopedPages(async () => ({ data: [{ id: "one" }, { id: "one" }], error: null, count: 2 }), row => String(row.id), "fixture")).rejects.toBeInstanceOf(ScopedReadError);
  await expect(readCompleteScopedPages(async () => ({ data: [{ id: "one" }], error: null, count: 2 }), row => String(row.id), "fixture")).rejects.toBeInstanceOf(ScopedReadError);
});

test("Home quality loader sends exact detail scope keys and keeps combined filters intersected", async () => {
  clearDashboardSummaryCache();
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    supabaseUrl: "https://quality-scope.test",
    auth: { getSession: async () => ({ data: { session: { user: { id: "profile-1" } } }, error: null }) },
    rpc: async (_name: string, args: Record<string, unknown>) => { calls.push(args); return { data: { items: [], totalCount: 0, hasMore: false, nextCursor: null }, error: null }; },
  } as unknown as SupabaseClient;
  const scope = { headerSite: "", headerPic: "", priorityOnly: false };
  await loadHomeQualityPage(client, { scope, groupId: "GRP-1", today: "2026-11-02", profileKey: accessScope.key });
  await loadHomeQualityPage(client, { scope, docId: "REQ-1", today: "2026-11-02", profileKey: accessScope.key });
  await loadHomeQualityPage(client, { scope, groupId: "GRP-10", docId: "REQ-10", today: "2026-11-02", profileKey: accessScope.key });
  expect(calls.map(call => call.p_scope)).toEqual([
    { ...scope, groupId: "GRP-1" },
    { ...scope, docId: "REQ-1" },
    { ...scope, groupId: "GRP-10", docId: "REQ-10" },
  ]);
  expect(calls.every(call => call.p_limit === 25 && call.p_after_id === null)).toBe(true);
});

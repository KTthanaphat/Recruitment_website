import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentGroup, Offer, PositionGroup, Requisition, SourcingWeeklyUpdate } from "@/types/recruitment";
import { loadCachedScopedDetail } from "@/lib/scoped-detail-cache";
import { readCompleteScopedPages, readScopedActivityPage, readScopedInPages, scopedUnavailableReason, verifyScopedIdentity, type ActivityCursor, type ScopedAccessIdentity, type ScopedActivityPage, type ScopedUnavailableReason } from "@/lib/scoped-detail-read";

type GroupScope = { headerSite?: string; headerPic?: string; priorityOnly?: boolean };
type GroupPageSummary = {
  group_id: string;
  group_position: string;
  doc_ids: string[];
  open_headcount: number;
  candidate_count: number;
  active_candidate_count: number;
  demand_count: number;
  filled_count: number;
};
type GroupPipelineSummary = { active: number; aging: number; failed: number; passed_offer: number; no_activity: number; by_stage: Array<{ stage: string; count: number }> };
export type GroupWorkspaceMetrics = {
  linkedRequisitionCount: number;
  candidateCount: number;
  openHeadcount: number;
  demandCount: number;
  filledCount: number;
  activeJourneyCount: number;
  agingJourneyCount: number;
  failedJourneyCount: number;
  passedOfferCount: number;
  noActivityJourneyCount: number;
  acceptedOfferCount: number;
  pendingOfferCount: number;
  byStage: Array<{ stage: string; count: number }>;
};

export type ScopedGroupWorkspace = {
  status: "ready";
  scopeKey: string;
  selectedWeek: string;
  group: PositionGroup;
  documentGroups: DocumentGroup[];
  requisitions: Requisition[];
  offers: Offer[];
  sourcingUpdates: SourcingWeeklyUpdate[];
  metrics: GroupWorkspaceMetrics;
  activity: ScopedActivityPage;
};
export type ScopedGroupWorkspaceResult = ScopedGroupWorkspace | { status: "unavailable"; reason: ScopedUnavailableReason };

/** Resolve an exact authorized group and its current selected-week context without loading people or full history. */
export async function loadScopedGroupWorkspace(
  client: SupabaseClient,
  input: { groupId: string; selectedWeek: string; scope?: GroupScope; accessScope: ScopedAccessIdentity; activityCursor?: ActivityCursor | null; asOf?: string },
): Promise<ScopedGroupWorkspaceResult> {
  if (!input.groupId.trim() || !isSaturday(input.selectedWeek)) return { status: "unavailable", reason: "not_found_or_not_authorized" };
  const asOf = input.asOf ?? bangkokToday();
  const key = `group-workspace:${input.accessScope.key}\u001f${JSON.stringify([input.groupId, input.selectedWeek, input.scope ?? {}, input.activityCursor ?? null, asOf])}`;
  try { return await loadCachedScopedDetail(client, input.accessScope, key, () => loadScopedGroupWorkspaceUncached(client, { ...input, asOf })); }
  catch (error) { return { status: "unavailable", reason: scopedUnavailableReason(error) }; }
}

async function loadScopedGroupWorkspaceUncached(
  client: SupabaseClient,
  input: { groupId: string; selectedWeek: string; scope?: GroupScope; accessScope: ScopedAccessIdentity; activityCursor?: ActivityCursor | null; asOf?: string },
): Promise<ScopedGroupWorkspaceResult> {
  if (!input.groupId.trim() || !isSaturday(input.selectedWeek)) return { status: "unavailable", reason: "not_found_or_not_authorized" };
  try {
    await verifyScopedIdentity(client, input.accessScope);
    const scope = { headerSite: input.scope?.headerSite ?? "", headerPic: input.scope?.headerPic ?? "", priorityOnly: input.scope?.priorityOnly ?? false };
    const { data: groupPageData, error: groupPageError } = await client.rpc("app_recruitment_groups_page_v1", {
      p_search: "", p_filters: { scope: "all", exactGroupId: input.groupId, weekStart: input.selectedWeek, ...scope },
      p_sort: "name", p_direction: "asc", p_limit: 25, p_cursor_value: null, p_cursor_id: null, p_before: false, p_count_only: false,
    });
    if (groupPageError) throw new Error(groupPageError.message || "Could not verify group access.");
    const groupEnvelope = groupPageData as { items?: GroupPageSummary[] } | null;
    if (!groupEnvelope || !Array.isArray(groupEnvelope.items) || groupEnvelope.items.length > 1) throw new Error("Group lookup returned an invalid response.");
    const projected = groupEnvelope.items[0];
    if (!projected || projected.group_id !== input.groupId || !Array.isArray(projected.doc_ids)) return { status: "unavailable", reason: "not_found_or_not_authorized" };
    for (const field of [projected.open_headcount, projected.candidate_count, projected.active_candidate_count, projected.demand_count, projected.filled_count]) {
      if (!Number.isInteger(field) || field < 0) throw new Error("Group lookup returned incomplete projected metrics.");
    }
    const docIds = [...new Set(projected.doc_ids)].filter(value => typeof value === "string" && value.length > 0).sort();
    const [groupRows, documentGroups, requisitions, offers, sourcingUpdates, activity, pipeline, acceptedOfferCount, pendingOfferCount] = await Promise.all([
      readCompleteScopedPages<PositionGroup>(
        (from, to) => client.from("position_groups").select("*", { count: "exact" }).eq("group_id", input.groupId).order("group_id", { ascending: true }).range(from, to),
        row => row.group_id,
        "selected position group",
      ),
      readGroupDocumentLinks(client, input.groupId, docIds),
      readScopedInPages<Requisition>(client, "requisitions", "doc_id", docIds, "doc_id", "selected group requisitions", "*"),
      readScopedInPages<Offer>(client, "offers", "doc_id", docIds, "offer_id", "selected group requisition offers", "*"),
      readCompleteScopedPages<SourcingWeeklyUpdate>(
        (from, to) => client.from("sourcing_weekly_updates").select("*", { count: "exact" }).eq("group_id", input.groupId).in("week_start", [input.selectedWeek, addDays(input.selectedWeek, 2)]).order("week_start", { ascending: true }).range(from, to),
        row => `${row.group_id}\u001f${row.week_start}`,
        "selected week sourcing update",
      ),
      readScopedActivityPage(client, "position_groups", input.groupId, input.activityCursor),
      loadGroupPipelineSummary(client, input.groupId, input.asOf ?? bangkokToday(), scope),
      countOffers(client, docIds, "accepted"),
      countOffers(client, docIds, "pending"),
    ]);
    if (groupRows.length !== 1 || groupRows[0].group_id !== input.groupId) return { status: "unavailable", reason: "not_found_or_not_authorized" };
    if (documentGroups.some(row => row.group_id !== input.groupId || !docIds.includes(row.doc_id))) throw new Error("Group links exceeded the authorized requisition projection.");
    const authorizedDocIds = new Set(requisitions.map(row => row.doc_id));
    const visibleDocumentGroups = documentGroups.filter(row => authorizedDocIds.has(row.doc_id));
    const visibleReqs = requisitions.filter(row => projected.doc_ids.includes(row.doc_id));
    return {
      status: "ready", scopeKey: input.accessScope.key, selectedWeek: input.selectedWeek,
      group: groupRows[0], documentGroups: visibleDocumentGroups, requisitions: visibleReqs, offers: offers.filter(row => projected.doc_ids.includes(row.doc_id)), sourcingUpdates,
      metrics: {
        linkedRequisitionCount: new Set(visibleDocumentGroups.map(row => row.doc_id)).size,
        candidateCount: projected.candidate_count,
        openHeadcount: projected.open_headcount,
        demandCount: projected.demand_count,
        filledCount: projected.filled_count,
        activeJourneyCount: pipeline.active,
        agingJourneyCount: pipeline.aging,
        failedJourneyCount: pipeline.failed,
        passedOfferCount: pipeline.passed_offer,
        noActivityJourneyCount: pipeline.no_activity,
        acceptedOfferCount,
        pendingOfferCount,
        byStage: pipeline.by_stage,
      },
      activity,
    };
  } catch (error) {
    return { status: "unavailable", reason: scopedUnavailableReason(error) };
  }
}

export async function loadGroupActivityPage(client: SupabaseClient, input: { groupId: string; selectedWeek: string; scope?: GroupScope; accessScope: ScopedAccessIdentity; cursor?: ActivityCursor | null }): Promise<ScopedActivityPage> {
  await verifyScopedIdentity(client, input.accessScope);
  if (!input.groupId.trim() || !isSaturday(input.selectedWeek)) throw new Error("The requested group is unavailable.");
  const { data, error } = await client.rpc("app_recruitment_groups_page_v1", {
    p_search: "", p_filters: { scope: "all", exactGroupId: input.groupId, weekStart: input.selectedWeek, headerSite: input.scope?.headerSite ?? "", headerPic: input.scope?.headerPic ?? "", priorityOnly: input.scope?.priorityOnly ?? false },
    p_sort: "name", p_direction: "asc", p_limit: 25, p_cursor_value: null, p_cursor_id: null, p_before: false, p_count_only: false,
  });
  if (error) throw new Error(error.message || "Could not verify group access.");
  const envelope = data as { items?: Array<{ group_id?: unknown }> } | null;
  if (!Array.isArray(envelope?.items) || envelope.items.length !== 1 || envelope.items[0].group_id !== input.groupId) throw new Error("The requested group is unavailable.");
  return readScopedActivityPage(client, "position_groups", input.groupId, input.cursor);
}

async function loadGroupPipelineSummary(client: SupabaseClient, groupId: string, asOf: string, scope: GroupScope): Promise<GroupPipelineSummary> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) throw new Error("Pipeline summary date is invalid.");
  const { data, error } = await client.rpc("app_pipeline_summary_v1", { p_scope: scope, p_group_id: groupId, p_as_of: asOf, p_recent_days: 7 });
  if (error) throw new Error(error.message || "Could not read group pipeline metrics.");
  const result = data as Partial<GroupPipelineSummary> | null;
  const count = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
  if (!result || !count(result.active) || !count(result.aging) || !count(result.failed) || !count(result.passed_offer) || !count(result.no_activity) || !Array.isArray(result.by_stage) || result.by_stage.some(row => !row || typeof row.stage !== "string" || !count(row.count))) throw new Error("Group pipeline metrics were incomplete.");
  return result as GroupPipelineSummary;
}

async function countOffers(client: SupabaseClient, docIds: readonly string[], kind: "accepted" | "pending") {
  let total = 0;
  for (let start = 0; start < docIds.length; start += 200) {
    let query = client.from("offers").select("offer_id", { count: "exact", head: true }).in("doc_id", docIds.slice(start, start + 200));
    query = kind === "pending" ? query.is("accepted_date", null) : query.not("accepted_date", "is", null).or("start_confirmation.is.null,start_confirmation.neq.did_not_start");
    const result = await query;
    if (result.error) throw new Error(result.error.message || `Could not read ${kind} offer count.`);
    if (!Number.isInteger(result.count) || Number(result.count) < 0) throw new Error(`Could not verify ${kind} offer count.`);
    total += Number(result.count);
  }
  return total;
}

function isSaturday(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).getUTCDay() === 6; }
function addDays(value: string, amount: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function bangkokToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
async function readGroupDocumentLinks(client: SupabaseClient, groupId: string, docIds: readonly string[]) {
  const output: DocumentGroup[] = [], seen = new Set<string>();
  for (let start = 0; start < docIds.length; start += 200) {
    const rows = await readCompleteScopedPages<DocumentGroup>(
      (from, to) => client.from("document_groups").select("*", { count: "exact" }).eq("group_id", groupId).in("doc_id", docIds.slice(start, start + 200)).order("doc_group_id", { ascending: true }).range(from, to),
      row => row.doc_group_id,
      "selected group requisition links",
    );
    for (const row of rows) {
      if (row.group_id !== groupId || seen.has(row.doc_group_id)) throw new Error("Group link identity validation failed.");
      seen.add(row.doc_group_id); output.push(row);
    }
  }
  return output;
}

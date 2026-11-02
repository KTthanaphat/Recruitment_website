import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateApplication, DocumentGroup, Offer, PositionGroup, Requisition, RequisitionLog } from "@/types/recruitment";
import { countsTowardHeadcount } from "@/lib/offer-headcount";
import { loadCachedScopedDetail } from "@/lib/scoped-detail-cache";
import { readCompleteScopedPages, readScopedActivityPage, readScopedInPages, scopedUnavailableReason, verifyScopedIdentity, type ActivityCursor, type ScopedAccessIdentity, type ScopedActivityPage, type ScopedUnavailableReason } from "@/lib/scoped-detail-read";

export type RequisitionDetailMetrics = {
  candidateCount: number;
  acceptedOfferCount: number;
  pendingOfferCount: number;
  openHeadcount: number;
  slaRestartDate: string | null;
};

export type ScopedRequisitionDetail = {
  status: "ready";
  scopeKey: string;
  requisition: Requisition;
  documentGroups: DocumentGroup[];
  groups: PositionGroup[];
  offers: Offer[];
  history: RequisitionLog[];
  metrics: RequisitionDetailMetrics;
  activity: ScopedActivityPage;
};
export type ScopedRequisitionDetailResult = ScopedRequisitionDetail | { status: "unavailable"; reason: ScopedUnavailableReason };

/** Resolve exactly one authorized requisition, then read only its linked group, offer, and history records. */
export async function loadScopedRequisitionDetail(
  client: SupabaseClient,
  input: { docId: string; accessScope: ScopedAccessIdentity; activityCursor?: ActivityCursor | null },
): Promise<ScopedRequisitionDetailResult> {
  if (!input.docId.trim()) return { status: "unavailable", reason: "not_found_or_not_authorized" };
  const key = `requisition-detail:${input.accessScope.key}\u001f${JSON.stringify([input.docId, input.activityCursor ?? null])}`;
  try { return await loadCachedScopedDetail(client, input.accessScope, key, () => loadScopedRequisitionDetailUncached(client, input)); }
  catch (error) { return { status: "unavailable", reason: scopedUnavailableReason(error) }; }
}

async function loadScopedRequisitionDetailUncached(
  client: SupabaseClient,
  input: { docId: string; accessScope: ScopedAccessIdentity; activityCursor?: ActivityCursor | null },
): Promise<ScopedRequisitionDetailResult> {
  if (!input.docId.trim()) return { status: "unavailable", reason: "not_found_or_not_authorized" };
  try {
    await verifyScopedIdentity(client, input.accessScope);
    const reqRows = await readCompleteScopedPages<Requisition>(
      (from, to) => client.from("requisitions").select("*", { count: "exact" }).eq("doc_id", input.docId).order("doc_id", { ascending: true }).range(from, to),
      row => row.doc_id,
      "selected requisition",
    );
    if (reqRows.length !== 1 || reqRows[0].doc_id !== input.docId) return { status: "unavailable", reason: "not_found_or_not_authorized" };
    const requisition = reqRows[0];
    const [documentGroups, offers, history, activity] = await Promise.all([
      readCompleteScopedPages<DocumentGroup>(
        (from, to) => client.from("document_groups").select("*", { count: "exact" }).eq("doc_id", input.docId).order("doc_group_id", { ascending: true }).range(from, to),
        row => row.doc_group_id,
        "requisition group links",
      ),
      readCompleteScopedPages<Offer>(
        (from, to) => client.from("offers").select("*", { count: "exact" }).eq("doc_id", input.docId).order("offer_id", { ascending: true }).range(from, to),
        row => String(row.offer_id),
        "requisition offers",
      ),
      readCompleteScopedPages<RequisitionLog>(
        (from, to) => client.from("requisition_logs").select("*", { count: "exact" }).eq("doc_id", input.docId).order("log_id", { ascending: true }).range(from, to),
        row => String(row.log_id),
        "requisition history",
      ),
      readScopedActivityPage(client, "requisitions", input.docId, input.activityCursor),
    ]);
    const groupIds = [...new Set(documentGroups.map(row => row.group_id).filter((value): value is string => Boolean(value)))];
    const groups = await readScopedInPages<PositionGroup>(client, "position_groups", "group_id", groupIds, "group_id", "linked position groups");
    const applications = groupIds.length ? await readScopedInPages<Pick<CandidateApplication, "application_id" | "candidate_id" | "group_id">>(
      client, "candidate_applications", "group_id", groupIds, "application_id", "related application identity projection", "application_id,candidate_id,group_id",
    ) : [];
    const candidateCount = new Set(applications.map(row => row.candidate_id)).size;
    const acceptedOfferCount = offers.filter(countsTowardHeadcount).length;
    const restartDates = offers.filter(row => row.start_confirmation === "did_not_start" && row.start_confirmed_at).map(row => row.start_confirmed_at!.slice(0, 10)).sort();
    return {
      status: "ready", scopeKey: input.accessScope.key, requisition, documentGroups, groups, offers, history,
      metrics: { candidateCount, acceptedOfferCount, pendingOfferCount: offers.filter(row => row.accepted_date === null).length, openHeadcount: Math.max(requisition.head_count - acceptedOfferCount, 0), slaRestartDate: restartDates.at(-1) ?? null },
      activity,
    };
  } catch (error) {
    return { status: "unavailable", reason: scopedUnavailableReason(error) };
  }
}

/** Load the next bounded activity page independently from the requisition context payload. */
export async function loadRequisitionActivityPage(client: SupabaseClient, input: { docId: string; accessScope: ScopedAccessIdentity; cursor?: ActivityCursor | null }): Promise<ScopedActivityPage> {
  await verifyScopedIdentity(client, input.accessScope);
  const req = await client.from("requisitions").select("doc_id", { count: "exact" }).eq("doc_id", input.docId).range(0, 0);
  if (req.error) throw new Error(req.error.message || "Could not verify requisition access.");
  if (req.count !== 1 || req.data?.[0]?.doc_id !== input.docId) throw new Error("The requested requisition is unavailable.");
  try { return await readScopedActivityPage(client, "requisitions", input.docId, input.cursor); }
  catch (error) { throw new Error(error instanceof Error ? error.message : "Could not read requisition activity."); }
}

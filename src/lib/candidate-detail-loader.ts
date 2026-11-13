import { scheduleRecruitmentRead } from "./recruitment-read-scheduler";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplicationAssignment, Candidate, CandidateApplication, CandidateNote, CandidateReference, CandidateReferenceCheck, CandidateProfileCapabilities, DashboardData, MaskedCandidateSummary, RecruitmentLog, RejectionLetterDraft, Requisition, RequisitionLog } from "@/types/recruitment";
import { fetchRecruitmentList, fetchRecruitmentListCount, type RecruitmentListPage } from "@/lib/recruitment-list";
import { loadCachedScopedDetail } from "@/lib/scoped-detail-cache";
import type { ScopedAccessIdentity } from "@/lib/scoped-detail-read";

type DetailProjection = { candidate: Omit<Candidate, "application_id" | "application_state" | "doc_group_id" | "group_id"> | null; masked: MaskedCandidateSummary | null; capabilities: CandidateProfileCapabilities | null };
type QueryRows<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };
type ScopedClient = Pick<SupabaseClient, "rpc"> & { from: (table: string) => any };

async function readComplete<T>(client: object, makePage: (from: number, to: number) => PromiseLike<QueryRows<T>>, rowId: (row: T) => string, label: string, signal?: AbortSignal): Promise<T[]> {
  const size = 200, output: T[] = [], seen = new Set<string>();
  let expected: number | null = null;
  for (let offset = 0; ; offset += size) {
    const result = await scheduleRecruitmentRead(client, () => { const request = makePage(offset, offset + size - 1) as PromiseLike<QueryRows<T>> & { abortSignal?: (signal: AbortSignal) => PromiseLike<QueryRows<T>> }; return signal && request.abortSignal ? request.abortSignal(signal) : request; }, -1, {signal});
    if (result.error) throw new Error(result.error.message || `Could not load ${label}.`);
    if (typeof result.count !== "number" || !Number.isInteger(result.count) || result.count < 0) throw new Error(`Could not verify complete ${label}.`);
    if (expected !== null && expected !== result.count) throw new Error(`${label} changed while loading. Please retry.`);
    expected = result.count;
    const page = result.data ?? [];
    for (const item of page) {
      const id = rowId(item);
      if (!id || seen.has(id)) throw new Error(`Duplicate or invalid ${label} page. Please retry.`);
      seen.add(id); output.push(item);
    }
    if (output.length === expected) return output;
    if (page.length !== size || output.length > expected) throw new Error(`Incomplete ${label} received. Please retry.`);
  }
}

async function readScoped<T>(client: ScopedClient, table: string, column: string, value: string, order: keyof T & string, label: string, signal?: AbortSignal): Promise<T[]> {
  return readComplete<T>(client,
    (from, to) => client.from(table).select("*", { count: "exact" }).eq(column, value).order(order, { ascending: true }).range(from, to),
    row => String((row as Record<string, unknown>)[order] ?? ""),
    label, signal
  );
}

async function readInChunks<T>(values: readonly string[], loadChunk: (chunk: string[]) => Promise<T[]>, rowId: (row: T) => string, label: string): Promise<T[]> {
  const keys = [...new Set(values)].filter(Boolean).sort();
  const rows: T[] = [], seen = new Set<string>();
  for (let start = 0; start < keys.length; start += 200) {
    for (const row of await loadChunk(keys.slice(start, start + 200))) {
      const id = rowId(row);
      if (!id || seen.has(id)) throw new Error(`Duplicate or invalid ${label} across scoped lookup pages.`);
      seen.add(id); rows.push(row);
    }
  }
  return rows;
}

async function readList<T>(client: SupabaseClient, accessScope: string, filters: Record<string, unknown>, label: string, signal?: AbortSignal): Promise<T[]> {
  const output: T[] = [], seen = new Set<string>();
  const [total, firstPage] = await Promise.all([
    fetchRecruitmentListCount(client, { accessScope, entity: "pipeline_history", filters, priority: -1, signal }),
    fetchRecruitmentList<T>(client, { accessScope, entity: "pipeline_history", filters, signal, sort: "log_id", direction: "asc", limit: 100, cursor: null })
  ]);
  let cursor: { value: unknown; id: string } | null = null;
  const anchors = new Set<string>();
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page: RecruitmentListPage<T> = pageNumber === 0 ? firstPage : await fetchRecruitmentList<T>(client, { accessScope, entity: "pipeline_history", filters, signal, sort: "log_id", direction: "asc", limit: 100, cursor });
    if (page.total_count !== null && total !== page.total_count) throw new Error(`${label} changed while loading. Please retry.`);
    for (const item of page.items) {
      const id = String((item as { log?: { log_id?: unknown } }).log?.log_id ?? "");
      if (!id || seen.has(id)) throw new Error(`Duplicate ${label} row. Please retry.`);
      seen.add(id); output.push(item);
    }
    if (output.length === total) return output;
    if (!page.has_more || !page.next_cursor || page.items.length === 0) throw new Error(`Incomplete ${label} received. Please retry.`);
    const anchor = JSON.stringify(page.next_cursor);
    if (anchors.has(anchor)) throw new Error(`Stuck ${label} cursor. Please retry.`);
    anchors.add(anchor); cursor = page.next_cursor;
  }
  throw new Error(`Too many ${label} pages. Please retry.`);
}

/** Resolves profile privacy first, then hydrates application headers and only the selected journey. All reads remain subject to RLS. */
export function loadCandidateDetail(client: SupabaseClient, accessScope: ScopedAccessIdentity, candidateId: string, applicationId: string | null, base: DashboardData, signal?: AbortSignal): Promise<DashboardData> {
  const key = JSON.stringify(["candidate", candidateId, applicationId]);
  return loadCachedScopedDetail(client, accessScope, key, requestSignal => loadCandidateDetailUncached(client, accessScope, candidateId, applicationId, base, requestSignal), signal);
}

type CandidateShell = { projection: DetailProjection; visibleApps: CandidateApplication[]; visibleGroups: DashboardData["position_groups"] };
function getCandidateShell(client: SupabaseClient, identity: ScopedAccessIdentity, candidateId: string, signal?: AbortSignal): Promise<CandidateShell> {
  return loadCachedScopedDetail(client, identity, JSON.stringify(["candidate-shell", candidateId]), requestSignal => loadCandidateShellUncached(client, identity.key, candidateId, requestSignal), signal);
}
async function loadCandidateShellUncached(client: SupabaseClient, accessScope: string, candidateId: string, signal?: AbortSignal): Promise<CandidateShell> {
  const { data: projected, error: projectionError } = await scheduleRecruitmentRead(client, () => client.rpc("app_candidate_profile_detail_v1", { p_candidate_id: candidateId }).abortSignal(signal ?? new AbortController().signal), -1, {signal});
  if (projectionError) throw new Error(projectionError.message);
  const projection = projected as DetailProjection | null;
  if (!projection || (!projection.candidate && !projection.masked)) throw new Error("This candidate is unavailable or access has changed.");
  if (!projection.candidate) return { projection, visibleApps: [], visibleGroups: [] };
  const appRows: Record<string, unknown>[] = [], appIds = new Set<string>(), anchors = new Set<string>();
  let cursor: { value: unknown; id: string } | null = null;
  const [expectedApps, firstPage] = await Promise.all([
    fetchRecruitmentListCount(client, { accessScope, entity: "candidate_applications", filters: { candidateId }, priority: -1, signal }),
    fetchRecruitmentList<Record<string, unknown>>(client, { accessScope, entity: "candidate_applications", filters: { candidateId }, limit: 100, cursor: null, signal })
  ]);
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page: RecruitmentListPage<Record<string, unknown>> = pageNumber === 0 ? firstPage : await fetchRecruitmentList<Record<string, unknown>>(client, { accessScope, entity: "candidate_applications", filters: { candidateId }, limit: 100, cursor, signal });
    if (page.total_count !== null && expectedApps !== page.total_count) throw new Error("Candidate applications changed while loading. Please retry.");
    for (const row of page.items) {
      const id = String(row.application_id ?? "");
      if (!id || appIds.has(id)) throw new Error("Duplicate candidate application. Please retry.");
      appIds.add(id); appRows.push(row);
    }
    if (appRows.length === expectedApps) break;
    if (!page.has_more || !page.next_cursor || !page.items.length) throw new Error("Incomplete candidate applications received. Please retry.");
    const anchor = JSON.stringify(page.next_cursor);
    if (anchors.has(anchor)) throw new Error("Candidate application cursor repeated. Please retry.");
    anchors.add(anchor); cursor = page.next_cursor;
    if (pageNumber === 999) throw new Error("Too many candidate applications to open safely.");
  }

  const visibleApps = appRows.map(row => ({
    application_id: String(row.application_id),
    candidate_id: candidateId,
    group_id: String(row.group_id ?? ""),
    state: (row.application_state ?? row.state) === "closed" ? "closed" as const : "active" as const,
    closure_reason: typeof row.closure_reason === "string" ? row.closure_reason : null,
    closed_at: typeof row.closed_at === "string" ? row.closed_at : null,
    created_by: typeof row.created_by === "string" ? row.created_by : null,
    version: Number.isInteger(row.version) ? Number(row.version) : 0,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? "")
  })) as CandidateApplication[];
  const groupIds = [...new Set(visibleApps.map(row => row.group_id))];
  const visibleGroups = await readInChunks<DashboardData["position_groups"][number]>(groupIds, chunk => readComplete<DashboardData["position_groups"][number]>(client,
    (from, to) => client.from("position_groups").select("*", { count: "exact" }).in("group_id", chunk).order("group_id", { ascending: true }).range(from, to),
    row => row.group_id, "candidate application groups", signal
  ), row => row.group_id, "candidate application groups");
  return { projection, visibleApps, visibleGroups };
}
/** Publish only verified profile and complete application choices before loading the selected journey. */
export async function loadCandidateDetailShell(client: SupabaseClient, identity: ScopedAccessIdentity, candidateId: string, base: DashboardData, signal?: AbortSignal): Promise<DashboardData> {
  const { projection, visibleApps, visibleGroups } = await getCandidateShell(client, identity, candidateId, signal);
  return {
    ...base, candidates: projection.candidate ? [{ ...projection.candidate, application_id: undefined, application_state: undefined, doc_group_id: null, group_id: null } as Candidate] : [],
    candidate_applications: visibleApps, position_groups: visibleGroups,
    candidate_application_assignments: [], recruitment_logs: [], recruitment_log_history: [],
    candidate_references: [], candidate_reference_checks: [], candidate_notes: [], rejection_letter_drafts: [],
    offers: [], interview_meetings: [], requisitions: [], requisition_logs: [], document_groups: [],
    candidate_profile_capabilities: projection.capabilities ? [projection.capabilities] : [],
    masked_candidate_pool: projection.masked ? [projection.masked] : []
  };
}
async function loadCandidateDetailUncached(client: SupabaseClient, identity: ScopedAccessIdentity, candidateId: string, applicationId: string | null, base: DashboardData, signal?: AbortSignal): Promise<DashboardData> {
  const accessScope = identity.key;
  const shell = await getCandidateShell(client, identity, candidateId, signal);
  const projection = shell.projection;
  if (!projection.candidate) return loadCandidateDetailShell(client, identity, candidateId, base, signal);
  const visibleApps = shell.visibleApps.map(row => ({ ...row }));
  const visibleGroups = shell.visibleGroups;
  const selectedId = applicationId ?? (visibleApps.length === 1 ? visibleApps[0].application_id : null);
  let selected = selectedId ? visibleApps.find(row => row.application_id === selectedId) : null;
  if (selectedId && !selected) throw new Error("This application is no longer available to your account.");
  if (selectedId) {
    const { data: selectedMetadata, error: selectedError } = await scheduleRecruitmentRead(client, () => client.from("candidate_applications").select("*").eq("application_id", selectedId).abortSignal(signal ?? new AbortController().signal).maybeSingle(), -1, {signal});
    if (selectedError) throw new Error(selectedError.message);
    if (!selectedMetadata || selectedMetadata.candidate_id !== candidateId) throw new Error("This application is no longer available to your account.");
    selected = selectedMetadata as CandidateApplication;
    const selectedIndex = visibleApps.findIndex(row => row.application_id === selectedId);
    if (selectedIndex < 0) throw new Error("This application is no longer available to your account.");
    // List projections intentionally omit mutable write metadata. Keep the exact
    // authorized row (including its current version) in the hydrated context.
    visibleApps[selectedIndex] = selected;
  }


  let assignments: ApplicationAssignment[] = [], history: RecruitmentLog[] = [], checks: CandidateReferenceCheck[] = [], offers: DashboardData["offers"] = [], meetings: DashboardData["interview_meetings"] = [], references: CandidateReference[] = [], notes: CandidateNote[] = [], rejectionDrafts: RejectionLetterDraft[] = [], requisitions: Requisition[] = [], requisitionLogs: RequisitionLog[] = [];
  if (selected) {
    const [historyItems, assignmentRows, referenceRows, noteRows, checkRows, offerRows, docGroupRows] = await Promise.all([
      readList<{ candidate: Record<string, unknown>; log: RecruitmentLog; audit: boolean }>(client, accessScope, { candidateId, applicationId: selected.application_id, showAudit: true }, "candidate history", signal),
      readScoped<ApplicationAssignment>(client as ScopedClient, "candidate_application_assignments", "application_id", selected.application_id, "assignment_id", "assignment history", signal),
      readScoped<CandidateReference>(client as ScopedClient, "candidate_references", "candidate_id", candidateId, "reference_id", "reference rows", signal),
      projection.capabilities?.can_read_note ? readScoped<CandidateNote>(client as ScopedClient, "candidate_notes", "candidate_id", candidateId, "note_id", "candidate note", signal) : Promise.resolve([]),
      readScoped<CandidateReferenceCheck>(client as ScopedClient, "candidate_reference_checks", "application_id", selected.application_id, "check_id", "reference checks", signal),
      readScoped<DashboardData["offers"][number]>(client as ScopedClient, "offers", "application_id", selected.application_id, "offer_id", "offers", signal),
      readComplete<DashboardData["document_groups"][number]>(client, (from, to) => client.from("document_groups").select("*", { count: "exact" }).eq("group_id", selected.group_id).order("doc_group_id", { ascending: true }).range(from, to), row => row.doc_group_id, "candidate group requisitions", signal)
    ]);
    history = historyItems.map(item => item.log);
    assignments = assignmentRows;
    references = referenceRows;
    notes = noteRows;
    checks = checkRows;
    offers = offerRows;
    const docIds = docGroupRows.map(row => row.doc_id);
    if (docIds.length) {
      const [reqRows, logRows] = await Promise.all([
        readInChunks<Requisition>(docIds, chunk => readComplete<Requisition>(client, (from, to) => client.from("requisitions").select("*", { count: "exact" }).in("doc_id", chunk).order("doc_id", { ascending: true }).range(from, to), row => row.doc_id, "linked requisitions", signal), row => row.doc_id, "linked requisitions"),
        readInChunks<RequisitionLog>(docIds, chunk => readComplete<RequisitionLog>(client, (from, to) => client.from("requisition_logs").select("*", { count: "exact" }).in("doc_id", chunk).order("log_id", { ascending: true }).range(from, to), row => String(row.log_id), "requisition history", signal), row => String(row.log_id), "requisition history")
      ]);
      requisitions = reqRows; requisitionLogs = logRows;
    }
    const instances = new Set(history.map(row => row.stage_instance_id).filter((id): id is string => Boolean(id)));
    if (instances.size) {
      rejectionDrafts = await readInChunks<RejectionLetterDraft>([...instances], chunk => readComplete<RejectionLetterDraft>(client,
        (from, to) => client.from("rejection_letter_drafts").select("*", { count: "exact" }).eq("candidate_id", candidateId).in("failed_stage_instance_id", chunk).order("draft_id", { ascending: true }).range(from, to),
        row => row.draft_id, "rejection letter history", signal
      ), row => row.draft_id, "rejection letter history");
    }
    if (instances.size) {
      meetings = await readInChunks<DashboardData["interview_meetings"][number]>([...instances], chunk => readComplete<DashboardData["interview_meetings"][number]>(client,
        (from, to) => client.from("interview_meetings").select("*", { count: "exact" }).in("stage_instance_id", chunk).order("meeting_id", { ascending: true }).range(from, to),
        row => row.meeting_id, "interview meetings", signal
      ), row => row.meeting_id, "interview meetings");
    }
    const canonical = history.filter(row => !row.superseded_at && !row.superseded_by_stage_instance_id);
    history = history;
    const candidate = { ...projection.candidate, application_id: undefined, application_state: undefined, doc_group_id: null, group_id: null } as Candidate;
    const selectedData: DashboardData = {
      ...base,
      candidates: [candidate],
      candidate_applications: visibleApps,
      candidate_application_assignments: assignments,
      recruitment_logs: canonical,
      recruitment_log_history: history,
      candidate_references: references,
      candidate_reference_checks: checks,
      candidate_notes: notes,
      rejection_letter_drafts: rejectionDrafts,
      offers,
      interview_meetings: meetings,
      position_groups: visibleGroups,
      document_groups: docGroupRows,
      requisitions,
      requisition_logs: requisitionLogs,
      candidate_profile_capabilities: projection.capabilities ? [projection.capabilities] : [],
      masked_candidate_pool: []
    };
    return selectedData;
  }

  const profileNotes = projection.capabilities?.can_read_note
    ? await readScoped<CandidateNote>(client as ScopedClient, "candidate_notes", "candidate_id", candidateId, "note_id", "candidate note", signal)
    : [];
  return {
    ...base,
    candidates: [{ ...projection.candidate, application_id: undefined, application_state: undefined, doc_group_id: null, group_id: null } as Candidate],
    candidate_applications: visibleApps,
    candidate_application_assignments: [],
    recruitment_logs: [], recruitment_log_history: [], candidate_references: [], candidate_reference_checks: [],
    candidate_notes: profileNotes, rejection_letter_drafts: [], offers: [], interview_meetings: [], requisitions: [], requisition_logs: [], position_groups: visibleGroups,
    candidate_profile_capabilities: projection.capabilities ? [projection.capabilities] : [],
    masked_candidate_pool: []
  };
}

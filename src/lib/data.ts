import { PROCESS_STAGES } from "@/lib/constants";
import type {
  Candidate,
  ChangeLog,
  DashboardData,
  DocumentGroup,
  EnrichedCandidate,
  EnrichedOffer,
  EnrichedRequisition,
  Offer,
  PositionGroup,
  Profile,
  RecruitmentLog,
  Requisition,
  RequisitionLog
} from "@/types/recruitment";

export const emptyDashboardData: DashboardData = {
  profile: null,
  profiles: [],
  requisitions: [],
  requisition_logs: [],
  position_groups: [],
  document_groups: [],
  candidates: [],
  recruitment_logs: [],
  offers: [],
  change_logs: []
};

type SupabaseLike = {
  from: (table: string) => {
    select: (columns?: string) => {
      order: (column: string, options?: { ascending?: boolean }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      limit: (count: number) => {
        order: (column: string, options?: { ascending?: boolean }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
  };
};

async function selectAll<T>(client: SupabaseLike, table: string, orderColumn = "created_at", ascending = false): Promise<T[]> {
  const { data, error } = await client.from(table).select("*").order(orderColumn, { ascending });
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

async function selectLimited<T>(client: SupabaseLike, table: string, orderColumn = "created_at", limit = 50): Promise<T[]> {
  const { data, error } = await client.from(table).select("*").limit(limit).order(orderColumn, { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function loadDashboardData(client: SupabaseLike): Promise<DashboardData> {
  const [
    userResult,
    profiles,
    requisitions,
    requisitionLogs,
    positionGroups,
    documentGroups,
    candidates,
    recruitmentLogs,
    offers,
    changeLogs
  ] = await Promise.all([
    client.auth.getUser(),
    selectAll<Profile>(client, "profiles", "updated_at"),
    selectAll<Requisition>(client, "requisitions", "updated_at"),
    selectLimited<RequisitionLog>(client, "requisition_logs", "created_at", 100),
    selectAll<PositionGroup>(client, "position_groups", "updated_at"),
    selectAll<DocumentGroup>(client, "document_groups", "updated_at"),
    selectAll<Candidate>(client, "candidates", "updated_at"),
    selectLimited<RecruitmentLog>(client, "recruitment_logs", "created_at", 250),
    selectAll<Offer>(client, "offers", "updated_at"),
    selectLimited<ChangeLog>(client, "change_logs", "changed_at", 100)
  ]);

  if (userResult.error) throw new Error(userResult.error.message);

  const userId = userResult.data.user?.id;
  const profile = profiles.find((row) => row.id === userId) ?? null;

  return {
    profile,
    profiles,
    requisitions,
    requisition_logs: requisitionLogs,
    position_groups: positionGroups,
    document_groups: documentGroups,
    candidates,
    recruitment_logs: recruitmentLogs,
    offers,
    change_logs: changeLogs
  };
}

export function enrichRequisitions(data: DashboardData): EnrichedRequisition[] {
  return data.requisitions.map((requisition) => {
    const relatedGroups = data.document_groups.filter((group) => group.doc_id === requisition.doc_id);
    const relatedGroupIds = new Set(relatedGroups.map((group) => group.doc_group_id));
    const candidateCount = data.candidates.filter((candidate) => relatedGroupIds.has(candidate.doc_group_id)).length;
    const acceptedCount = data.offers.filter(
      (offer) => offer.doc_id === requisition.doc_id && Boolean(offer.accepted_date)
    ).length;

    return {
      ...requisition,
      candidate_count: candidateCount,
      accepted_count: acceptedCount,
      open_headcount: Math.max(requisition.head_count - acceptedCount, 0)
    };
  });
}

export function enrichCandidates(data: DashboardData): EnrichedCandidate[] {
  return data.candidates.map((candidate) => {
    const group = data.document_groups.find((row) => row.doc_group_id === candidate.doc_group_id);
    const requisition = data.requisitions.find((row) => row.doc_id === group?.doc_id);
    const logs = data.recruitment_logs
      .filter((log) => log.candidate_id === candidate.candidate_id)
      .sort((a, b) => b.log_id - a.log_id);
    const latest = logs[0];
    const acceptedOffer = data.offers.find((offer) => offer.candidate_id === candidate.candidate_id && offer.accepted_date);

    return {
      ...candidate,
      doc_id: group?.doc_id ?? null,
      group_position: group?.group_position ?? null,
      site: requisition?.site ?? null,
      person_in_charge: requisition?.person_in_charge ?? null,
      latest_process: latest?.recruitment_process ?? "No activity",
      latest_result: latest?.result ?? null,
      accepted_date: acceptedOffer?.accepted_date ?? null
    };
  });
}

export function enrichOffers(data: DashboardData): EnrichedOffer[] {
  return data.offers.map((offer) => {
    const candidate = data.candidates.find((row) => row.candidate_id === offer.candidate_id);
    const requisition = data.requisitions.find((row) => row.doc_id === offer.doc_id);

    return {
      ...offer,
      candidate_name: candidate?.name ?? null,
      position: requisition?.position ?? null,
      site: requisition?.site ?? null,
      person_in_charge: requisition?.person_in_charge ?? null
    };
  });
}

export function latestLogsForCandidate(data: DashboardData, candidateId: string) {
  return data.recruitment_logs
    .filter((log) => log.candidate_id === candidateId)
    .sort((a, b) => b.log_id - a.log_id);
}

export function pipelineBoard(candidates: EnrichedCandidate[]) {
  return PROCESS_STAGES.map((stage) => ({
    stage,
    rows: candidates.filter((candidate) => candidate.latest_process === stage)
  }));
}

export function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

export function filterByText<T extends { site?: string | null; person_in_charge?: string | null }>(
  rows: T[],
  filters: { site: string; owner: string }
) {
  const site = filters.site.trim().toLowerCase();
  const owner = filters.owner.trim().toLowerCase();
  return rows.filter((row) => {
    const siteOk = !site || (row.site ?? "").toLowerCase().includes(site);
    const ownerOk = !owner || (row.person_in_charge ?? "").toLowerCase().includes(owner);
    return siteOk && ownerOk;
  });
}

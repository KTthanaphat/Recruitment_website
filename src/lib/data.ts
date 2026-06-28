import { PROCESS_STAGES } from "@/lib/constants";
import type {
  Candidate,
  ChangeLog,
  DashboardData,
  DocumentGroup,
  EnrichedCandidate,
  EnrichedOffer,
  EnrichedRequisition,
  EnrichedSourcingGroup,
  Offer,
  PositionGroup,
  Profile,
  RecruitmentLog,
  Requisition,
  RequisitionLog,
  SourcingWeeklyUpdate,
  VacancyWeeklySnapshot
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
  sourcing_weekly_updates: [],
  vacancy_weekly_snapshots: [],
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
    sourcingWeeklyUpdates,
    vacancyWeeklySnapshots,
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
    selectAll<SourcingWeeklyUpdate>(client, "sourcing_weekly_updates", "updated_at"),
    selectAll<VacancyWeeklySnapshot>(client, "vacancy_weekly_snapshots", "updated_at"),
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
    sourcing_weekly_updates: sourcingWeeklyUpdates,
    vacancy_weekly_snapshots: vacancyWeeklySnapshots,
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
      latest_log_date: latest?.log_date ?? null,
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
      person_in_charge: requisition?.person_in_charge ?? null,
      request_type: requisition?.request_type ?? null
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

export function enrichSourcingGroups(data: DashboardData, weekStart: string): EnrichedSourcingGroup[] {
  const requisitions = enrichRequisitions(data);
  const candidates = enrichCandidates(data);
  const groupsById = new Map<string, DocumentGroup[]>();

  for (const match of data.document_groups) {
    if (!match.group_id) continue;
    groupsById.set(match.group_id, [...(groupsById.get(match.group_id) ?? []), match]);
  }

  return Array.from(groupsById.entries())
    .map(([groupId, matches]) => {
      const matchedRequisitions = matches
        .map((match) => requisitions.find((row) => row.doc_id === match.doc_id))
        .filter((row): row is EnrichedRequisition => Boolean(row))
        .filter((row) => row.status === "ongoing" && row.open_headcount > 0);

      if (matchedRequisitions.length === 0) return null;

      const positionGroup = data.position_groups.find((group) => group.group_id === groupId);
      const groupCandidateCount = candidates.filter((candidate) => {
        const match = data.document_groups.find((row) => row.doc_group_id === candidate.doc_group_id);
        return match?.group_id === groupId;
      }).length;
      const latestUpdate = data.sourcing_weekly_updates.find(
        (update) => update.group_id === groupId && update.week_start === weekStart
      ) ?? null;

      return {
        group_id: groupId,
        group_position: positionGroup?.group_position ?? matches[0]?.group_position ?? groupId,
        sites: uniqueValues(matchedRequisitions.map((row) => row.site)),
        owners: uniqueValues(matchedRequisitions.map((row) => row.person_in_charge)),
        doc_ids: uniqueValues(matchedRequisitions.map((row) => row.doc_id)),
        open_headcount: matchedRequisitions.reduce((sum, row) => sum + row.open_headcount, 0),
        candidate_count: groupCandidateCount,
        channel_fb: latestUpdate?.channel_fb ?? positionGroup?.channel_fb ?? false,
        channel_jobthai: latestUpdate?.channel_jobthai ?? positionGroup?.channel_jobthai ?? false,
        channel_jobtopgun: latestUpdate?.channel_jobtopgun ?? positionGroup?.channel_jobtopgun ?? false,
        channel_jobdb: latestUpdate?.channel_jobdb ?? positionGroup?.channel_jobdb ?? false,
        latest_update: latestUpdate
      };
    })
    .filter((group): group is EnrichedSourcingGroup => Boolean(group))
    .sort((a, b) => a.group_position.localeCompare(b.group_position) || a.group_id.localeCompare(b.group_id));
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

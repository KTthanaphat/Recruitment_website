import { PROCESS_STAGES, SOURCING_CHANNELS } from "@/lib/constants";
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
    const context = candidateGroupContext(data, candidate.doc_group_id);
    const logs = data.recruitment_logs
      .filter((log) => log.candidate_id === candidate.candidate_id)
      .sort((a, b) => b.log_id - a.log_id);
    const latest = logs[0];
    const acceptedOffer = data.offers.find((offer) => offer.candidate_id === candidate.candidate_id && offer.accepted_date);

    return {
      ...candidate,
      doc_id: context.doc_ids.join(", ") || group?.doc_id || null,
      doc_ids: context.doc_ids,
      group_id: context.group_id,
      group_position: group?.group_position ?? null,
      sites: context.sites,
      person_in_charges: context.owners,
      site: context.sites.join(", ") || null,
      person_in_charge: context.owners.join(", ") || null,
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
  const groupsById = documentGroupsByPositionGroup(data.document_groups);

  return Array.from(groupsById.entries())
    .map(([groupId, matches]): EnrichedSourcingGroup | null => {
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
      const channelFlags = sourcingChannelFlags(positionGroup, matches);

      return {
        group_id: groupId,
        group_position: positionGroup?.group_position ?? matches[0]?.group_position ?? groupId,
        sites: uniqueValues(matchedRequisitions.map((row) => row.site)),
        owners: uniqueValues(matchedRequisitions.map((row) => row.person_in_charge)),
        doc_ids: uniqueValues(matchedRequisitions.map((row) => row.doc_id)),
        open_headcount: matchedRequisitions.reduce((sum, row) => sum + row.open_headcount, 0),
        candidate_count: groupCandidateCount,
        ...channelFlags,
        latest_update: latestUpdate
      };
    })
    .filter((group): group is EnrichedSourcingGroup => Boolean(group))
    .sort((a, b) => a.group_position.localeCompare(b.group_position) || a.group_id.localeCompare(b.group_id));
}

export function staleOpenSourcingGroups(data: DashboardData, staleDays = 6): EnrichedSourcingGroup[] {
  const requisitions = enrichRequisitions(data);
  const candidates = enrichCandidates(data);
  const groupsById = documentGroupsByPositionGroup(data.document_groups);
  const staleBefore = startOfToday();
  staleBefore.setDate(staleBefore.getDate() - staleDays);

  return Array.from(groupsById.entries())
    .map(([groupId, matches]): EnrichedSourcingGroup | null => {
      const matchedRequisitions = matches
        .map((match) => requisitions.find((row) => row.doc_id === match.doc_id))
        .filter((row): row is EnrichedRequisition => Boolean(row))
        .filter((row) => row.status === "ongoing" && row.open_headcount > 0);

      if (matchedRequisitions.length === 0) return null;

      const positionGroup = data.position_groups.find((group) => group.group_id === groupId);
      const latestUpdate = latestSourcingUpdate(data.sourcing_weekly_updates, groupId);
      const latestUpdatedAt = latestUpdate ? new Date(latestUpdate.updated_at) : null;
      if (latestUpdatedAt && latestUpdatedAt > staleBefore) return null;

      const groupCandidateCount = candidates.filter((candidate) => {
        const match = data.document_groups.find((row) => row.doc_group_id === candidate.doc_group_id);
        return match?.group_id === groupId;
      }).length;

      return {
        group_id: groupId,
        group_position: positionGroup?.group_position ?? matches[0]?.group_position ?? groupId,
        sites: uniqueValues(matchedRequisitions.map((row) => row.site)),
        owners: uniqueValues(matchedRequisitions.map((row) => row.person_in_charge)),
        doc_ids: uniqueValues(matchedRequisitions.map((row) => row.doc_id)),
        open_headcount: matchedRequisitions.reduce((sum, row) => sum + row.open_headcount, 0),
        candidate_count: groupCandidateCount,
        ...sourcingChannelFlags(positionGroup, matches),
        latest_update: latestUpdate
      };
    })
    .filter((group): group is EnrichedSourcingGroup => Boolean(group))
    .sort((a, b) => {
      const dateA = a.latest_update?.updated_at ?? "";
      const dateB = b.latest_update?.updated_at ?? "";
      return dateA.localeCompare(dateB) || a.group_position.localeCompare(b.group_position) || a.group_id.localeCompare(b.group_id);
    });
}

export function filterChangeLogsByText(data: DashboardData, filters: { site: string; owner: string }) {
  const site = filters.site.trim().toLowerCase();
  const owner = filters.owner.trim().toLowerCase();
  if (!site && !owner) return data.change_logs;

  return data.change_logs.filter((log) => {
    const context = changeLogContext(data, log);
    if (!context) return false;
    const siteOk = !site || context.sites.some((value) => value.toLowerCase().includes(site));
    const ownerOk = !owner || context.owners.some((value) => value.toLowerCase().includes(owner));
    return siteOk && ownerOk;
  });
}

export function candidateGroupContext(data: DashboardData, docGroupId: string) {
  const documentGroup = data.document_groups.find((row) => row.doc_group_id === docGroupId);
  const groupId = documentGroup?.group_id ?? null;
  const matchedRequisitions = groupId
    ? requisitionsForGroupId(data, groupId)
    : data.requisitions.filter((row) => row.doc_id === documentGroup?.doc_id);

  return {
    group_id: groupId,
    doc_ids: uniqueValues(matchedRequisitions.map((row) => row.doc_id)),
    sites: uniqueValues(matchedRequisitions.map((row) => row.site)),
    owners: uniqueValues(matchedRequisitions.map((row) => row.person_in_charge))
  };
}

export function sourcingChannelsForDocGroup(data: DashboardData, docGroupId: string) {
  const documentGroup = data.document_groups.find((row) => row.doc_group_id === docGroupId);
  const positionGroup = data.position_groups.find((row) => row.group_id === documentGroup?.group_id);
  if (!documentGroup) return [];

  return SOURCING_CHANNELS.filter((channel) => Boolean(positionGroup?.[channel.enabled] ?? documentGroup[channel.enabled]));
}

function changeLogContext(data: DashboardData, log: ChangeLog) {
  const entity = log.entity.toLowerCase();
  const row = (log.new_data ?? log.old_data ?? {}) as Record<string, unknown>;
  const value = (key: string) => (typeof row[key] === "string" ? row[key] as string : null);
  const entityId = log.entity_id;

  if (entity === "requisitions") return contextForDocId(data, value("doc_id") ?? entityId);
  if (entity === "requisition_logs") return contextForDocId(data, value("doc_id"));
  if (entity === "vacancy_weekly_snapshots") return contextFromValues(value("site"), null);
  if (entity === "offers") return contextForDocId(data, value("doc_id"));
  if (entity === "candidates") return contextForCandidateId(data, value("candidate_id") ?? entityId);
  if (entity === "recruitment_logs") return contextForCandidateId(data, value("candidate_id"));
  if (entity === "document_groups") {
    return contextForGroupId(data, value("group_id")) ?? contextForDocId(data, value("doc_id")) ?? contextForDocGroupId(data, value("doc_group_id") ?? entityId);
  }
  if (entity === "position_groups" || entity === "sourcing_weekly_updates") return contextForGroupId(data, value("group_id") ?? entityId);
  return null;
}

function contextForCandidateId(data: DashboardData, candidateId: string | null) {
  const candidate = data.candidates.find((row) => row.candidate_id === candidateId);
  return candidate ? contextForDocGroupId(data, candidate.doc_group_id) : null;
}

function contextForDocGroupId(data: DashboardData, docGroupId: string | null) {
  if (!docGroupId) return null;
  const context = candidateGroupContext(data, docGroupId);
  return contextFromValues(context.sites, context.owners);
}

function contextForDocId(data: DashboardData, docId: string | null) {
  const requisition = data.requisitions.find((row) => row.doc_id === docId);
  return requisition ? contextFromValues(requisition.site, requisition.person_in_charge) : null;
}

function contextForGroupId(data: DashboardData, groupId: string | null) {
  if (!groupId) return null;
  const requisitions = requisitionsForGroupId(data, groupId);
  return requisitions.length > 0
    ? contextFromValues(requisitions.map((row) => row.site), requisitions.map((row) => row.person_in_charge))
    : null;
}

function contextFromValues(site: string | string[] | null, owner: string | Array<string | null> | null) {
  const sites = Array.isArray(site) ? uniqueValues(site) : uniqueValues([site]);
  const owners = Array.isArray(owner) ? uniqueValues(owner) : uniqueValues([owner]);
  return { sites, owners };
}

function requisitionsForGroupId(data: DashboardData, groupId: string) {
  const docIds = new Set(
    data.document_groups
      .filter((row) => row.group_id === groupId)
      .map((row) => row.doc_id)
  );
  return data.requisitions.filter((row) => docIds.has(row.doc_id));
}

function documentGroupsByPositionGroup(documentGroups: DocumentGroup[]) {
  const groupsById = new Map<string, DocumentGroup[]>();
  for (const match of documentGroups) {
    if (!match.group_id) continue;
    groupsById.set(match.group_id, [...(groupsById.get(match.group_id) ?? []), match]);
  }
  return groupsById;
}

function sourcingChannelFlags(positionGroup: PositionGroup | undefined, matches: DocumentGroup[]) {
  return Object.fromEntries(
    SOURCING_CHANNELS.map((channel) => [
      channel.enabled,
      Boolean(positionGroup?.[channel.enabled] ?? matches.some((match) => match[channel.enabled]))
    ])
  ) as Pick<EnrichedSourcingGroup, (typeof SOURCING_CHANNELS)[number]["enabled"]>;
}

function latestSourcingUpdate(updates: SourcingWeeklyUpdate[], groupId: string): SourcingWeeklyUpdate | null {
  return updates
    .filter((update) => update.group_id === groupId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
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

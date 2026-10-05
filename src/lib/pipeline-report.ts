import { ACTIVE_PIPELINE_STAGES, PIPELINE_FUNNEL_STAGES, SOURCING_CHANNELS, pipelineDisplayLabel } from "@/lib/constants";
import { SOURCING_CHANNEL_COLORS, UNKNOWN_SOURCING_CHANNEL_COLOR } from "@/lib/sourcing-colors";
import { translate } from "@/lib/i18n/dictionary";
import { isReportEligible, validDateOnly, dateOnly } from "@/lib/dashboard-report-eligibility";
import type { DashboardData, EnrichedRequisition, Language, Offer, ProcessStage } from "@/types/recruitment";
import type { PipelineFunnelRow } from "@/components/ui/PipelineFunnel";
import type { SourceEffectivenessRow } from "@/components/dashboard/SourceEffectiveness";
import type { PerformancePeriod } from "@/lib/recruitment-performance";
import { dashboardLevelMatches, type DashboardLevel } from "@/lib/dashboard-filters";
export type PipelineStageRecord = {
    logId: number;
    candidateId: string;
    name: string;
    rawChannel: string;
    channel: string;
    groupId: string;
    docIds: string;
    stage: ProcessStage;
    round: number;
    entry: string;
    outcome: string | null;
    activity: string;
    result: number | null;
    resume: number;
    passed: number;
    phone: number;
};
export type PipelineHireRecord = {
    offer: Offer;
    requisition: EnrichedRequisition;
    candidateId: string;
    name: string;
    rawChannel: string;
    channel: string;
    groupIds: string;
    hired: number;
};
export type PipelineSourcingRecord = {
    groupId: string;
    groupName: string;
    docIds: string;
    sites: string;
    departments: string;
    week: string;
    channel: string;
    recorded: number | null;
    applicants: number;
};
export type PipelineReport = {
    funnelRows: PipelineFunnelRow[];
    sourceRows: SourceEffectivenessRow[];
    requisitions: EnrichedRequisition[];
    groupDocs: Record<string, string[]>;
    stageRecords: PipelineStageRecord[];
    hireRecords: PipelineHireRecord[];
    sourcingRecords: PipelineSourcingRecord[];
};
/** Screen and workbook share the same contribution ledger and distinct counting. */
export function buildPipelineReport(data: DashboardData, candidateOffers: Offer[], requisitions: EnrichedRequisition[], range: {
    start: string;
    end: string;
    valid: boolean;
}, period: PerformancePeriod, levels: DashboardLevel[], channelFilter: string, language: Language): PipelineReport {
    const eligible = range.valid ? requisitions.filter(row => isReportEligible(row, data, range.start, range.end, period) && dashboardLevelMatches(row.level, levels)) : [];
    const docIds = new Set(eligible.map(row => row.doc_id));
    const groupDocs: Record<string, string[]> = {};
    for (const link of data.document_groups)
        if (docIds.has(link.doc_id) && link.group_id)
            groupDocs[link.group_id] = [...new Set([...(groupDocs[link.group_id] ?? []), link.doc_id])].sort();
    const groupByDoc = new Map(data.document_groups.map(row => [row.doc_group_id, row.group_id]));
    const matches = (channel: string | null) => channelFilter === "all" || channel?.trim() === channelFilter;
    const known = (channel: string) => SOURCING_CHANNELS.some(row => row.label === channel);
    const display = (channel: string) => channelFilter !== "all" || known(channel) ? channel : translate(language, "sourcingUnknownChannel");
    const candidates = new Map(data.candidates.map(row => [row.candidate_id, row]));
    const candidateGroup = (id: string) => { const candidate = candidates.get(id); return candidate?.group_id ?? (candidate?.doc_group_id ? groupByDoc.get(candidate.doc_group_id) : null); };
    const stageRecords: PipelineStageRecord[] = [], hireRecords: PipelineHireRecord[] = [], sourcingRecords: PipelineSourcingRecord[] = [];
    const resumeSeen = new Set<string>(), passedSeen = new Set<string>();
    const logs = data.recruitment_logs.filter(row => !row.superseded_at).map(log => ({ log, activity: dateOnly(log.result === 1 ? log.outcome_date ?? log.log_date : log.log_date) })).sort((a, b) => (a.activity ?? "").localeCompare(b.activity ?? "") || a.log.log_id - b.log.log_id);
    for (const { log, activity } of logs) {
        const candidate = candidates.get(log.candidate_id), groupId = candidateGroup(log.candidate_id);
        if (!candidate || !groupId || !groupDocs[groupId] || !matches(candidate.channel) || !activity || activity < range.start || activity > range.end || !ACTIVE_PIPELINE_STAGES.includes(log.recruitment_process))
            continue;
        const resume = Number(log.recruitment_process === "Phone Screen" && !resumeSeen.has(candidate.candidate_id));
        if (resume)
            resumeSeen.add(candidate.candidate_id);
        const key = `${candidate.candidate_id}\0${log.recruitment_process}`;
        const passed = Number(log.result === 1 && !passedSeen.has(key));
        if (passed)
            passedSeen.add(key);
        const rawChannel = candidate.channel?.trim() ?? "";
        stageRecords.push({ logId: log.log_id, candidateId: candidate.candidate_id, name: candidate.name, rawChannel, channel: display(rawChannel), groupId, docIds: groupDocs[groupId].join(", "), stage: log.recruitment_process, round: log.round, entry: log.log_date, outcome: log.outcome_date ?? null, activity, result: log.result, resume, passed, phone: Number(passed === 1 && log.recruitment_process === "Phone Screen") });
    }
    const hireSeen = new Set<string>();
    for (const offer of [...candidateOffers].sort((a, b) => (a.accepted_date ?? "").localeCompare(b.accepted_date ?? "") || a.offer_id - b.offer_id)) {
        const accepted = validDateOnly(offer.accepted_date), candidate = candidates.get(offer.candidate_id), requisition = eligible.find(row => row.doc_id === offer.doc_id);
        if (!accepted || accepted < range.start || accepted > range.end || !candidate || !requisition || !matches(candidate.channel))
            continue;
        const rawChannel = candidate.channel?.trim() ?? "", hired = Number(!hireSeen.has(candidate.candidate_id));
        hireSeen.add(candidate.candidate_id);
        const groupIds = Object.keys(groupDocs).filter(id => groupDocs[id].includes(offer.doc_id)).sort().join(", ");
        hireRecords.push({ offer, requisition, candidateId: candidate.candidate_id, name: candidate.name, rawChannel, channel: display(rawChannel), groupIds, hired });
    }
    for (const update of [...data.sourcing_weekly_updates].sort((a, b) => a.week_start.localeCompare(b.week_start) || a.group_id.localeCompare(b.group_id))) {
        if (!groupDocs[update.group_id] || update.week_start < range.start || update.week_start > range.end)
            continue;
        const linked = eligible.filter(row => groupDocs[update.group_id].includes(row.doc_id));
        for (const channel of SOURCING_CHANNELS.filter(row => channelFilter === "all" || row.label === channelFilter)) {
            const recorded = update[channel.count];
            sourcingRecords.push({ groupId: update.group_id, groupName: data.position_groups.find(row => row.group_id === update.group_id)?.group_position ?? "", docIds: groupDocs[update.group_id].join(", "), sites: [...new Set(linked.map(row => row.site))].sort().join(", "), departments: [...new Set(linked.map(row => row.department))].sort().join(", "), week: update.week_start, channel: channel.label, recorded, applicants: Number(recorded ?? 0) });
        }
    }
    const channels = channelFilter === "all" ? [...SOURCING_CHANNELS.map(row => row.label), translate(language, "sourcingUnknownChannel")] : [channelFilter];
    const channelRow = (label: string): SourceEffectivenessRow => { const knownChannel = SOURCING_CHANNELS.find(row => row.label === label); return { key: knownChannel?.enabled ?? "unknown", label, color: knownChannel ? SOURCING_CHANNEL_COLORS[knownChannel.enabled] : UNKNOWN_SOURCING_CHANNEL_COLOR, applicants: sourcingRecords.filter(row => row.channel === label).reduce((n, row) => n + row.applicants, 0), phone: stageRecords.filter(row => row.channel === label).reduce((n, row) => n + row.phone, 0), hired: hireRecords.filter(row => row.channel === label).reduce((n, row) => n + row.hired, 0) }; };
    const allSource = channels.map(channelRow);
    const sourceRows = allSource.filter(row => row.applicants + row.phone + row.hired > 0).sort((a, b) => b.applicants - a.applicants || channels.indexOf(a.label) - channels.indexOf(b.label));
    const applicants = sourcingRecords.reduce((n, row) => n + row.applicants, 0);
    const stages = ["applicants", ...PIPELINE_FUNNEL_STAGES];
    const countStage = (key: string, channel?: string) => key === "applicants" ? sourcingRecords.filter(row => !channel || row.channel === channel).reduce((n, row) => n + row.applicants, 0) : stageRecords.filter(row => !channel || row.channel === channel).reduce((n, row) => n + (key === "Resume Screening" ? row.resume : row.stage === key ? row.passed : 0), 0);
    const funnelRows: PipelineFunnelRow[] = stages.map((key, index) => { const count = countStage(key), previous = index ? countStage(stages[index - 1]) : null; return { key, label: key === "applicants" ? translate(language, "applicants") : pipelineDisplayLabel(key as typeof PIPELINE_FUNNEL_STAGES[number], language), count, conversionRate: previous ? count / previous : null, yieldRate: applicants ? count / applicants : null, barRatio: applicants ? Math.min(count / applicants, 1) : null, segments: channels.map(label => ({ ...channelRow(label), count: countStage(key, label) })) }; });
    return { funnelRows, sourceRows, requisitions: eligible, groupDocs, stageRecords, hireRecords, sourcingRecords };
}

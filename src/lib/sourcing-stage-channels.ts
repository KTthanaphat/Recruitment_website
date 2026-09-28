import { ACTIVE_PIPELINE_STAGES, SOURCING_CHANNELS } from "@/lib/constants";
import { formatLocalDateInput } from "@/lib/dates";
import { pipelineStageRecords } from "@/lib/operations";
import type { DashboardData, ProcessStage } from "@/types/recruitment";

export type StageChannelKey = (typeof SOURCING_CHANNELS)[number]["enabled"] | "unknown";
export type StageChannelSegment = { key: StageChannelKey; count: number };
export type StageChannelRow = { stage: ProcessStage; total: number; segments: StageChannelSegment[] };

function channelKey(value: string | null): StageChannelKey {
  const label = value?.trim().toLocaleLowerCase() ?? "";
  return SOURCING_CHANNELS.find((channel) => channel.label.toLocaleLowerCase() === label)?.enabled ?? "unknown";
}

export function sourcingStageCutoff(selectedWeek: string, today = formatLocalDateInput()) {
  const friday = new Date(`${selectedWeek.slice(0, 10)}T00:00:00Z`);
  friday.setUTCDate(friday.getUTCDate() + 6);
  return friday.toISOString().slice(0, 10) < today ? friday.toISOString().slice(0, 10) : today;
}

export function deriveSourcingStageChannels(data: DashboardData, groupId: string, selectedWeek: string) {
  const cutoff = sourcingStageCutoff(selectedWeek);
  const matchIds = new Set(data.document_groups.filter((match) => match.group_id === groupId).map((match) => match.doc_group_id));
  const keys: StageChannelKey[] = [...SOURCING_CHANNELS.map((channel) => channel.enabled), "unknown"];
  const counts = new Map<ProcessStage, Map<StageChannelKey, number>>(ACTIVE_PIPELINE_STAGES.map((stage) => [stage, new Map()]));

  for (const candidate of data.candidates) {
    if (candidate.group_id !== groupId && !(candidate.doc_group_id && matchIds.has(candidate.doc_group_id))) continue;
    const firstContact = candidate.first_contact_date?.slice(0, 10) ?? candidate.created_at.slice(0, 10);
    if (firstContact > cutoff) continue;
    const logs = data.recruitment_logs.filter((log) => log.candidate_id === candidate.candidate_id && !log.superseded_at && !log.superseded_by_stage_instance_id);
    const reached = new Set(pipelineStageRecords(logs).filter((record) => record.pending.openedDate.slice(0, 10) <= cutoff).map((record) => record.stage));
    const channel = channelKey(candidate.channel);
    for (const stage of reached) {
      const stageCounts = counts.get(stage);
      if (stageCounts) stageCounts.set(channel, (stageCounts.get(channel) ?? 0) + 1);
    }
  }

  const stages: StageChannelRow[] = ACTIVE_PIPELINE_STAGES.map((stage) => {
    const segments = keys.map((key) => ({ key, count: counts.get(stage)?.get(key) ?? 0 })).filter((segment) => segment.count > 0);
    return { stage, total: segments.reduce((sum, segment) => sum + segment.count, 0), segments };
  });
  const legend = keys.filter((key) => stages.some((stage) => stage.segments.some((segment) => segment.key === key)));
  return { stages, legend, cutoff };
}

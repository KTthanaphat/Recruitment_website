import { processStageLabel, translate } from "@/lib/i18n/dictionary";
import type { DataQualityIssue, WorkspaceQualityIssueCode } from "@/lib/operations";
import type { Language, ProcessStage } from "@/types/recruitment";

const issueKeys: Record<WorkspaceQualityIssueCode, string> = {
  duplicateCandidate: "workspaceIssueDuplicate",
  candidateNoActivity: "workspaceIssueNoActivity",
  candidateClosedRequest: "workspaceIssueClosedRequest",
  headcountFilled: "workspaceIssueHeadcountFilled",
  headcountNoCandidates: "workspaceIssueNoCandidates",
  requisitionSourcingStale: "workspaceIssueRequisitionSourcing",
  offerMissingStart: "workspaceIssueMissingStart",
  startConfirmationDue: "workspaceIssueStartDue",
  offerFillsRequest: "workspaceIssueOfferFills",
  groupSourcingStale: "workspaceIssueGroupSourcing",
  pipelineOrder: "workspaceIssuePipelineOrder"
};

export function localizeWorkspaceIssue(issue: DataQualityIssue, language: Language): DataQualityIssue {
  if (!issue.workspaceCode) return issue;
  const key = issueKeys[issue.workspaceCode];
  const matchedFields = String(issue.workspaceParams?.fields ?? "")
    .split(",")
    .filter((field) => field === "phone" || field === "name" || field === "folder")
    .map((field) => translate(language, `workspaceIssueField${field[0].toUpperCase()}${field.slice(1)}`))
    .join(", ");
  const params: Record<string, string | number> = { id: issue.entityId, ...issue.workspaceParams, fields: matchedFields };
  if (issue.workspaceCode === "pipelineOrder") {
    params.previous = processStageLabel(language, String(issue.workspaceParams?.previous ?? "") as ProcessStage);
    params.later = processStageLabel(language, String(issue.workspaceParams?.later ?? "") as ProcessStage);
  }
  return {
    ...issue,
    title: translate(language, `${key}Title`, params),
    detail: translate(language, `${key}Detail`, params),
    actionLabel: issue.actionLabel ? translate(language, `${key}Action`) : undefined
  };
}

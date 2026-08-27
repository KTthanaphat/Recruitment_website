"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdminView } from "@/components/admin/AdminView";
import { AuditView } from "@/components/audit/AuditView";
import { CandidatesView } from "@/components/candidates/CandidatesView";
import { HomeView } from "@/components/dashboard/HomeView";
import { VacancyWaterfallView } from "@/components/dashboard/VacancyWaterfallView";
import { AppShell } from "@/components/layout/AppShell";
import { OffersView } from "@/components/offers/OffersView";
import { PipelineBoardView } from "@/components/pipeline/PipelineBoardView";
import { RequisitionsView } from "@/components/requisitions/RequisitionsView";
import { EmbeddedSourcingEditor, SourcingView } from "@/components/sourcing/SourcingView";
import { WorkspaceOfferSection } from "@/components/workspace/WorkspaceOfferSection";
import { HiringWorkspaceView } from "@/components/workspace/HiringWorkspaceView";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { CreateSelectInput, DayDateSelector, Field, SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { CommandSelector } from "@/components/ui/CommandSelector";
import { OperationalSummaryStrip, RecordActionGroup } from "@/components/ui/Operations";
import { Panel } from "@/components/ui/Panel";
import { PipelineFunnel, type PipelineFunnelRow } from "@/components/ui/PipelineFunnel";
import { StageRail } from "@/components/ui/StageRail";
import { StatusBanner } from "@/components/ui/StatusBanner";
import { Tag } from "@/components/ui/Tag";
import { DisabledReasonHint, InlineDataQualityIssues } from "@/components/ui/Workflow";
import {
  ACTIVE_PIPELINE_STAGES,
  canManageSetup as canManageSetupRole,
  canManageUsers as canManageUsersRole,
  canWrite as canWriteRole,
  PIPELINE_FUNNEL_STAGES,
  pipelineDisplayLabel,
  PROCESS_UPDATE_STAGES,
  processLabel,
  recruiterNicknameOptions,
  ROLES,
  SITE_OPTIONS,
  SOURCING_CHANNELS,
  WRITABLE_REQUISITION_STATUSES,
  type PipelineDisplayStage
} from "@/lib/constants";
import { currentLocalWeekStart, formatLocalDateInput } from "@/lib/dates";
import { dailyWelcomeMessage } from "@/lib/daily-messages";
import { appendLegacyOption, departmentOptions, sectionOptionsForDepartment, type DepartmentSectionRow } from "@/lib/department-section-data";
import {
  emptyDashboardData,
  loadCompanyDashboardReport,
  enrichCandidates,
  enrichOffers,
  enrichRequisitions,
  enrichSourcingGroups,
  filterChangeLogsByText,
  filterByText,
  latestLogsForCandidate,
  loadDashboardData,
  sourcingChannelsForGroup,
  staleOpenSourcingGroups,
  uniqueValues
} from "@/lib/data";
import { boolFromForm, emptyToNull, formatCandidateName, formatDate, formatNumber, formatRequisitionOptionLabel, formatRequisitionTitle, formatThaiMobilePhone, resultText, statusTone } from "@/lib/format";
import { fillReadinessLabel, requisitionStatusLabel, requestTypeLabel, roleLabel, translate } from "@/lib/i18n/dictionary";
import { activeProcessStage, candidatePipelineCapability, candidateProcessDisabledReason, deriveDataQualityIssues, latestSuccessfulOfferPassDate, pipelineStageRecords, requisitionFillReadiness } from "@/lib/operations";
import { getRequisitionSlaState } from "@/lib/sla";
import { clearStoredSupabaseSession, hasSupabaseConfig, supabase, withAuthTimeout } from "@/lib/supabase/client";
import { asNumber, requireFields } from "@/lib/validation/forms";
import { buildContextualHref, pushWorkspaceUrlState, readWorkspaceUrlState as readWorkspaceUrlParams, updateWorkspaceUrlState, useWorkspaceUrlState } from "@/lib/workspace-url-state";
import type {
  DashboardData,
  DashboardReportData,
  EnrichedCandidate,
  EnrichedRequisition,
  Language,
  Offer,
  OfferPassHandoff,
  ProcessStage,
  RecruitmentLog,
  RequisitionRequestType,
  RequisitionStatus,
  RpcResult,
  ViewId,
  WorkspaceActionRequest
} from "@/types/recruitment";

type ModalName =
  | "requisition"
  | "status"
  | "candidate"
  | "candidate_reference"
  | "reference_status"
  | "reference_check"
  | "pipeline_start"
  | "pending_edit"
  | "pipeline_record_correction"
  | "stage_outcome"
  | "pipeline_pass"
  | "offer"
  | "start_confirmation"
  | "group"
  | "group_match"
  | "match"
  | "snapshot"
  | "user"
  | null;

type PendingAction = {
  title: string;
  summary: string;
  endpoint: string;
  payload: Record<string, unknown>;
  modal?: Exclude<ModalName, null>;
  route?: "rpc" | "api";
};

type DestructiveAction = {
  title: string;
  summary: string;
  endpoint: string;
  payload: Record<string, unknown>;
};

type ProcessDefaults = {
  candidate_id?: string;
  recruitment_process?: string;
  result?: string;
  round?: number;
  target_stage?: string;
  source?: string;
  remark?: string;
  passed_stages?: ProcessStage[];
  current_round?: number;
  pending_log_id?: number;
  stage_instance_id?: string;
  expected_updated_at?: string;
  outcome?: "pass" | "fail";
  pending_log_date?: string;
  pending_estimated_action_date?: string | null;
  pending_interviewer?: string | null;
  pending_remark?: string | null;
  outcome_date?: string | null;
  outcome_interviewer?: string | null;
  outcome_remark?: string | null;
  outcome_result?: string | null;
  reference_id?: string;
  reference_expected_updated_at?: string;
  reference_check_expected_updated_at?: string;
  reference_name?: string;
  reference_relationship?: string;
  reference_channel_type?: string;
  reference_channel_value?: string;
  reference_other_channel_label?: string | null;
  reference_status?: string;
  reference_status_reason?: string | null;
  reference_checked_date?: string;
  reference_duration_minutes?: number;
  reference_conversation_summary?: string;
  offer_id?: number;
  offer_expected_updated_at?: string;
  offer_start_confirmation?: "started" | "did_not_start" | null;
};

type ModalDefaults = {
  mode?: "new" | "change";
  selectedId?: string;
  candidate_id?: string;
  group_position?: string;
  doc_id?: string;
  group_id?: string;
  doc_group_id?: string;
  eligible_doc_group_ids?: string[];
  lock_doc_group_id?: boolean;
  eligible_group_ids?: string[];
  lock_group_id?: boolean;
  first_contact_date?: string;
  accepted_date?: string;
  offer_candidate_ids?: string[];
  offer_doc_ids?: string[];
};

type GuideStep = "source_candidates" | "create_group" | "add_match" | "ask_candidate" | "create_candidate" | null;

type GuideContext = {
  doc_id?: string;
  position?: string;
  level?: string | null;
  department?: string;
  site?: string;
  person_in_charge?: string;
  group_id?: string;
  group_position?: string;
  doc_group_id?: string;
  candidate_id?: string;
};

type WelcomeSummary = {
  openRequisitions: number;
  openVacancy: number;
  activeCandidates: number;
  offerFinalizationNeeded: number;
  filledThisMonth: number;
  responsibleVacancyTotal: number;
  filledResponsibleVacancyRatio: number;
  filledResponsibleVacancyBucket: WelcomeRatioBucket;
};

type WelcomeRatioBucket = 0 | 25 | 50 | 75 | 100;
type WorkspaceLoadState = "checking_session" | "redirecting_to_login" | "loading_data" | "ready" | "error";
type ParsedWorkspaceUrlState = {
  detailId: string | null;
  detailType: "candidate" | "requisition" | null;
  hasFilterParams: boolean;
  language: Language | null;
  owner: string | null;
  site: string | null;
  sourcingWeek: string | null;
  workspaceId: string | null;
  workspaceType: "requisition" | "group" | null;
};

function parseStoredFilters(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const filters = parsed as Record<string, unknown>;
    return {
      site: typeof filters.site === "string" ? filters.site : "",
      owner: typeof filters.owner === "string" ? filters.owner : ""
    };
  } catch {
    return null;
  }
}

const rpcByModal: Record<Exclude<ModalName, null | "user">, string> = {
  requisition: "app_upsert_requisition",
  status: "app_insert_requisition_log",
  candidate: "app_upsert_candidate",
  candidate_reference: "app_upsert_candidate_reference_v1",
  reference_status: "app_set_candidate_reference_status_v1",
  reference_check: "app_save_candidate_reference_check_v1",
  pipeline_start: "app_start_pipeline_stage_v2",
  pending_edit: "app_update_pipeline_pending_v2",
  pipeline_record_correction: "app_correct_pipeline_stage_record_v3",
  stage_outcome: "app_complete_pipeline_stage_v2",
  pipeline_pass: "app_pass_pipeline_jump_v2",
  offer: "app_upsert_offer",
  start_confirmation: "app_confirm_offer_start_v1",
  group: "app_upsert_position_group",
  group_match: "app_create_and_match_sourcing_group_v2",
  match: "app_create_group_match",
  snapshot: "app_upsert_vacancy_weekly_snapshot"
};

export function RecruitmentWorkspace({ initialView }: { initialView: ViewId }) {
  const router = useRouter();
  const workspaceUrlState = useWorkspaceUrlState();
  const [language, setLanguage] = useState<Language>("th");
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [companyDashboardReport, setCompanyDashboardReport] = useState<DashboardReportData | null>(null);
  const [workspaceLoadState, setWorkspaceLoadState] = useState<WorkspaceLoadState>("checking_session");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading recruitment records...");
  const [error, setError] = useState<string | null>(null);
  const [updateDenial, setUpdateDenial] = useState<string | null>(null);
  const [filters, setFilters] = useState({ site: "", owner: "" });
  const [sourcingWeek, setSourcingWeek] = useState(currentWeekStart());
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [destructiveAction, setDestructiveAction] = useState<DestructiveAction | null>(null);
  const [offerPassHandoff, setOfferPassHandoff] = useState<OfferPassHandoff | null>(null);
  const [processDefaults, setProcessDefaults] = useState<ProcessDefaults>({});
  const [modalDefaults, setModalDefaults] = useState<ModalDefaults>({});
  const [guideStep, setGuideStep] = useState<GuideStep>(null);
  const [guideContext, setGuideContext] = useState<GuideContext>({});
  const [detail, setDetail] = useState<{ type: "requisition" | "candidate"; id: string } | null>(null);
  const [workspaceTarget, setWorkspaceTarget] = useState<{ type: "requisition" | "group" | null; id: string | null }>({ type: null, id: null });
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [urlStateReady, setUrlStateReady] = useState(false);

  function showUpdateDenial(reason: string) {
    setStatus("Recruitment records loaded.");
    setUpdateDenial(reason);
  }

  const loadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setWorkspaceLoadState("error");
      setError("Supabase environment variables are not configured. Add .env.local or Vercel environment variables.");
      return null;
    }

    setLoading(true);
    setWorkspaceLoadState("checking_session");
    setError(null);
    let session;
    try {
      session = await withAuthTimeout(
        supabase.auth.getSession(),
        "Session verification timed out. Your saved session was cleared; please sign in again."
      );
    } catch (sessionError) {
      clearStoredSupabaseSession();
      setLoading(false);
      setWorkspaceLoadState("redirecting_to_login");
      setStatus(sessionError instanceof Error ? sessionError.message : "Session verification failed. Please sign in again.");
      window.location.replace("/login?reason=session-timeout");
      return null;
    }
    if (!session.data.session) {
      setLoading(false);
      setWorkspaceLoadState("redirecting_to_login");
      setStatus("No active session. Redirecting to login...");
      window.location.replace("/login");
      return null;
    }

    setWorkspaceLoadState("loading_data");
    try {
      const [loaded, dashboardReport] = await Promise.all([loadDashboardData(supabase), loadCompanyDashboardReport(supabase)]);
      setData(loaded);
      setCompanyDashboardReport(dashboardReport);
      setStatus("Recruitment records loaded.");
      setWorkspaceLoadState("ready");
      return loaded;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load recruitment data.");
      setWorkspaceLoadState("error");
      return null;
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadData();
    const urlState = parseWorkspaceUrlState();
    const savedLanguage = localStorage.getItem("recruitment_lang") as Language | null;
    const savedFilters = localStorage.getItem("recruitment_filters");
    const storedFilters = parseStoredFilters(savedFilters);
    setLanguage(urlState.language ?? savedLanguage ?? "th");
    if (urlState.hasFilterParams) {
      setFilters({ site: urlState.site ?? "", owner: urlState.owner ?? "" });
    } else if (storedFilters) {
      setFilters(storedFilters);
    } else if (savedFilters) {
      localStorage.removeItem("recruitment_filters");
    }
    if (urlState.sourcingWeek) setSourcingWeek(urlState.sourcingWeek);
    if (urlState.detailType && urlState.detailId) setDetail({ type: urlState.detailType, id: urlState.detailId });
    setWorkspaceTarget({ type: urlState.workspaceType, id: urlState.workspaceId });
    setUrlStateReady(true);
  }, [loadData]);

  useEffect(() => {
    function syncNavigationState() {
      const urlState = parseWorkspaceUrlState();
      setLanguage((current) => urlState.language ?? current);
      if (urlState.hasFilterParams) {
        setFilters((current) => {
          const next = { site: urlState.site ?? "", owner: urlState.owner ?? "" };
          return current.site === next.site && current.owner === next.owner ? current : next;
        });
      }
      if (urlState.sourcingWeek) setSourcingWeek(urlState.sourcingWeek);
      setDetail((current) => {
        const next = urlState.detailType && urlState.detailId ? { type: urlState.detailType, id: urlState.detailId } : null;
        if (!current && !next) return current;
        return current?.type === next?.type && current?.id === next?.id ? current : next;
      });
      setWorkspaceTarget((current) => {
        const next = { type: urlState.workspaceType, id: urlState.workspaceId };
        return current.type === next.type && current.id === next.id ? current : next;
      });
    }

    window.addEventListener("popstate", syncNavigationState);
    window.addEventListener("workspace:urlchange", syncNavigationState);
    return () => {
      window.removeEventListener("popstate", syncNavigationState);
      window.removeEventListener("workspace:urlchange", syncNavigationState);
    };
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;
    localStorage.setItem("recruitment_lang", language);
    localStorage.setItem("recruitment_filters", JSON.stringify(filters));
    updateWorkspaceUrlState({
      lang: language,
      site: filters.site,
      pic: filters.owner,
      sourcingSite: null,
      sourcingOwner: null,
      sourcingWeek,
      type: initialView === "workspace" ? workspaceTarget.type : undefined,
      id: initialView === "workspace" ? workspaceTarget.id : undefined,
      detailType: detail?.type,
      detailId: detail?.id
    });
  }, [detail, filters, initialView, language, sourcingWeek, urlStateReady, workspaceTarget]);

  const role = data.profile?.role ?? "viewer";
  const canWrite = canWriteRole(role);
  const canManageSetup = canManageSetupRole(role);
  const canManageUsers = canManageUsersRole(role);
  const canDeleteRecords = role === "system_admin";

  const enrichedRequisitions = useMemo(() => enrichRequisitions(data), [data]);
  const enrichedCandidates = useMemo(() => enrichCandidates(data), [data]);
  const enrichedOffers = useMemo(() => enrichOffers(data), [data]);
  const offeredCandidateIds = useMemo(() => new Set(data.offers.map((offer) => offer.candidate_id)), [data.offers]);
  const enrichedSourcingGroups = useMemo(() => enrichSourcingGroups(data, sourcingWeek), [data, sourcingWeek]);
  const staleSourcingGroups = useMemo(() => staleOpenSourcingGroups(data), [data]);
  const dataQualityIssues = useMemo(() => deriveDataQualityIssues(data), [data]);
  const welcomeSummary = useMemo(
    () => buildWelcomeSummary(enrichedRequisitions, enrichedCandidates, data.offers, data.requisition_logs, data.profile),
    [data.offers, data.profile, data.requisition_logs, enrichedCandidates, enrichedRequisitions]
  );

  const filteredRequisitions = useMemo(() => filterByText(enrichedRequisitions, filters), [enrichedRequisitions, filters]);
  const filteredCandidates = useMemo(() => filterByText(enrichedCandidates, filters), [enrichedCandidates, filters]);
  const filteredOffers = useMemo(() => filterByText(enrichedOffers, filters), [enrichedOffers, filters]);
  const dashboardReportData = useMemo(
    () => companyDashboardReport ? { ...data, ...companyDashboardReport } : data,
    [companyDashboardReport, data]
  );
  const dashboardRequisitions = useMemo(
    () => filterByText(enrichRequisitions(dashboardReportData), filters),
    [dashboardReportData, filters]
  );
  const dashboardOffers = useMemo(
    () => filterByText(enrichOffers(dashboardReportData), filters),
    [dashboardReportData, filters]
  );
  const filteredChangeLogs = useMemo(() => filterChangeLogsByText(data, filters), [data, filters]);
  const selectedWorkspaceDocId = workspaceUrlState.params.get("doc");

  useEffect(() => {
    if (initialView !== "workspace" || workspaceLoadState !== "ready" || workspaceTarget.type !== "requisition" || !workspaceTarget.id) return;
    const match = data.document_groups.find((row) => row.doc_id === workspaceTarget.id && row.group_id);
    if (!match?.group_id) return;
    const docId = workspaceTarget.id;
    setWorkspaceTarget({ type: "group", id: match.group_id });
    updateWorkspaceUrlState({ type: "group", id: match.group_id, doc: docId, detailType: null, detailId: null, focusType: null, focusId: null });
  }, [data.document_groups, initialView, workspaceLoadState, workspaceTarget]);

  useEffect(() => {
    if (initialView !== "workspace" || workspaceLoadState !== "ready" || activeModal) return;
    const candidateId = workspaceUrlState.params.get("offerCandidate");
    if (!candidateId) return;
    const candidate = enrichedCandidates.find((row) => row.candidate_id === candidateId);
    const docId = workspaceUrlState.params.get("doc")
      ?? data.document_groups.find((row) => row.group_id === candidate?.group_id)?.doc_id;
    setModalDefaults({
      mode: "new",
      candidate_id: candidateId,
      doc_id: docId,
      accepted_date: workspaceUrlState.params.get("offerDate") ?? undefined,
      offer_candidate_ids: enrichedCandidates.filter((row) => row.group_id === candidate?.group_id).map((row) => row.candidate_id),
      offer_doc_ids: docId ? [docId] : undefined
    });
    setActiveModal("offer");
    updateWorkspaceUrlState({ offerCandidate: null, offerDate: null });
  }, [activeModal, data.document_groups, enrichedCandidates, initialView, workspaceLoadState, workspaceUrlState.params]);
  const workspaceScope = useMemo(() => {
    const docIds = new Set<string>();
    const groupIds = new Set<string>();
    if (workspaceTarget.type === "requisition" && workspaceTarget.id) {
      docIds.add(workspaceTarget.id);
      data.document_groups.filter((row) => row.doc_id === workspaceTarget.id && row.group_id).forEach((row) => groupIds.add(row.group_id!));
    } else if (workspaceTarget.type === "group" && workspaceTarget.id) {
      groupIds.add(workspaceTarget.id);
      const linked = data.document_groups.filter((row) => row.group_id === workspaceTarget.id).map((row) => row.doc_id);
      if (selectedWorkspaceDocId && linked.includes(selectedWorkspaceDocId)) docIds.add(selectedWorkspaceDocId);
      else linked.forEach((docId) => docIds.add(docId));
    }
    const visibleDocIds = new Set([...docIds].filter((docId) => {
      const requisition = enrichedRequisitions.find((row) => row.doc_id === docId);
      return Boolean(requisition && (!filters.site || requisition.site === filters.site) && (!filters.owner || requisition.person_in_charge === filters.owner));
    }));
    const documentGroups = data.document_groups.filter((row) => (
      (row.group_id && groupIds.has(row.group_id))
      || (visibleDocIds.has(row.doc_id) && groupIds.size === 0)
    ) && visibleDocIds.has(row.doc_id));
    const scopedDocumentGroups = selectedWorkspaceDocId
      ? documentGroups.filter((row) => row.doc_id === selectedWorkspaceDocId)
      : documentGroups;
    const candidateDocGroupIds = new Set(documentGroups.map((row) => row.doc_group_id));
    const scopedCandidates = enrichedCandidates.filter((row) => (row.group_id ? groupIds.has(row.group_id) : Boolean(row.doc_group_id && candidateDocGroupIds.has(row.doc_group_id))));
    const scopedRequisitions = enrichedRequisitions.filter((row) => visibleDocIds.has(row.doc_id));
    const scopedOffers = enrichedOffers.filter((row) => visibleDocIds.has(row.doc_id));
    return {
      candidates: scopedCandidates,
      docGroupId: scopedDocumentGroups[0]?.doc_group_id ?? null,
      docGroupIds: scopedDocumentGroups.map((row) => row.doc_group_id),
      groupIds: [...groupIds],
      offers: scopedOffers,
      requisitions: scopedRequisitions
    };
  }, [data.document_groups, enrichedCandidates, enrichedOffers, enrichedRequisitions, filters.owner, filters.site, selectedWorkspaceDocId, workspaceTarget]);

  const siteOptions = SITE_OPTIONS;
  const ownerOptions = recruiterNicknameOptions(data.profiles);
  useEffect(() => {
    if (initialView !== "home" || loading || !data.profile) return;
    const key = welcomeStorageKey(data.profile.id ?? data.profile.email ?? "unknown");
    if (sessionStorage.getItem(key)) return;
    setWelcomeOpen(true);
  }, [data.profile, initialView, loading]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  function clearGuide() {
    setGuideStep(null);
    setGuideContext({});
    setModalDefaults({});
  }

  function closeRecordModal() {
    if (guideStep === "create_group" || guideStep === "add_match" || guideStep === "create_candidate") {
      clearGuide();
    }
    setActiveModal(null);
    setProcessDefaults({});
    setModalDefaults({});
  }

  function openGuidedGroup() {
    setGuideStep("create_group");
    setModalDefaults({ group_position: guideContext.position ?? "", doc_id: guideContext.doc_id ?? "" });
    setActiveModal("group_match");
  }

  function openGuidedCandidate() {
    setGuideStep("create_candidate");
    setModalDefaults({
      doc_group_id: guideContext.doc_group_id ?? "",
      first_contact_date: today()
    });
    setActiveModal("candidate");
  }

  function closeWelcomeSummary() {
    const key = welcomeStorageKey(data.profile?.id ?? data.profile?.email ?? "unknown");
    sessionStorage.setItem(key, "dismissed");
    setWelcomeOpen(false);
  }

  function openWelcomePipeline() {
    closeWelcomeSummary();
    router.push("/pipeline");
  }

  function openProcessForMove(candidate: EnrichedCandidate, nextStage: ProcessStage) {
    const logs = latestLogsForCandidate(data, candidate.candidate_id);
    const blockedReason = processUpdateBlockReason(logs);
    if (blockedReason) {
      showUpdateDenial(blockedReason);
      return;
    }
    const currentIndex = ACTIVE_PIPELINE_STAGES.indexOf(candidate.latest_process as ProcessStage);
    const targetIndex = ACTIVE_PIPELINE_STAGES.indexOf(nextStage);
    if (currentIndex === -1 || targetIndex <= currentIndex) return;
    if (candidate.latest_result !== null) {
      showUpdateDenial("Pipeline movement requires a pending current stage. Open the next pending stage before jumping farther.");
      return;
    }
    const passedStages = ACTIVE_PIPELINE_STAGES.slice(currentIndex, targetIndex);
    const currentRound = latestRoundForStage(logs, candidate.latest_process as ProcessStage);
    const currentPending = logs.find((row) => row.result === null);
    setProcessDefaults({
      candidate_id: candidate.candidate_id,
      target_stage: nextStage,
      source: "pipeline",
      passed_stages: passedStages,
      current_round: currentRound,
      stage_instance_id: currentPending?.stage_instance_id ?? String(currentPending?.log_id ?? ""),
      expected_updated_at: currentPending?.updated_at ?? currentPending?.created_at,
      pending_log_date: currentPending?.log_date,
      pending_estimated_action_date: currentPending?.estimated_action_date,
      pending_interviewer: currentPending?.interviewer,
      pending_remark: currentPending?.remark,
      remark: `Progressed from ${processLabel(candidate.latest_process)} to ${processLabel(nextStage)} by pipeline drag and drop`
    });
    setActiveModal("pipeline_pass");
  }

  const openPendingEdit = useCallback((candidate: EnrichedCandidate) => {
    const logs = latestLogsForCandidate(data, candidate.candidate_id);
    const active = activeProcessStage(logs);
    if (!active) return;
    const pending = logs.find((row) => row.stage_instance_id === active.stageInstanceId);
    if (!pending || !candidatePipelineCapability(candidate, logs, data.profile).canWrite) {
      showUpdateDenial("This pending stage is outside your update responsibility.");
      return;
    }
    setProcessDefaults({ candidate_id: candidate.candidate_id, recruitment_process: active.stage, round: active.round, pending_log_id: active.pendingLogId, stage_instance_id: active.stageInstanceId, expected_updated_at: active.updatedAt, pending_log_date: pending.log_date, pending_estimated_action_date: pending.estimated_action_date, pending_interviewer: pending.interviewer, pending_remark: pending.remark });
    setActiveModal("pending_edit");
  }, [data]);

  function openPipelineRecordCorrection(candidate: EnrichedCandidate, log: RecruitmentLog) {
    if (!data.profile || !["system_admin", "admin_recruiter"].includes(data.profile.role)) return;
    setProcessDefaults({
      candidate_id: candidate.candidate_id,
      recruitment_process: log.recruitment_process,
      round: log.round,
      stage_instance_id: log.stage_instance_id ?? String(log.log_id),
      expected_updated_at: log.updated_at ?? log.created_at,
      pending_log_date: log.log_date,
      pending_estimated_action_date: log.estimated_action_date,
      pending_interviewer: log.interviewer,
      pending_remark: log.remark,
      outcome_result: log.result === null ? null : log.result === 1 ? "pass" : "fail",
      outcome_date: log.outcome_date,
      outcome_interviewer: log.outcome_interviewer,
      outcome_remark: log.outcome_remark
    });
    setActiveModal("pipeline_record_correction");
  }

  function openStageOutcome(candidate: EnrichedCandidate, outcome: "pass" | "fail") {
    const logs = latestLogsForCandidate(data, candidate.candidate_id);
    const active = activeProcessStage(logs);
    if (!active || !candidatePipelineCapability(candidate, logs, data.profile).canWrite) return;
    const nextIndex = ACTIVE_PIPELINE_STAGES.indexOf(active.stage) + 1;
    const nextStage = outcome === "pass" && active.stage !== "Offer" ? ACTIVE_PIPELINE_STAGES[nextIndex] : undefined;
    const pending = logs.find((row) => row.stage_instance_id === active.stageInstanceId);
    setProcessDefaults({ candidate_id: candidate.candidate_id, recruitment_process: active.stage, round: active.round, pending_log_id: active.pendingLogId, stage_instance_id: active.stageInstanceId, expected_updated_at: active.updatedAt, pending_log_date: pending?.log_date, pending_estimated_action_date: pending?.estimated_action_date, pending_interviewer: pending?.interviewer, pending_remark: pending?.remark, outcome, target_stage: nextStage, source: "pipeline" });
    setActiveModal("stage_outcome");
  }

  function openMaintainTest(candidate: EnrichedCandidate) {
    const logs = latestLogsForCandidate(data, candidate.candidate_id);
    const blockedReason = processUpdateBlockReason(logs);
    if (blockedReason) {
      showUpdateDenial(blockedReason);
      return;
    }
    const active = activeProcessStage(logs);
    const pending = active ? logs.find((row) => row.stage_instance_id === active.stageInstanceId) : null;
    if (candidate.latest_process !== "Test" || !active || !pending) return;
    setProcessDefaults({ candidate_id: candidate.candidate_id, recruitment_process: "Test", round: active.round, pending_log_id: pending.log_id, stage_instance_id: active.stageInstanceId, expected_updated_at: active.updatedAt, pending_log_date: pending.log_date, pending_estimated_action_date: pending.estimated_action_date, pending_interviewer: pending.interviewer, pending_remark: pending.remark, outcome: "pass", target_stage: "Test", current_round: active.round });
    setActiveModal("stage_outcome");
  }

  function openOfferUpdate(candidate: EnrichedCandidate) {
    if (candidate.latest_process !== "Offer") return;
    const active = activeProcessStage(latestLogsForCandidate(data, candidate.candidate_id));
    if (active) openStageOutcome(candidate, "pass");
  }

  function openInitialProcessUpdate(candidate: EnrichedCandidate) {
    if (!candidate.first_contact_date) {
      showUpdateDenial("Add First Contact Date in Candidate Detail before starting Phone Screen.");
      return;
    }
    setProcessDefaults({
      candidate_id: candidate.candidate_id,
      recruitment_process: "Phone Screen",
      pending_log_date: candidate.first_contact_date,
      pending_remark: "Started from pipeline no-activity lane"
    });
    setActiveModal("pipeline_start");
  }

  const openProcessFromDetail = useCallback((candidateId: string) => {
    const candidate = enrichedCandidates.find((row) => row.candidate_id === candidateId);
    if (!candidate) return;
    if (candidate.latest_process === "No activity") {
      openInitialProcessUpdate(candidate);
      return;
    }
    setDetail(null);
    router.push(`/pipeline?pipelineSearch=${encodeURIComponent(candidateId)}&detailType=candidate&detailId=${encodeURIComponent(candidateId)}`);
  }, [enrichedCandidates, router]);

  const openDetailRequisitionChange = useCallback((docId: string) => {
    setModalDefaults({ mode: "change", selectedId: docId });
    setActiveModal("requisition");
  }, []);

  const openDetailCandidateChange = useCallback((candidateId: string) => {
    setModalDefaults({ mode: "change", selectedId: candidateId });
    setActiveModal("candidate");
  }, []);

  const openCandidateReference = useCallback((candidateId: string, referenceId?: string) => {
    const reference = data.candidate_references.find((row) => row.reference_id === referenceId);
    setProcessDefaults({
      candidate_id: candidateId,
      reference_id: reference?.reference_id,
      reference_expected_updated_at: reference?.updated_at,
      reference_name: reference?.reference_name,
      reference_relationship: reference?.relationship,
      reference_channel_type: reference?.channel_type,
      reference_channel_value: reference?.channel_value,
      reference_other_channel_label: reference?.other_channel_label
    });
    setActiveModal("candidate_reference");
  }, [data.candidate_references]);

  const openCandidateReferenceStatus = useCallback((candidateId: string, referenceId: string) => {
    const reference = data.candidate_references.find((row) => row.reference_id === referenceId);
    if (!reference) return;
    setProcessDefaults({ candidate_id: candidateId, reference_id: reference.reference_id, reference_expected_updated_at: reference.updated_at, reference_status: reference.status, reference_status_reason: reference.status_reason });
    setActiveModal("reference_status");
  }, [data.candidate_references]);

  const openCandidateReferenceCheck = useCallback((candidateId: string, referenceId: string) => {
    const check = data.candidate_reference_checks.find((row) => row.reference_id === referenceId);
    setProcessDefaults({ candidate_id: candidateId, reference_id: referenceId, reference_check_expected_updated_at: check?.updated_at, reference_checked_date: check?.checked_date, reference_duration_minutes: check?.duration_minutes, reference_conversation_summary: check?.conversation_summary });
    setActiveModal("reference_check");
  }, [data.candidate_reference_checks]);

  function dispatchWorkspaceAction(request: WorkspaceActionRequest) {
    if (request.kind === "record.open") {
      setDetail({ type: request.entity, id: request.id });
      return;
    }
    if (!canWrite) {
      showUpdateDenial("Read-only access: your role cannot update recruitment records.");
      return;
    }
    if ((request.kind === "group.create" || request.kind === "group.match") && !canManageSetup) {
      showUpdateDenial("Your role cannot change sourcing group setup.");
      return;
    }
    if (request.kind === "requisition.create") {
      setModalDefaults({ mode: "new" });
      setActiveModal("requisition");
      return;
    }
    if (request.kind === "requisition.edit") {
      setModalDefaults({ mode: "change", selectedId: request.docId });
      setActiveModal("requisition");
      return;
    }
    if (request.kind === "requisition.status") {
      setModalDefaults({ selectedId: request.docId });
      setActiveModal("status");
      return;
    }
    if (request.kind === "group.create") {
      const requisition = data.requisitions.find((row) => row.doc_id === request.docId);
      setGuideContext({ doc_id: request.docId, position: requisition?.position, level: requisition?.level, site: requisition?.site, person_in_charge: requisition?.person_in_charge ?? undefined });
      setGuideStep(request.docId ? "create_group" : null);
      setModalDefaults({ mode: "new", group_position: requisition?.position ?? "" });
      setActiveModal("group_match");
      return;
    }
    if (request.kind === "group.match") {
      setGuideContext({ doc_id: request.docId, group_id: request.groupId });
      setGuideStep("add_match");
      setModalDefaults({ doc_id: request.docId, group_id: request.groupId ?? "" });
      setActiveModal("match");
      return;
    }
    if (request.kind === "sourcing.update") {
      if (request.payload) {
        prepareRpcAction("app_upsert_sourcing_weekly_update", request.payload, `sourcing update - ${request.groupId}`);
      } else {
        pushWorkspaceUrlState({ section: "sourcing", focusType: "sourcing", focusId: request.groupId });
      }
      return;
    }
    if (request.kind === "candidate.create") {
      const eligibleGroupIds = [...new Set(data.document_groups.filter((row) => request.docGroupIds.includes(row.doc_group_id)).map((row) => row.group_id).filter((groupId): groupId is string => Boolean(groupId)))];
      setModalDefaults({ mode: "new", group_id: eligibleGroupIds[0], eligible_group_ids: eligibleGroupIds, lock_group_id: eligibleGroupIds.length === 1, first_contact_date: today() });
      setActiveModal("candidate");
      return;
    }
    if (request.kind === "candidate.process") {
      const candidate = enrichedCandidates.find((row) => row.candidate_id === request.candidateId);
      if (!candidate) {
        showUpdateDenial("Candidate not found in this workspace.");
        return;
      }
      if (request.intent === "start") openInitialProcessUpdate(candidate);
      else if (request.intent === "maintain_test") openMaintainTest(candidate);
      else if (request.intent === "update_offer") openOfferUpdate(candidate);
      else if (request.intent === "manual") openProcessFromDetail(candidate.candidate_id);
      else {
        const currentIndex = ACTIVE_PIPELINE_STAGES.indexOf(candidate.latest_process as ProcessStage);
        const targetStage = request.targetStage ?? ACTIVE_PIPELINE_STAGES[currentIndex + 1];
        if (targetStage) openProcessForMove(candidate, targetStage);
      }
      return;
    }
    if (request.kind === "offer.upsert") {
      const candidate = enrichedCandidates.find((row) => row.candidate_id === request.candidateId);
      const candidateDocId = request.docId
        ?? selectedWorkspaceDocId
        ?? data.document_groups.find((row) => row.group_id === candidate?.group_id)?.doc_id;
      const proposedAcceptedDate = request.proposedAcceptedDate
        ?? latestSuccessfulOfferPassDate(request.candidateId ?? "", data.recruitment_logs)
        ?? undefined;
      setModalDefaults({
        mode: request.offerId ? "change" : "new",
        selectedId: request.offerId ? String(request.offerId) : "",
        candidate_id: request.candidateId,
        doc_id: candidateDocId,
        accepted_date: proposedAcceptedDate,
        offer_candidate_ids: initialView === "workspace" ? workspaceScope.candidates.map((row) => row.candidate_id) : undefined,
        offer_doc_ids: initialView === "workspace" ? workspaceScope.requisitions.map((row) => row.doc_id) : undefined
      });
      setActiveModal("offer");
    }
  }

  function prepareAction(modal: Exclude<ModalName, null>, form: HTMLFormElement) {
    const formData = new FormData(form);
    const payload = buildPayload(modal, formData);
    const actionPayload = payload as Record<string, unknown>;
    if (modal === "candidate") validateCandidatePayload(payload, language);
    const summary = buildSummary(modal, payload);
    const endpoint = modal === "user"
      ? "/api/admin/users"
      : rpcByModal[modal];

    setPendingAction({
      title: "Confirm Save",
      summary,
      endpoint,
      payload: actionPayload,
      modal,
      route: modal === "user" ? "api" : "rpc"
    });
  }

  function prepareRpcAction(endpoint: string, payload: Record<string, unknown>, summary: string) {
    setPendingAction({
      title: "Confirm Save",
      summary,
      endpoint,
      payload,
      route: "rpc"
    });
  }

  async function confirmPendingAction() {
    if (!pendingAction || !supabase) return;

    const savedAction = pendingAction;
    setBusy(true);
    setStatus("Saving...");
    try {
      let result: RpcResult = { ok: true };
      if (pendingAction.route === "api") {
        const session = await supabase.auth.getSession();
        const response = await fetch(pendingAction.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.data.session?.access_token ?? ""}`
          },
          body: JSON.stringify(pendingAction.payload)
        });
        result = (await response.json()) as RpcResult;
        if (!response.ok || result.error) throw new Error(result.error ?? "User creation failed.");
      } else {
        const { data: rpcResult, error: rpcError } = await supabase.rpc(pendingAction.endpoint, { payload: pendingAction.payload });
        if (rpcError) throw new Error(rpcError.message);
        result = (rpcResult ?? { ok: true }) as RpcResult;
      }

      setPendingAction(null);
      setActiveModal(null);
      setProcessDefaults({});
      setModalDefaults({});
      const reloadedData = await loadData();
      const handoff = offerPassHandoffFromResult(result, reloadedData ?? data);
      if (handoff) {
        setOfferPassHandoff(handoff);
        setStatus("Offer stage passed. Review and create the offer record when ready.");
      } else {
        const guideContinued = continueGuideAfterSave(savedAction, result);
        if (!guideContinued) setStatus("Saved successfully.");
      }
    } catch (saveError) {
      setPendingAction(null);
      showUpdateDenial(saveError instanceof Error ? saveError.message : translate(language, "updateDeniedFallback"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDestructiveAction() {
    if (!destructiveAction || !supabase) return;

    const savedAction = destructiveAction;
    setBusy(true);
    setStatus(translate(language, "destructiveActionRunning"));
    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(savedAction.endpoint, { payload: savedAction.payload });
      if (rpcError) throw new Error(rpcError.message);
      const result = (rpcResult ?? { ok: true }) as RpcResult;
      if (result.error) throw new Error(result.error);

      setDestructiveAction(null);
      const entity = valueAsString(savedAction.payload.entity);
      const id = valueAsString(savedAction.payload.id);
      if ((entity === "requisition" && detail?.type === "requisition" && detail.id === id)
        || (entity === "candidate" && detail?.type === "candidate" && detail.id === id)) {
        setDetail(null);
      }
      if (entity === "position_group" && workspaceTarget.type === "group" && workspaceTarget.id === id) {
        setWorkspaceTarget({ type: null, id: null });
        pushWorkspaceUrlState({ type: null, id: null, doc: null, section: "overview", focusType: null, focusId: null });
      }
      await loadData();
      setStatus(translate(language, "destructiveActionSucceeded"));
    } catch (saveError) {
      setDestructiveAction(null);
      showUpdateDenial(saveError instanceof Error ? saveError.message : translate(language, "destructiveActionFailed"));
    } finally {
      setBusy(false);
    }
  }

  function continueGuideAfterSave(action: PendingAction, result: RpcResult) {
    const modal = action.modal;
    const payload = action.payload;
    const resultId = typeof result.id === "string" ? result.id : undefined;

    if (modal === "requisition" && payload.mode === "new") {
      const createdDocId = resultId ?? valueAsString(payload.doc_id);
      setWorkspaceTarget({ type: "requisition", id: createdDocId });
      pushWorkspaceUrlState({ type: "requisition", id: createdDocId, section: "overview", doc: null, focusType: null, focusId: null });
      setGuideContext({
        doc_id: createdDocId,
        position: valueAsString(payload.position),
        level: valueAsString(payload.level) || null,
        department: valueAsString(payload.department),
        site: valueAsString(payload.site),
        person_in_charge: valueAsString(payload.person_in_charge)
      });
      setGuideStep("source_candidates");
      setStatus("Requisition saved. Continue with sourcing setup.");
      return true;
    }

    if (modal === "group_match") {
      const groupId = resultId ?? valueAsString(payload.group_id);
      if (groupId) openWorkspaceGroupAfterSetup(groupId, null);
      clearGuide();
      setStatus("Group created and linked. Opening its sourcing workspace.");
      return true;
    }

    if (modal === "match") {
      const groupId = valueAsString(payload.group_id);
      const docId = valueAsString(payload.doc_id);
      if (groupId && docId) openWorkspaceGroupAfterSetup(groupId, docId);
      clearGuide();
      setStatus("Group linked. Opening its sourcing workspace.");
      return true;
    }

    if (modal === "candidate" && guideStep === "create_candidate") {
      if (resultId) pushWorkspaceUrlState({ section: "pipeline", focusType: "candidate", focusId: resultId });
      clearGuide();
      setStatus("Candidate created and linked to the requisition group.");
      return true;
    }

    return false;
  }

  function openWorkspaceGroupAfterSetup(groupId: string, docId: string | null) {
    if (initialView === "workspace") setWorkspaceTarget({ type: "group", id: groupId });
    const docQuery = docId ? `&doc=${encodeURIComponent(docId)}` : "";
    const section = docId ? "sourcing" : "overview";
    const path = `/workspace?type=group&id=${encodeURIComponent(groupId)}${docQuery}&section=${section}`;
    router.push(buildContextualHref(path, { language, site: filters.site, owner: filters.owner, sourcingWeek }));
  }

  function openOfferFromHandoff() {
    if (!offerPassHandoff) return;
    const groupId = data.document_groups.find((row) => row.doc_id === offerPassHandoff.docId)?.group_id ?? null;
    const defaults = {
      candidate_id: offerPassHandoff.candidateId,
      doc_id: offerPassHandoff.docId,
      accepted_date: offerPassHandoff.passedDate,
      offer_candidate_ids: initialView === "workspace" ? workspaceScope.candidates.map((row) => row.candidate_id) : undefined,
      offer_doc_ids: initialView === "workspace" ? workspaceScope.requisitions.map((row) => row.doc_id) : undefined
    };
    const handoff = offerPassHandoff;
    setOfferPassHandoff(null);
    if (initialView === "workspace") {
      if (groupId) setWorkspaceTarget({ type: "group", id: groupId });
      pushWorkspaceUrlState({ type: groupId ? "group" : "requisition", id: groupId ?? handoff.docId, doc: groupId ? handoff.docId : null, section: "offer", focusType: null, focusId: null });
      setModalDefaults({ mode: "new", ...defaults });
      setActiveModal("offer");
      return;
    }
    const path = `/workspace?type=${groupId ? "group" : "requisition"}&id=${encodeURIComponent(groupId ?? handoff.docId)}${groupId ? `&doc=${encodeURIComponent(handoff.docId)}` : ""}&section=offer&offerCandidate=${encodeURIComponent(handoff.candidateId)}&offerDate=${encodeURIComponent(handoff.passedDate)}`;
    router.push(buildContextualHref(path, { language, site: filters.site, owner: filters.owner, sourcingWeek }));
  }

  const navigationContext = useMemo(
    () => ({ language, site: filters.site, owner: filters.owner, sourcingWeek }),
    [filters.owner, filters.site, language, sourcingWeek]
  );
  const prepareDestructiveRpcAction = useCallback((endpoint: string, payload: Record<string, unknown>, summary: string) => {
    setDestructiveAction({
      title: translate(language, "confirmDestructiveAction"),
      summary,
      endpoint,
      payload
    });
  }, [language]);
  const openDetailOffer = useCallback((offer: Offer) => {
    setModalDefaults({ mode: "change", selectedId: String(offer.offer_id), candidate_id: offer.candidate_id, doc_id: offer.doc_id });
    setActiveModal("offer");
  }, []);
  const detailBody = useMemo(
    () => buildDetailBodyV2(detail, data, language, canWrite, canDeleteRecords, openProcessFromDetail, openPendingEdit, openDetailOffer, (offer) => { setProcessDefaults({ offer_id: offer.offer_id, offer_expected_updated_at: offer.updated_at, offer_start_confirmation: offer.start_confirmation }); setActiveModal("start_confirmation"); }, navigationContext, openDetailRequisitionChange, openDetailCandidateChange, openCandidateReference, openCandidateReferenceStatus, openCandidateReferenceCheck, prepareDestructiveRpcAction),
    [canDeleteRecords, canWrite, detail, data, language, navigationContext, openCandidateReference, openCandidateReferenceCheck, openCandidateReferenceStatus, openDetailCandidateChange, openDetailRequisitionChange, openDetailOffer, openPendingEdit, openProcessFromDetail, prepareDestructiveRpcAction]
  );

  if (!hasSupabaseConfig) {
    return (
      <main className="grid min-h-screen place-items-center bg-offwhite p-6">
        <Panel className="max-w-xl">
          <h1 className="mb-2 text-2xl font-semibold text-navy">Supabase configuration required</h1>
          <p className="text-sm font-bold text-slate">Create `.env.local` from `.env.example`, then set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.</p>
        </Panel>
      </main>
    );
  }

  if (workspaceLoadState !== "ready") {
    const stateMessages: Record<WorkspaceLoadState, { title: string; message: string }> = {
      checking_session: {
        title: translate(language, "checkingSession"),
        message: translate(language, "checkingSessionMessage")
      },
      loading_data: {
        title: translate(language, "loadingRecruitmentRecords"),
        message: translate(language, "loadingRecruitmentRecordsMessage")
      },
      redirecting_to_login: {
        title: translate(language, "signInRequired"),
        message: translate(language, "redirectingToLoginMessage")
      },
      error: {
        title: translate(language, "couldNotLoadRecruitmentRecords"),
        message: error ?? translate(language, "refreshAndTryAgain")
      },
      ready: {
        title: translate(language, "recruitmentRecordsLoaded"),
        message: translate(language, "workspaceReady")
      }
    };
    const state = stateMessages[workspaceLoadState];
    return (
      <WorkspaceStatusScreen
        title={state.title}
        message={state.message}
        busy={workspaceLoadState === "checking_session" || workspaceLoadState === "loading_data" || workspaceLoadState === "redirecting_to_login"}
        loginHref={workspaceLoadState === "checking_session" || workspaceLoadState === "redirecting_to_login" ? "/login" : undefined}
        onRetry={workspaceLoadState === "error" ? loadData : undefined}
      />
    );
  }

  const loadedStatus = translate(language, "recruitmentRecordsLoaded");
  const showOperationalStatus = !loading && !busy && !error && status !== "Recruitment records loaded." && status !== loadedStatus;

  return (
    <AppShell
      activeView={initialView}
      headerControls={(
        <>
          <CommandSelector ariaLabel={translate(language, "site")} density="compact" emptyLabel={translate(language, "allSites")} options={[{ value: "", label: translate(language, "allSites") }, ...siteOptions.map((value) => ({ value, label: value }))]} value={filters.site} onValueChange={(value) => setFilters((old) => ({ ...old, site: value }))} className="w-full min-w-[8.5rem] sm:w-36" />
          <CommandSelector ariaLabel={translate(language, "personInCharge")} density="compact" emptyLabel={translate(language, "allOwners")} options={[{ value: "", label: translate(language, "allOwners") }, ...ownerOptions.map((value) => ({ value, label: value }))]} value={filters.owner} onValueChange={(value) => setFilters((old) => ({ ...old, owner: value }))} className="w-full min-w-[11rem] sm:w-48" />
        </>
      )}
      language={language}
      navigationContext={navigationContext}
      profile={data.profile}
      onLanguageChange={() => setLanguage((current) => (current === "en" ? "th" : "en"))}
      onRefresh={loadData}
      onSignOut={signOut}
    >
      {loading || busy || error || showOperationalStatus ? (
        <StatusBanner
          busy={loading || busy}
          tone={error ? "error" : loading || busy ? "loading" : "info"}
          message={loading ? translate(language, "loadingRecruitmentRecordsEllipsis") : error ?? status}
        />
      ) : null}

      {initialView === "home" ? (
        <HomeView language={language} profile={data.profile} requisitions={filteredRequisitions} candidates={filteredCandidates} offers={filteredOffers} recruitmentLogs={data.recruitment_logs} staleSourcingGroups={staleSourcingGroups} changeLogs={filteredChangeLogs} dataQualityIssues={dataQualityIssues} canViewRecentActivity={canWrite} onConfirmStart={(offer) => { setProcessDefaults({ offer_id: offer.offer_id, offer_expected_updated_at: offer.updated_at, offer_start_confirmation: offer.start_confirmation }); setActiveModal("start_confirmation"); }} onEditPending={openPendingEdit} onOpenRequisition={(id) => setDetail({ type: "requisition", id })} onOpenCandidate={(id) => setDetail({ type: "candidate", id })} />
      ) : null}

      {initialView === "dashboard" ? (
        <VacancyWaterfallView
          language={language}
          data={dashboardReportData}
          requisitions={dashboardRequisitions}
          offers={dashboardOffers}
        />
      ) : null}

      {initialView === "workspace" ? (
        <HiringWorkspaceView
          canManageSetup={canManageSetup}
          canWrite={canWrite}
          data={data}
          language={language}
          siteFilter={filters.site}
          ownerFilter={filters.owner}
          onDispatchAction={dispatchWorkspaceAction}
          offerSlot={(
            <WorkspaceOfferSection
              allOffers={data.offers}
              candidates={workspaceScope.candidates}
              canWrite={canWrite}
              offers={workspaceScope.offers}
              profile={data.profile}
              requisitions={workspaceScope.requisitions}
              onAction={dispatchWorkspaceAction}
              onOpenCandidate={(id) => setDetail({ type: "candidate", id })}
              onOpenRequisition={(id) => setDetail({ type: "requisition", id })}
            />
          )}
          pipelineSlot={(
            <PipelineBoardView
              embedded
              canWrite={canWrite}
              dataQualityIssues={dataQualityIssues}
              language={language}
              profile={data.profile}
              recruitmentLogs={data.recruitment_logs}
              candidateReferences={data.candidate_references}
              candidateReferenceChecks={data.candidate_reference_checks}
              rows={workspaceScope.candidates}
              offeredCandidateIds={offeredCandidateIds}
              onNewCandidate={eligibleCandidateGroups(data, data.profile, workspaceScope.groupIds).length > 0 ? () => dispatchWorkspaceAction({ kind: "candidate.create", docGroupIds: eligibleCandidateGroups(data, data.profile, workspaceScope.groupIds).flatMap((group) => data.document_groups.filter((match) => match.group_id === group.group_id).slice(0, 1).map((match) => match.doc_group_id)) }) : undefined}
              onOpen={(id) => setDetail({ type: "candidate", id })}
              onMove={openProcessForMove}
              onFailCurrentStage={(candidate) => openStageOutcome(candidate, "fail")}
              onMaintainTest={openMaintainTest}
              onStartProcess={openInitialProcessUpdate}
              onEditPending={openPendingEdit}
              onPassStage={(candidate) => openStageOutcome(candidate, "pass")}
              onManageReferenceChecks={(candidate) => setDetail({ type: "candidate", id: candidate.candidate_id })}
              onCreateOffer={(candidate) => dispatchWorkspaceAction({ kind: "offer.upsert", candidateId: candidate.candidate_id })}
              onUpdateOffer={openOfferUpdate}
            />
          )}
          profile={data.profile}
          selectedGroupDocId={selectedWorkspaceDocId}
          sourcingSlot={(
            <EmbeddedSourcingEditor
              canManageSetup={canManageSetup}
              canWrite={canWrite}
              data={data}
              docIds={workspaceScope.requisitions.map((row) => row.doc_id)}
              groupIds={workspaceScope.groupIds}
              language={language}
              profile={data.profile}
              siteFilter={filters.site}
              ownerFilter={filters.owner}
              weekStart={sourcingWeek}
              onSaveSourcing={(payload, summary) => prepareRpcAction("app_upsert_sourcing_weekly_update", payload, summary)}
              onUpdateGroupInfo={(payload, summary) => prepareRpcAction("app_update_sourcing_group_info_v1", payload, summary)}
              onSetGroupChannel={(payload, summary) => prepareRpcAction("app_set_sourcing_group_channel_v1", payload, summary)}
              onUnmatchGroupRequisition={(payload, summary) => prepareDestructiveRpcAction("app_unmatch_group_requisition", payload, summary)}
              onDeleteGroup={(payload, summary) => prepareDestructiveRpcAction("app_delete_recruitment_record", payload, summary)}
              onAddGroupRequisition={(groupId, docId) => prepareRpcAction("app_create_group_match", { group_id: groupId, doc_id: docId }, `Match sourcing group ${groupId} to requisition ${docId}`)}
              onWeekChange={setSourcingWeek}
            />
          )}
          target={workspaceTarget}
          weekStart={sourcingWeek}
          onOpenCandidate={(id) => setDetail({ type: "candidate", id })}
          onOpenRequisition={(id) => setDetail({ type: "requisition", id })}
        />
      ) : null}

      {initialView === "requisitions" ? (
        <RequisitionsView language={language} rows={filteredRequisitions} candidates={filteredCandidates} profile={data.profile} canWrite={canWrite} onNew={() => setActiveModal("requisition")} onStatus={() => setActiveModal("status")} onOpen={(id) => setDetail({ type: "requisition", id })} />
      ) : null}

      {initialView === "candidates" ? (
        <CandidatesView language={language} rows={filteredCandidates} profile={data.profile} canWrite={canWrite} onNew={() => setActiveModal("candidate")} onOpen={(id) => setDetail({ type: "candidate", id })} />
      ) : null}

      {initialView === "pipeline" ? (
        <PipelineBoardView language={language} rows={filteredCandidates} recruitmentLogs={data.recruitment_logs} recruitmentLogHistory={data.recruitment_log_history} candidateReferences={data.candidate_references} candidateReferenceChecks={data.candidate_reference_checks} profile={data.profile} dataQualityIssues={dataQualityIssues} canWrite={canWrite} offeredCandidateIds={offeredCandidateIds} onNewCandidate={() => setActiveModal("candidate")} onOpen={(id) => setDetail({ type: "candidate", id })} onMove={openProcessForMove} onFailCurrentStage={(candidate) => openStageOutcome(candidate, "fail")} onMaintainTest={openMaintainTest} onStartProcess={openInitialProcessUpdate} onEditPending={openPendingEdit} onPassStage={(candidate) => openStageOutcome(candidate, "pass")} onManageReferenceChecks={(candidate) => setDetail({ type: "candidate", id: candidate.candidate_id })} onCreateOffer={(candidate) => dispatchWorkspaceAction({ kind: "offer.upsert", candidateId: candidate.candidate_id })} onUpdateOffer={openOfferUpdate} onEditCandidate={openDetailCandidateChange} onCorrectPipelineRecord={openPipelineRecordCorrection} />
      ) : null}

      {initialView === "offers" ? <OffersView language={language} rows={filteredOffers} allOffers={data.offers} requisitions={filteredRequisitions} profile={data.profile} canWrite={canWrite} onNew={() => setActiveModal("offer")} onOpenCandidate={(id) => setDetail({ type: "candidate", id })} /> : null}

      {initialView === "sourcing" ? (
        <SourcingView
          language={language}
          data={data}
          profile={data.profile}
          siteFilter={filters.site}
          ownerFilter={filters.owner}
          canWrite={canWrite}
          canManageSetup={canManageSetup}
          onCreateGroup={() => {
            clearGuide();
            setModalDefaults({ mode: "new" });
            setActiveModal("group_match");
          }}
          onLinkGroup={(groupId) => dispatchWorkspaceAction({ kind: "group.match", docId: "", groupId })}
          weekStart={sourcingWeek}
          onWeekChange={setSourcingWeek}
          onSaveSourcing={(payload, summary) => prepareRpcAction("app_upsert_sourcing_weekly_update", payload, summary)}
          onUpdateGroupInfo={(payload, summary) => prepareRpcAction("app_update_sourcing_group_info_v1", payload, summary)}
          onSetGroupChannel={(payload, summary) => prepareRpcAction("app_set_sourcing_group_channel_v1", payload, summary)}
          onUnmatchGroupRequisition={(payload, summary) => prepareDestructiveRpcAction("app_unmatch_group_requisition", payload, summary)}
          onDeleteGroup={(payload, summary) => prepareDestructiveRpcAction("app_delete_recruitment_record", payload, summary)}
          onAddGroupRequisition={(groupId, docId) => prepareRpcAction("app_create_group_match", { group_id: groupId, doc_id: docId }, `Match sourcing group ${groupId} to requisition ${docId}`)}
        />
      ) : null}

      {initialView === "admin" ? <AdminView language={language} data={data} canManageUsers={canManageUsers} onInvite={() => setActiveModal("user")} /> : null}

      {initialView === "audit" ? <AuditView language={language} rows={data.change_logs} /> : null}

      <RecordModal
        modal={activeModal}
        language={language}
        data={data}
        profile={data.profile}
        canManageUsers={canManageUsers}
        processDefaults={processDefaults}
        modalDefaults={modalDefaults}
        onClose={closeRecordModal}
        onSubmit={prepareAction}
        onValidationError={showUpdateDenial}
      />

      <GuidePrompt
        language={language}
        step={guideStep}
        context={guideContext}
        onCreateGroup={openGuidedGroup}
        onCreateCandidate={openGuidedCandidate}
        onLater={clearGuide}
      />

      <WelcomeBackPrompt
        language={language}
        open={welcomeOpen}
        profile={data.profile}
        summary={welcomeSummary}
        onClose={closeWelcomeSummary}
        onPipeline={openWelcomePipeline}
      />

      <ConfirmModal
        language={language}
        action={pendingAction}
        busy={busy}
        onClose={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />

      <DestructiveConfirmModal
        language={language}
        action={destructiveAction}
        busy={busy}
        onClose={() => setDestructiveAction(null)}
        onConfirm={confirmDestructiveAction}
      />

      <UpdateDeniedModal language={language} reason={updateDenial} onClose={() => setUpdateDenial(null)} />

      <OfferPassHandoffPrompt
        handoff={offerPassHandoff}
        language={language}
        onCreateOffer={openOfferFromHandoff}
        onStay={() => setOfferPassHandoff(null)}
      />

      <Drawer
        open={Boolean(detail)}
        eyebrow={detail?.type === "candidate" ? "Candidate Detail" : "Requisition Detail"}
        title={detailBody.title}
        headerMeta={detailBody.headerMeta}
        headerActions={detailBody.headerActions}
        inactive={Boolean(activeModal || pendingAction || destructiveAction || offerPassHandoff)}
        onClose={() => setDetail(null)}
      >
        {detailBody.body}
      </Drawer>
    </AppShell>
  );
}

function buildPayload(modal: Exclude<ModalName, null>, formData: FormData) {
  if (modal === "requisition") {
    const payload = {
      mode: String(formData.get("mode") ?? "new"),
      doc_id: emptyToNull(formData.get("doc_id")),
      pr_approved_date: emptyToNull(formData.get("pr_approved_date")),
      site: emptyToNull(formData.get("site")),
      position: emptyToNull(formData.get("position")),
      department: emptyToNull(formData.get("department")),
      section: emptyToNull(formData.get("section")),
      level: emptyToNull(formData.get("level")),
      head_count: asNumber(formData.get("head_count"), 1),
      person_in_charge: emptyToNull(formData.get("person_in_charge")),
      line_manager: emptyToNull(formData.get("line_manager")),
      request_type: String(formData.get("request_type") ?? "New"),
      replacement_names: replacementNamesPayload(formData),
      status: String(formData.get("status") ?? "ongoing") as RequisitionStatus
    };
    requireFields(payload, ["doc_id", "site", "position", "department", "head_count"]);
    if (payload.request_type === "Replacement" && !payload.replacement_names) {
      throw new Error("At least one replacement name is required for replacement requisitions.");
    }
    return payload;
  }

  if (modal === "status") {
    const payload = {
      doc_id: emptyToNull(formData.get("doc_id")),
      log_date: emptyToNull(formData.get("log_date")),
      status: String(formData.get("status") ?? "ongoing"),
      remark: emptyToNull(formData.get("remark"))
    };
    requireFields(payload, ["doc_id", "log_date", "status"]);
    return payload;
  }

  if (modal === "candidate") {
    const channel = emptyToNull(formData.get("channel"));
    const referenceNames = formData.getAll("candidate_reference_name");
    const references = referenceNames.map((value, index) => ({
      reference_name: emptyToNull(value),
      relationship: emptyToNull(formData.getAll("candidate_reference_relationship")[index]),
      channel_type: emptyToNull(formData.getAll("candidate_reference_channel_type")[index]),
      channel_value: emptyToNull(formData.getAll("candidate_reference_channel_value")[index]),
      other_channel_label: emptyToNull(formData.getAll("candidate_reference_other_channel_label")[index])
    }));
    for (const reference of references) {
      requireFields(reference, ["reference_name", "relationship", "channel_type", "channel_value"]);
      if (reference.channel_type === "other" && !reference.other_channel_label) throw new Error("Other channel requires its label.");
    }
    const payload = {
      mode: String(formData.get("mode") ?? "new"),
      candidate_id: emptyToNull(formData.get("candidate_id")),
      name: emptyToNull(formData.get("name")),
      nickname: emptyToNull(formData.get("nickname")),
      phone_no: emptyToNull(formData.get("phone_no")),
      email: emptyToNull(formData.get("email")),
      group_id: emptyToNull(formData.get("group_id")),
      channel,
      ref_name: channel === "Referral" ? emptyToNull(formData.get("ref_name")) : null,
      first_contact_date: emptyToNull(formData.get("first_contact_date")),
      candidate_folder_url: emptyToNull(formData.get("candidate_folder_url")),
      references
    };
    return payload;
  }

  if (modal === "candidate_reference") {
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      reference_id: emptyToNull(formData.get("reference_id")),
      expected_updated_at: emptyToNull(formData.get("expected_updated_at")),
      reference_name: emptyToNull(formData.get("reference_name")),
      relationship: emptyToNull(formData.get("relationship")),
      channel_type: emptyToNull(formData.get("channel_type")),
      channel_value: emptyToNull(formData.get("channel_value")),
      other_channel_label: emptyToNull(formData.get("other_channel_label"))
    };
    requireFields(payload, ["candidate_id", "reference_name", "relationship", "channel_type", "channel_value"]);
    if (payload.channel_type === "other" && !payload.other_channel_label) throw new Error("Other channel requires its label.");
    return payload;
  }

  if (modal === "reference_status") {
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      reference_id: emptyToNull(formData.get("reference_id")),
      expected_updated_at: emptyToNull(formData.get("expected_updated_at")),
      status: emptyToNull(formData.get("reference_status")),
      reason: emptyToNull(formData.get("reference_status_reason"))
    };
    requireFields(payload, ["candidate_id", "reference_id", "expected_updated_at", "status"]);
    if (payload.status !== "available" && !payload.reason) throw new Error("Unavailable and archived references require a reason.");
    return payload;
  }

  if (modal === "reference_check") {
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      reference_id: emptyToNull(formData.get("reference_id")),
      expected_updated_at: emptyToNull(formData.get("expected_updated_at")),
      checked_date: emptyToNull(formData.get("checked_date")),
      duration_minutes: asNumber(formData.get("duration_minutes"), 0),
      conversation_summary: emptyToNull(formData.get("conversation_summary"))
    };
    requireFields(payload, ["candidate_id", "reference_id", "checked_date", "duration_minutes", "conversation_summary"]);
    if (payload.duration_minutes <= 0) throw new Error("Conversation duration must be greater than zero minutes.");
    return payload;
  }

  if (modal === "pipeline_start") {
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      pending: {
        opened_date: emptyToNull(formData.get("opened_date")),
        estimated_action_date: emptyToNull(formData.get("estimated_action_date")),
        interviewer: emptyToNull(formData.get("interviewer")),
        remark: emptyToNull(formData.get("remark"))
      }
    };
    requireFields(payload, ["candidate_id"]);
    if (!payload.pending.opened_date) throw new Error("Pending date is required.");
    return payload;
  }

  if (modal === "pending_edit") {
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      stage_instance_id: emptyToNull(formData.get("stage_instance_id")),
      expected_updated_at: emptyToNull(formData.get("expected_updated_at")),
      pending: { opened_date: emptyToNull(formData.get("opened_date")), estimated_action_date: emptyToNull(formData.get("estimated_action_date")), interviewer: emptyToNull(formData.get("interviewer")), remark: emptyToNull(formData.get("remark")) }
    };
    requireFields(payload, ["candidate_id", "stage_instance_id", "expected_updated_at"]);
    if (!payload.pending.opened_date) throw new Error("Pending date is required.");
    return payload;
  }

  if (modal === "stage_outcome") {
    const outcome = String(formData.get("outcome") ?? "") as "pass" | "fail";
    const currentStage = emptyToNull(formData.get("current_stage")) as ProcessStage | null;
    const selectedTargetStage = emptyToNull(formData.get("target_stage"));
    const targetStage = selectedTargetStage ?? (outcome === "pass" && currentStage && currentStage !== "Offer"
      ? ACTIVE_PIPELINE_STAGES[ACTIVE_PIPELINE_STAGES.indexOf(currentStage) + 1] ?? null
      : null);
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      stage_instance_id: emptyToNull(formData.get("stage_instance_id")),
      expected_updated_at: emptyToNull(formData.get("expected_updated_at")),
      pending: { opened_date: emptyToNull(formData.get("pending_opened_date")), estimated_action_date: emptyToNull(formData.get("pending_estimated_action_date")), interviewer: emptyToNull(formData.get("pending_interviewer")), remark: emptyToNull(formData.get("pending_remark")) },
      outcome: {
        result: outcome,
        date: emptyToNull(formData.get("outcome_date")),
        interviewer: emptyToNull(formData.get("outcome_interviewer")),
        remark: emptyToNull(formData.get("outcome_remark"))
      },
      next_pending: targetStage ? {
        stage: targetStage,
        round: asNumber(formData.get("next_round"), 1),
        estimated_action_date: emptyToNull(formData.get("next_estimated_action_date")),
        interviewer: emptyToNull(formData.get("next_interviewer")),
        remark: emptyToNull(formData.get("next_remark"))
      } : null
    };
    requireFields(payload, ["candidate_id", "stage_instance_id", "expected_updated_at"]);
    if (!payload.pending.opened_date || !payload.outcome.date) throw new Error("A pass requires an outcome date.");
    return payload;
  }

  if (modal === "pipeline_pass") {
    const stageCount = asNumber(formData.get("stage_count"), 0);
    const candidateId = emptyToNull(formData.get("candidate_id"));
    const stages = Array.from({ length: stageCount }, (_, index) => ({
      stage: emptyToNull(formData.get(`stage_${index}`)),
      round: asNumber(formData.get(`round_${index}`), 1),
      pending: { opened_date: emptyToNull(formData.get(`pending_date_${index}`)), estimated_action_date: emptyToNull(formData.get(`pending_estimated_action_date_${index}`)), interviewer: emptyToNull(formData.get(`pending_interviewer_${index}`)), remark: emptyToNull(formData.get(`pending_remark_${index}`)) },
      outcome: { result: "pass" as const, date: emptyToNull(formData.get(`outcome_date_${index}`)), interviewer: emptyToNull(formData.get(`outcome_interviewer_${index}`)), remark: emptyToNull(formData.get(`outcome_remark_${index}`)) }
    }));
    const targetStage = emptyToNull(formData.get("target_stage"));
    const targetPending = {
      stage: targetStage,
      round: asNumber(formData.get("target_pending_round"), 1),
      opened_date: emptyToNull(formData.get("target_pending_opened_date")),
      estimated_action_date: emptyToNull(formData.get("target_pending_estimated_action_date")),
      interviewer: emptyToNull(formData.get("target_pending_interviewer")),
      remark: emptyToNull(formData.get("target_pending_remark"))
    };
    const payload = {
      candidate_id: candidateId,
      current_stage_instance_id: emptyToNull(formData.get("current_stage_instance_id")),
      expected_updated_at: emptyToNull(formData.get("expected_updated_at")),
      passed_stages: stages,
      target_pending: targetPending
    };
    requireFields(payload, ["candidate_id", "current_stage_instance_id", "expected_updated_at"]);
    if (stages.length === 0 || stages.some((stage) => !stage.stage || !stage.pending.opened_date || !stage.outcome.date || !stage.round)) {
      throw new Error("Every crossed stage needs a stage, result date, and round.");
    }
    if (!targetPending.stage || !targetPending.opened_date) throw new Error("The target pending stage needs an opened date.");
    return payload;
  }

  if (modal === "offer") {
    const payload = {
      mode: String(formData.get("mode") ?? "new"),
      candidate_id: emptyToNull(formData.get("candidate_id")),
      doc_id: emptyToNull(formData.get("doc_id")),
      accepted_date: emptyToNull(formData.get("accepted_date")),
      first_working_date: emptyToNull(formData.get("first_working_date")),
      remark: emptyToNull(formData.get("remark"))
    };
    requireFields(payload, ["candidate_id", "doc_id"]);
    return payload;
  }

  if (modal === "group") {
    const channelPayload = Object.fromEntries(
      SOURCING_CHANNELS.map((channel) => [channel.enabled, boolFromForm(formData.get(channel.enabled))])
    );
    const payload = {
      mode: String(formData.get("mode") ?? "new"),
      group_id: emptyToNull(formData.get("group_id")),
      group_position: emptyToNull(formData.get("group_position")),
      ...channelPayload
    };
    requireFields(payload, ["group_position"]);
    return payload;
  }

  if (modal === "start_confirmation") {
    const payload = { offer_id: asNumber(formData.get("offer_id"), 0), expected_updated_at: emptyToNull(formData.get("expected_updated_at")), start_confirmation: emptyToNull(formData.get("start_confirmation")), reason: emptyToNull(formData.get("reason")) };
    requireFields(payload, ["offer_id", "expected_updated_at", "start_confirmation"]);
    if (payload.start_confirmation === "did_not_start" && !payload.reason) throw new Error("Did not start requires a reason.");
    return payload;
  }

  if (modal === "pipeline_record_correction") {
    const outcomeResult = emptyToNull(formData.get("outcome_result"));
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      stage_instance_id: emptyToNull(formData.get("stage_instance_id")),
      expected_updated_at: emptyToNull(formData.get("expected_updated_at")),
      pending: { opened_date: emptyToNull(formData.get("opened_date")), estimated_action_date: emptyToNull(formData.get("estimated_action_date")), interviewer: emptyToNull(formData.get("interviewer")), remark: emptyToNull(formData.get("remark")) },
      outcome: outcomeResult ? { result: outcomeResult, date: emptyToNull(formData.get("outcome_date")), interviewer: emptyToNull(formData.get("outcome_interviewer")), remark: emptyToNull(formData.get("outcome_remark")) } : undefined
    };
    requireFields(payload, ["candidate_id", "stage_instance_id", "expected_updated_at"]);
    if (!payload.pending.opened_date || (outcomeResult && !payload.outcome?.date)) throw new Error("Pending and completed outcome dates are required.");
    return payload;
  }

  if (modal === "group_match") {
    const channelPayload = Object.fromEntries(
      SOURCING_CHANNELS.map((channel) => [channel.enabled, boolFromForm(formData.get(channel.enabled))])
    );
    const payload = {
      doc_ids: formData.getAll("doc_ids").map((value) => String(value).trim()).filter(Boolean),
      group_position: emptyToNull(formData.get("group_position")),
      ...channelPayload
    };
    requireFields(payload, ["group_position"]);
    if (payload.doc_ids.length === 0) throw new Error("Select at least one requisition to link.");
    return payload;
  }

  if (modal === "match") {
    const payload = {
      doc_id: emptyToNull(formData.get("doc_id")),
      group_id: emptyToNull(formData.get("group_id"))
    };
    requireFields(payload, ["doc_id", "group_id"]);
    return payload;
  }

  if (modal === "snapshot") {
    const payload = {
      week_start: emptyToNull(formData.get("week_start")),
      waterfall_category: emptyToNull(formData.get("waterfall_category")),
      site: emptyToNull(formData.get("site")),
      request_type: emptyToNull(formData.get("request_type")),
      vacancy_count: asNumber(formData.get("vacancy_count"), 0)
    };
    requireFields(payload, ["week_start", "waterfall_category", "site", "request_type"]);
    return payload;
  }

  const payload = {
    mode: String(formData.get("mode") ?? "new"),
    user_id: emptyToNull(formData.get("user_id")),
    email: emptyToNull(formData.get("email")),
    password: emptyToNull(formData.get("password")),
    full_name: emptyToNull(formData.get("full_name")),
    nickname: emptyToNull(formData.get("nickname")),
    site: emptyToNull(formData.get("site")),
    role: String(formData.get("role") ?? "viewer")
  };
  requireFields(payload, payload.mode === "change" ? ["user_id", "nickname", "role"] : ["email", "password", "nickname", "role"]);
  return payload;
}

function replacementNamesPayload(formData: FormData) {
  if (String(formData.get("request_type") ?? "New") !== "Replacement") return null;
  const names = formData
    .getAll("replacement_names")
    .map((value) => String(value).trim())
    .filter(Boolean);
  return names.length > 0 ? names.join("\n") : null;
}

function validateCandidatePayload(payload: Record<string, unknown>, language: Language) {
  const requiredFields = [
    ...(valueAsString(payload.mode) === "change" ? ["candidate_id"] : []),
    "name",
    ...(valueAsString(payload.mode) === "change" ? ["phone_no"] : []),
    "group_id",
    "channel",
    "first_contact_date",
    ...(valueAsString(payload.channel) === "Referral" ? ["ref_name"] : [])
  ];
  const missing = requiredFields.filter((field) => !valueAsString(payload[field]));
  if (missing.length > 0) {
    throw new Error(translate(language, "candidateRequiredFieldsMissing", {
      fields: missing.map((field) => candidateRequiredFieldLabel(language, field)).join(", ")
    }));
  }

  const firstContactDate = valueAsString(payload.first_contact_date);
  if (!isIsoDateInput(firstContactDate)) {
    throw new Error(translate(language, "candidateFirstContactDateInvalid"));
  }

  const phoneNo = valueAsString(payload.phone_no);
  if (phoneNo && !/^0[0-9]{9}$/.test(phoneNo)) {
    throw new Error(translate(language, "candidatePhoneInvalid"));
  }
  const email = valueAsString(payload.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(translate(language, "candidateEmailInvalid"));
  }

}

function candidateRequiredFieldLabel(language: Language, field: string) {
  const labels: Record<string, string> = {
    candidate_id: translate(language, "candidateId"),
    name: translate(language, "name"),
    phone_no: translate(language, "phoneNo"),
    email: translate(language, "email"),
    group_id: translate(language, "groupId"),
    channel: translate(language, "channel"),
    first_contact_date: translate(language, "firstContactDate"),
    ref_name: translate(language, "referenceName")
  };
  return labels[field] ?? field;
}

function isIsoDateInput(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateProcessUpdatePayload(data: DashboardData, payload: Record<string, unknown>) {
  const candidateId = valueAsString(payload.candidate_id);
  const selectedStage = valueAsString(payload.recruitment_process) as ProcessStage;
  const selectedResult = valueAsString(payload.result) || null;
  const logs = latestLogsForCandidate(data, candidateId);
  const blockedReason = processUpdateBlockReason(logs);
  if (blockedReason) throw new Error(blockedReason);

  const allowedStages = availableProcessUpdateStages(logs);
  if (!allowedStages.includes(selectedStage)) {
    throw new Error("Cannot update to a previous pipeline stage.");
  }
  const latest = logs[0];
  if (!latest) {
    if (selectedStage !== "Phone Screen" || selectedResult !== null) {
      throw new Error("A candidate with no activity must start with Phone Screen as a pending stage.");
    }
    return;
  }
  if (latest.result === null) {
    if (selectedStage !== latest.recruitment_process || selectedResult === null) {
      throw new Error("Complete the current pending stage with a result before opening a later stage.");
    }
    return;
  }
  if (latest.result === 1 && selectedResult !== null) {
    throw new Error("Open the next stage as pending before recording its result.");
  }
}

function processUpdateBlockReason(logs: RecruitmentLog[]) {
  if (candidateHasHistoricalFail(logs)) return "Pipeline update unavailable because this candidate has a failed stage.";
  if (candidatePassedAllPipelineStages(logs)) return "Pipeline update unavailable because this candidate completed all stages.";
  return "";
}

function availableProcessUpdateStages(logs: RecruitmentLog[]): ProcessStage[] {
  const blockedReason = processUpdateBlockReason(logs);
  if (blockedReason) return [];
  const latest = logs[0];
  if (!latest) return ["Phone Screen"];
  if (latest.result === null) return [latest.recruitment_process];
  const latestIndex = PROCESS_UPDATE_STAGES.indexOf(latest.recruitment_process);
  const nextStage = PROCESS_UPDATE_STAGES[latestIndex + 1];
  return nextStage ? [nextStage] : [];
}

function latestRoundForStage(logs: RecruitmentLog[], stage: ProcessStage) {
  return logs
    .filter((log) => log.recruitment_process === stage)
    .reduce((maxRound, log) => Math.max(maxRound, log.round ?? 1), 0);
}

function candidateHasHistoricalFail(logs: RecruitmentLog[]) {
  return logs.some((log) => log.result === 0);
}

function candidatePassedAllPipelineStages(logs: RecruitmentLog[]) {
  return ACTIVE_PIPELINE_STAGES.every((stage) =>
    logs.some((log) => log.recruitment_process === stage && log.result === 1)
  );
}

function buildSummary(modal: Exclude<ModalName, null>, payload: Record<string, unknown>) {
  const key = String(payload.doc_id ?? payload.candidate_id ?? payload.group_id ?? payload.target_stage ?? payload.email ?? payload.user_id ?? "record");
  return `${modal} · ${key}`;
}

function valueAsString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function RecordModal({
  modal,
  language,
  data,
  profile,
  canManageUsers,
  processDefaults,
  modalDefaults,
  onClose,
  onSubmit,
  onValidationError
}: {
  modal: ModalName;
  language: Language;
  data: DashboardData;
  profile: DashboardData["profile"];
  canManageUsers: boolean;
  processDefaults: ProcessDefaults;
  modalDefaults: ModalDefaults;
  onClose: () => void;
  onSubmit: (modal: Exclude<ModalName, null>, form: HTMLFormElement) => void;
  onValidationError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"new" | "change">("new");
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    setMode(modalDefaults.mode ?? "new");
    setSelectedId(modalDefaults.selectedId ?? processDefaults.candidate_id ?? "");
  }, [modal, modalDefaults.mode, modalDefaults.selectedId, processDefaults.candidate_id]);

  if (!modal) return null;
  const selectedRecords = selectedModalRecords(data, selectedId);
  function handleModeChange(nextMode: "new" | "change") {
    setMode(nextMode);
    setSelectedId("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onSubmit(modal as Exclude<ModalName, null>, event.currentTarget);
    } catch (error) {
      onValidationError(error instanceof Error ? error.message : "Form validation failed.");
    }
  }

  return (
    <Modal closeLabel={translate(language, "close")} open={Boolean(modal)} title={modalDialogTitle(language, modal, mode)} onClose={onClose}>
      <form key={`${modal}-${mode}-${selectedId}`} className="grid gap-4" onSubmit={handleSubmit}>
        {["requisition", "candidate", "offer", "group", "user"].includes(modal) ? <ModeRow mode={mode} onModeChange={handleModeChange} /> : null}
        {modal === "requisition" ? <RequisitionFields data={data} language={language} profile={profile} mode={mode} selectedId={selectedId} selected={selectedRecords.requisition} onSelect={setSelectedId} /> : null}
        {modal === "status" ? <StatusFields data={data} language={language} selectedId={selectedId} selected={selectedRecords.requisition} onSelect={setSelectedId} /> : null}
        {modal === "candidate" ? <CandidatePrefillFields data={data} language={language} profile={profile} mode={mode} selectedId={selectedId} selected={selectedRecords.candidate} defaults={modalDefaults} onSelect={setSelectedId} /> : null}
        {modal === "candidate_reference" ? <CandidateReferenceFields defaults={processDefaults} language={language} /> : null}
        {modal === "reference_status" ? <CandidateReferenceStatusFields defaults={processDefaults} language={language} /> : null}
        {modal === "reference_check" ? <CandidateReferenceCheckFields defaults={processDefaults} language={language} /> : null}
        {modal === "pipeline_start" ? <PipelineStartFields defaults={processDefaults} language={language} /> : null}
        {modal === "pending_edit" ? <PendingEditFields defaults={processDefaults} language={language} /> : null}
        {modal === "pipeline_record_correction" ? <PipelineRecordCorrectionFields canEditPendingDate={data.profile?.role === "system_admin"} defaults={processDefaults} language={language} /> : null}
        {modal === "stage_outcome" ? <StageOutcomeFields defaults={processDefaults} language={language} /> : null}
        {modal === "pipeline_pass" ? <PipelinePassFields data={data} defaults={processDefaults} language={language} /> : null}
        {modal === "offer" ? <OfferPrefillFields data={data} language={language} mode={mode} selectedId={selectedId} selected={selectedRecords.offer} defaults={modalDefaults} onSelect={setSelectedId} /> : null}
        {modal === "start_confirmation" ? <StartConfirmationFields defaults={processDefaults} language={language} /> : null}
        {modal === "group" ? <GroupPrefillFields data={data} language={language} mode={mode} selectedId={selectedId} selected={selectedRecords.group} defaults={modalDefaults} onSelect={setSelectedId} /> : null}
        {modal === "group_match" ? <CreateAndMatchGroupFields data={data} defaults={modalDefaults} language={language} profile={profile} /> : null}
        {modal === "match" ? <MatchFields data={data} defaults={modalDefaults} language={language} /> : null}
        {modal === "snapshot" ? <SnapshotFields data={data} language={language} /> : null}
        {modal === "user" ? <UserPrefillFields canManageUsers={canManageUsers} data={data} language={language} mode={mode} selectedId={selectedId} selected={selectedRecords.profile} onSelect={setSelectedId} /> : null}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-[#D7DEE8] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4">
          <Button type="button" variant="secondary" className="min-h-11 flex-1 sm:flex-none" onClick={onClose}>{translate(language, "cancel")}</Button>
          <Button type="submit" className="min-h-11 flex-1 sm:flex-none">{translate(language, "reviewChanges")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function selectedModalRecords(data: DashboardData, selectedId: string) {
  return {
    requisition: data.requisitions.find((row) => row.doc_id === selectedId) ?? null,
    candidate: data.candidates.find((row) => row.candidate_id === selectedId) ?? null,
    offer: data.offers.find((row) => String(row.offer_id) === selectedId) ?? null,
    group: data.position_groups.find((row) => row.group_id === selectedId) ?? null,
    profile: data.profiles.find((row) => row.id === selectedId) ?? null
  };
}

function optionLabel(parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

function requisitionOptionLabel(row: DashboardData["requisitions"][number]) {
  return formatRequisitionOptionLabel(row);
}

function candidateOptionLabel(row: DashboardData["candidates"][number]) {
  return optionLabel([row.candidate_id, formatCandidateName(row)]);
}

function documentGroupOptionLabel(row: DashboardData["document_groups"][number]) {
  return optionLabel([row.doc_group_id, row.group_position]);
}

function positionGroupOptionLabel(row: DashboardData["position_groups"][number]) {
  return optionLabel([row.group_id, row.group_position]);
}

function offerOptionLabel(data: DashboardData, offer: DashboardData["offers"][number]) {
  const candidate = data.candidates.find((row) => row.candidate_id === offer.candidate_id);
  return optionLabel([offer.candidate_id, candidate?.name, offer.doc_id]);
}

function userOptionLabel(profile: DashboardData["profiles"][number], language: Language = "en") {
  return optionLabel([profile.nickname ?? profile.full_name ?? profile.email ?? profile.id, roleLabel(language, profile.role)]);
}

function ModeRow({
  mode,
  onModeChange
}: {
  mode: "new" | "change";
  onModeChange: (mode: "new" | "change") => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-navy">
      <label className="flex items-center gap-2"><input type="radio" name="mode" value="new" checked={mode === "new"} onChange={() => onModeChange("new")} /> New</label>
      <label className="flex items-center gap-2"><input type="radio" name="mode" value="change" checked={mode === "change"} onChange={() => onModeChange("change")} /> Change</label>
    </div>
  );
}

function RequisitionFields({
  data,
  language,
  profile,
  mode,
  selectedId,
  selected,
  onSelect
}: {
  data: DashboardData;
  language: Language;
  profile: DashboardData["profile"];
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["requisitions"][number] | null;
  onSelect: (value: string) => void;
}) {
  const isSiteRecruiter = profile?.role === "site_recruiter";
  const forceAssignedScope = isSiteRecruiter && mode === "new";
  const nickname = profile?.nickname ?? profile?.full_name ?? "";
  const assignedSite = profile?.site ?? "";
  const personOptions = recruiterNicknameOptions(data.profiles);
  const siteValue = forceAssignedScope ? assignedSite : selected?.site;
  const ownerValue = forceAssignedScope ? nickname : selected?.person_in_charge;
  const initialSiteValue = siteValue ?? "";
  const [requestType, setRequestType] = useState<RequisitionRequestType>(selected?.request_type ?? "New");
  const [headCount, setHeadCount] = useState(Math.max(1, selected?.head_count ?? 1));
  const [replacementNames, setReplacementNames] = useState(() => replacementNamesForHeadcount(splitReplacementNames(selected?.replacement_names), selected?.head_count ?? 1));
  const [selectedSite, setSelectedSite] = useState(initialSiteValue);
  const [departmentValue, setDepartmentValue] = useState(selected?.department ?? "");
  const [sectionValue, setSectionValue] = useState(selected?.section ?? "");
  const [departmentSectionRows, setDepartmentSectionRows] = useState<DepartmentSectionRow[]>([]);
  const departmentSelectOptions = useMemo(
    () => appendLegacyOption(departmentOptions(departmentSectionRows, language, selectedSite), selected?.department),
    [departmentSectionRows, language, selected?.department, selectedSite]
  );
  const sectionSelectOptions = useMemo(
    () => appendLegacyOption(sectionOptionsForDepartment(departmentSectionRows, language, selectedSite, departmentValue), selected?.section),
    [departmentSectionRows, departmentValue, language, selected?.section, selectedSite]
  );

  useEffect(() => {
    setRequestType(selected?.request_type ?? "New");
    const nextHeadCount = Math.max(1, selected?.head_count ?? 1);
    setHeadCount(nextHeadCount);
    setReplacementNames(replacementNamesForHeadcount(splitReplacementNames(selected?.replacement_names), nextHeadCount));
    setSelectedSite(initialSiteValue);
    setDepartmentValue(selected?.department ?? "");
    setSectionValue(selected?.section ?? "");
  }, [initialSiteValue, selected?.department, selected?.doc_id, selected?.head_count, selected?.replacement_names, selected?.request_type, selected?.section]);

  function changeRequestType(nextRequestType: RequisitionRequestType) {
    setRequestType(nextRequestType);
    if (nextRequestType === "Replacement") setReplacementNames((names) => replacementNamesForHeadcount(names, headCount));
  }

  function changeHeadCount(rawValue: string) {
    const nextHeadCount = Math.max(1, Number.parseInt(rawValue, 10) || 1);
    if (requestType === "Replacement" && nextHeadCount < replacementNames.length) {
      const removedCount = replacementNames.length - nextHeadCount;
      if (!window.confirm(translate(language, "confirmReplacementTrim", { count: removedCount }))) return;
      setReplacementNames((names) => names.slice(0, nextHeadCount));
    } else if (requestType === "Replacement" && nextHeadCount > replacementNames.length) {
      setReplacementNames((names) => replacementNamesForHeadcount(names, nextHeadCount));
    }
    setHeadCount(nextHeadCount);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/department-sections")
      .then((response) => response.ok ? response.json() : [])
      .then((rows: DepartmentSectionRow[]) => {
        if (active) setDepartmentSectionRows(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setDepartmentSectionRows([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={translate(language, "docId")}>
        {mode === "change" ? (
          <SelectInput name="doc_id" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">{translate(language, "selectRequisitionOption")}</option>
            {data.requisitions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}
          </SelectInput>
        ) : (
          <TextInput name="doc_id" list="doc-id-options" required placeholder={translate(language, "requisitionDocIdPlaceholder")} />
        )}
      </Field>
      <Field label={translate(language, "prApprovedDate")}><DayDateSelector ariaLabel={translate(language, "prApprovedDate")} language={language} name="pr_approved_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} defaultValue={selected?.pr_approved_date ?? ""} /></Field>
      <Field label={translate(language, "requestType")}>
        <CreateSelectInput name="request_type" value={requestType} onChange={(event) => changeRequestType(event.target.value as RequisitionRequestType)}>
          <option value="New">{requestTypeLabel(language, "New")}</option>
          <option value="Replacement">{requestTypeLabel(language, "Replacement")}</option>
        </CreateSelectInput>
      </Field>
      <Field label={translate(language, "site")}>
        {forceAssignedScope ? <input type="hidden" name="site" value={assignedSite} /> : null}
        <CreateSelectInput
          name={forceAssignedScope ? undefined : "site"}
          required
          value={selectedSite}
          disabled={isSiteRecruiter}
          onChange={(event) => {
            setSelectedSite(event.target.value);
            setDepartmentValue("");
            setSectionValue("");
          }}
        >
          <option value="">{translate(language, "selectSite")}</option>
          {SITE_OPTIONS.map((site) => <option key={site} value={site}>{site}</option>)}
        </CreateSelectInput>
      </Field>
      <Field label={translate(language, "department")}>
        <CreateSelectInput
          name="department"
          required
          value={departmentValue}
          disabled={!selectedSite || departmentSelectOptions.length === 0}
          onChange={(event) => {
            setDepartmentValue(event.target.value);
            setSectionValue("");
          }}
        >
          <option value="">{selectedSite ? translate(language, "selectDepartment") : translate(language, "selectSite")}</option>
          {departmentSelectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </CreateSelectInput>
      </Field>
      <Field label={translate(language, "section")}>
        <CreateSelectInput
          name="section"
          value={sectionValue}
          onChange={(event) => setSectionValue(event.target.value)}
          disabled={!departmentValue || sectionSelectOptions.length === 0}
        >
          <option value="">{departmentValue ? translate(language, "selectSection") : translate(language, "selectDepartmentFirst")}</option>
          {sectionSelectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </CreateSelectInput>
      </Field>
      <Field label={translate(language, "position")}><TextInput name="position" list="position-options" required defaultValue={selected?.position ?? ""} /></Field>
      <Field label={translate(language, "levelL")}>
        <CreateSelectInput name="level" defaultValue={selected?.level ?? ""}>
          <option value="">{translate(language, "selectLevel")}</option>
          {Array.from({ length: 15 }, (_, level) => <option key={level} value={String(level)}>{level}</option>)}
        </CreateSelectInput>
      </Field>
      <Field label={translate(language, "headCount")}><TextInput name="head_count" type="number" min={1} value={headCount} onChange={(event) => changeHeadCount(event.target.value)} required /></Field>
      <Field label={translate(language, "personInCharge")}>
        {forceAssignedScope ? <input type="hidden" name="person_in_charge" value={nickname} /> : null}
        <CreateSelectInput name={forceAssignedScope ? undefined : "person_in_charge"} defaultValue={ownerValue ?? ""} disabled={isSiteRecruiter}>
          <option value="">{translate(language, "unassigned")}</option>
          {personOptions.map((person) => <option key={person} value={person}>{person}</option>)}
        </CreateSelectInput>
      </Field>
      <Field label={translate(language, "lineManager")}><TextInput name="line_manager" list="manager-options" placeholder={mode === "new" ? translate(language, "lineManagerPlaceholder") : undefined} defaultValue={selected?.line_manager ?? ""} /></Field>
      <Field label={translate(language, "status")}>
        <SelectInput name="status" defaultValue={selected?.status === "filled" ? "ongoing" : selected?.status ?? "ongoing"}>{WRITABLE_REQUISITION_STATUSES.map((status) => <option key={status} value={status}>{requisitionStatusLabel(language, status)}</option>)}</SelectInput>
      </Field>
      {requestType === "Replacement" ? (
        <div className="grid gap-2 md:col-span-2">
          <div><span className="text-sm font-bold text-navy">{translate(language, "replacementNames")}</span><p className="mt-1 text-xs text-slate">{translate(language, "replacementNamesMatchHeadcount", { count: headCount })}</p></div>
          <div className="grid gap-2">
            {replacementNames.map((name, index) => (
              <TextInput
                key={index}
                name="replacement_names"
                required
                placeholder={translate(language, "replacementName", { index: index + 1 })}
                value={name}
                onChange={(event) => setReplacementNames((names) => names.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
              />
            ))}
          </div>
        </div>
      ) : null}
      <DataLists data={data} />
    </div>
  );
}

function StatusFields({
  data,
  language,
  selectedId,
  selected,
  onSelect
}: {
  data: DashboardData;
  language: Language;
  selectedId: string;
  selected: DashboardData["requisitions"][number] | null;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={translate(language, "docId")}><SelectInput name="doc_id" required value={selectedId} onChange={(event) => onSelect(event.target.value)}><option value="">{translate(language, "selectRequisitionOption")}</option>{data.requisitions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label={translate(language, "date")}><TextInput name="log_date" type="date" required defaultValue={today()} /></Field>
      <Field label={translate(language, "status")}><SelectInput name="status" defaultValue={selected?.status ?? "ongoing"}>{["ongoing", "filled", "cancel"].map((status) => <option key={status} value={status}>{requisitionStatusLabel(language, status)}</option>)}</SelectInput></Field>
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="remark" rows={3} /></Field>
    </div>
  );
}

function splitReplacementNames(value: string | null | undefined) {
  const names = (value ?? "")
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? names : [""];
}

function replacementNamesForHeadcount(names: string[], headCount: number) {
  const requiredCount = Math.max(1, headCount);
  if (names.length >= requiredCount) return names;
  return [...names, ...Array.from({ length: requiredCount - names.length }, () => "")];
}

function CandidateFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Candidate ID"><SelectInput name="candidate_id"><option value="">Auto in New mode</option>{data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label="Name"><TextInput name="name" required /></Field>
      <Field label="Phone No."><TextInput name="phone_no" /></Field>
      <Field label="Group ID"><SelectInput name="doc_group_id" required>{data.document_groups.map((row) => <option key={row.doc_group_id} value={row.doc_group_id}>{documentGroupOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label="Channel"><TextInput name="channel" list="channel-options" /></Field>
      <Field label="Reference Name"><TextInput name="ref_name" list="ref-options" /></Field>
      <Field label="First Contact Date"><TextInput name="first_contact_date" type="date" /></Field>
      <Field label="Candidate Folder Link" className="md:col-span-2"><TextInput name="candidate_folder_url" type="url" /></Field>
      <DataLists data={data} />
    </div>
  );
}

function ProcessFields({ data, defaults }: { data: DashboardData; defaults: ProcessDefaults }) {
  const candidate = data.candidates.find((row) => row.candidate_id === defaults.candidate_id);
  const logs = candidate ? latestLogsForCandidate(data, candidate.candidate_id) : [];
  const latest = logs[0];
  const blockedReason = processUpdateBlockReason(logs);
  const availableStages = availableProcessUpdateStages(logs);
  const defaultStage = defaults.recruitment_process ?? latest?.recruitment_process;
  const processValue = availableStages.includes(defaultStage as ProcessStage) ? defaultStage : availableStages[0] ?? "";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="source" value={defaults.source ?? "manual"} />
      <Field label="Candidate"><SelectInput name="candidate_id" required defaultValue={defaults.candidate_id}>{data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label="Date"><TextInput name="log_date" type="date" defaultValue={today()} required /></Field>
      {blockedReason ? <p className="rounded-md bg-lightgray p-3 text-sm font-medium text-orange md:col-span-2">{blockedReason}</p> : null}
      <Field label="Process">
        <SelectInput name="recruitment_process" required defaultValue={processValue} disabled={availableStages.length === 0}>
          {availableStages.length === 0 ? <option value="">No process update available</option> : null}
          {availableStages.map((stage) => <option key={stage} value={stage}>{processLabel(stage)}</option>)}
        </SelectInput>
      </Field>
      <Field label="Round"><TextInput name="round" type="number" min={1} defaultValue={defaults.round ?? 1} required /></Field>
      <Field label="Interviewer"><TextInput name="interviewer" list="interviewer-options" /></Field>
      <Field label="Result"><SelectInput name="result" defaultValue={defaults.result ?? ""}><option value="">Pending</option><option value="1">Pass</option><option value="0">Fail</option></SelectInput></Field>
      <Field label="Remark" className="md:col-span-2"><TextArea name="remark" rows={3} defaultValue={defaults.remark ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function eligibleCandidateGroups(data: DashboardData, profile: DashboardData["profile"], limitIds?: readonly string[]) {
  const requisitions = new Map(enrichRequisitions(data).map((row) => [row.doc_id, row]));
  const allowedIds = limitIds ? new Set(limitIds) : null;
  return data.position_groups.filter((group) => {
    if (allowedIds && !allowedIds.has(group.group_id)) return false;
    return data.document_groups.some((match) => match.group_id === group.group_id && (() => {
      const requisition = requisitions.get(match.doc_id);
      return Boolean(requisition && requisition.status === "ongoing" && requisition.open_headcount > 0 && siteRecruiterCanManageRequisition(requisition, profile));
    })());
  });
}

function CandidatePrefillFields({
  data,
  language,
  profile,
  mode,
  selectedId,
  selected,
  defaults,
  onSelect
}: {
  data: DashboardData;
  language: Language;
  profile: DashboardData["profile"];
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["candidates"][number] | null;
  defaults: ModalDefaults;
  onSelect: (value: string) => void;
}) {
  const groupValue = mode === "new" ? defaults.group_id ?? "" : selected?.group_id ?? "";
  const firstContactDate = mode === "new" ? defaults.first_contact_date ?? "" : selected?.first_contact_date ?? "";
  const [selectedGroupId, setSelectedGroupId] = useState(groupValue);
  const [selectedChannel, setSelectedChannel] = useState(selected?.channel ?? "");
  const [referenceRows, setReferenceRows] = useState<number[]>([]);
  const [referenceChannelTypes, setReferenceChannelTypes] = useState<Record<number, string>>({});
  const eligibleGroups = useMemo(
    () => mode === "new" ? eligibleCandidateGroups(data, profile, defaults.eligible_group_ids) : data.position_groups,
    [data, defaults.eligible_group_ids, mode, profile]
  );
  const availableChannels = useMemo(() => sourcingChannelsForGroup(data, selectedGroupId), [data, selectedGroupId]);
  const showReferenceName = selectedChannel === "Referral";

  useEffect(() => {
    setSelectedGroupId(groupValue);
    setSelectedChannel(selected?.channel ?? "");
    setReferenceRows([]);
    setReferenceChannelTypes({});
  }, [groupValue, selected?.channel]);

  useEffect(() => {
    if (selectedChannel && !availableChannels.some((channel) => channel.label === selectedChannel)) {
      setSelectedChannel("");
    }
  }, [availableChannels, selectedChannel]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={translate(language, "candidateId")}>
        {mode === "change" ? (
          <SelectInput name="candidate_id" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">{translate(language, "selectCandidateOption")}</option>
            {data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}
          </SelectInput>
        ) : (
          <SelectInput name="candidate_id"><option value="">{translate(language, "autoInNewMode")}</option>{data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}</SelectInput>
        )}
      </Field>
      <Field label={translate(language, "name")}><TextInput name="name" required placeholder={translate(language, "candidateNamePlaceholder")} defaultValue={selected?.name ?? ""} /></Field>
      <Field label={translate(language, "nickname")}><TextInput name="nickname" defaultValue={selected?.nickname ?? ""} /></Field>
      <Field label={translate(language, "phoneNo")}><TextInput name="phone_no" type="tel" inputMode="numeric" maxLength={10} pattern="0[0-9]{9}" required={mode === "change"} placeholder={translate(language, "candidatePhonePlaceholder")} defaultValue={selected?.phone_no ?? ""} /></Field>
      <Field label={translate(language, "email")}><TextInput name="email" type="text" inputMode="email" autoComplete="email" placeholder={translate(language, "candidateEmailPlaceholder")} defaultValue={selected?.email ?? ""} /></Field>
      <Field label={translate(language, "groupId")}>
        <CreateSelectInput name="group_id" required value={selectedGroupId} disabled={mode === "new" && (defaults.lock_group_id || eligibleGroups.length === 0)} onChange={(event) => setSelectedGroupId(event.target.value)}>
          <option value="">{eligibleGroups.length === 0 ? translate(language, "noEligibleGroups") : translate(language, "selectGroup")}</option>
          {eligibleGroups.map((row) => <option key={row.group_id} value={row.group_id}>{positionGroupOptionLabel(row)}</option>)}
        </CreateSelectInput>
        {mode === "new" && defaults.lock_group_id ? <span className="text-xs font-medium text-slate">{translate(language, "groupLockedToWorkspace")}</span> : null}
      </Field>
      <Field label={translate(language, "channel")}>
        <CreateSelectInput name="channel" required value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value)} disabled={!selectedGroupId || availableChannels.length === 0}>
          <option value="">{availableChannels.length === 0 ? translate(language, "noSourcingChannelsForGroup") : translate(language, "selectChannel")}</option>
          {availableChannels.map((channel) => <option key={channel.enabled} value={channel.label}>{channel.label}</option>)}
        </CreateSelectInput>
      </Field>
      {showReferenceName ? (
        <Field label={translate(language, "referenceName")}><TextInput name="ref_name" required list="ref-options" defaultValue={selected?.ref_name ?? ""} /></Field>
      ) : null}
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray/60 p-3 md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-sm font-semibold text-navy">{translate(language, "contactReferences")} <span className="font-medium text-slate">({translate(language, "optional")})</span></p><p className="mt-1 text-xs font-medium text-slate">{translate(language, "contactReferencesHelper")}</p></div>
          <Button type="button" size="icon-sm" variant="secondary" icon={<Plus size={17} />} aria-label={translate(language, "addReference")} title={translate(language, "addReference")} onClick={() => setReferenceRows((rows) => [...rows, (rows.at(-1) ?? -1) + 1])} />
        </div>
        {referenceRows.length > 0 ? <div className="mt-3 grid gap-3">{referenceRows.map((row) => {
          const channelType = referenceChannelTypes[row] ?? "phone";
          return <div key={row} className="grid gap-3 rounded-md border border-[#D7DEE8] bg-white p-3 md:grid-cols-2">
            <div className="flex items-center justify-between gap-2 md:col-span-2"><p className="text-xs font-semibold text-slate">{translate(language, "referenceNumber", { number: row + 1 })}</p><Button type="button" size="icon-sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" icon={<X size={16} />} aria-label={translate(language, "remove")} title={translate(language, "remove")} onClick={() => setReferenceRows((rows) => rows.filter((value) => value !== row))} /></div>
            <Field label={translate(language, "referenceContactName")}><TextInput name="candidate_reference_name" required /></Field>
            <Field label={translate(language, "relationship")}><TextInput name="candidate_reference_relationship" required /></Field>
            <Field label={translate(language, "channel")}><SelectInput name="candidate_reference_channel_type" value={channelType} onChange={(event) => setReferenceChannelTypes((current) => ({ ...current, [row]: event.target.value }))}><option value="phone">{translate(language, "referenceChannelPhone")}</option><option value="email">{translate(language, "referenceChannelEmail")}</option><option value="line">LINE</option><option value="other">{translate(language, "referenceChannelOther")}</option></SelectInput></Field>
            <Field label={translate(language, "contactValue")}><TextInput name="candidate_reference_channel_value" required /></Field>
            {channelType === "other" ? <Field label={translate(language, "otherChannelLabel")} className="md:col-span-2"><TextInput name="candidate_reference_other_channel_label" required /></Field> : <input type="hidden" name="candidate_reference_other_channel_label" value="" />}
          </div>;
        })}</div> : null}
      </div>
      <Field label={translate(language, "firstContactDate")}><DayDateSelector ariaLabel={translate(language, "firstContactDate")} language={language} name="first_contact_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} required defaultValue={firstContactDate} /></Field>
      <Field label={translate(language, "candidateFolderLink")} className="md:col-span-2"><TextInput name="candidate_folder_url" type="url" defaultValue={selected?.candidate_folder_url ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function CandidateReferenceFields({ defaults, language }: { defaults: ProcessDefaults; language: Language }) {
  const [channelType, setChannelType] = useState(defaults.reference_channel_type ?? "phone");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="reference_id" value={defaults.reference_id ?? ""} />
      <input type="hidden" name="expected_updated_at" value={defaults.reference_expected_updated_at ?? ""} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-semibold text-navy md:col-span-2">{translate(language, "referenceContact")}</div>
      <Field label={translate(language, "referenceContactName")}><TextInput autoFocus name="reference_name" defaultValue={defaults.reference_name ?? ""} required /></Field>
      <Field label={translate(language, "relationshipWithCandidate")}><TextInput name="relationship" defaultValue={defaults.reference_relationship ?? ""} required /></Field>
      <Field label={translate(language, "channel")}>
        <SelectInput name="channel_type" value={channelType} onChange={(event) => setChannelType(event.target.value)}>
          <option value="phone">{translate(language, "referenceChannelPhone")}</option><option value="email">{translate(language, "referenceChannelEmail")}</option><option value="line">LINE</option><option value="other">{translate(language, "referenceChannelOther")}</option>
        </SelectInput>
      </Field>
      <Field label={translate(language, "contactValue")}><TextInput name="channel_value" defaultValue={defaults.reference_channel_value ?? ""} required /></Field>
      {channelType === "other" ? <Field label={translate(language, "otherChannelLabel")} className="md:col-span-2"><TextInput name="other_channel_label" defaultValue={defaults.reference_other_channel_label ?? ""} required /></Field> : null}
    </div>
  );
}

function CandidateReferenceStatusFields({ defaults, language }: { defaults: ProcessDefaults; language: Language }) {
  const [status, setStatus] = useState(defaults.reference_status === "archived" ? "archived" : defaults.reference_status === "unavailable" ? "unavailable" : "unavailable");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="reference_id" value={defaults.reference_id ?? ""} />
      <input type="hidden" name="expected_updated_at" value={defaults.reference_expected_updated_at ?? ""} />
      <Field label={translate(language, "referenceStatus")}>
        <SelectInput name="reference_status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="available">{translate(language, "referenceAvailable")}</option><option value="unavailable">{translate(language, "referenceUnavailable")}</option><option value="archived">{translate(language, "referenceArchived")}</option>
        </SelectInput>
      </Field>
      <Field label={translate(language, "reason")}><TextInput name="reference_status_reason" defaultValue={defaults.reference_status_reason ?? ""} required={status !== "available"} /></Field>
    </div>
  );
}

function CandidateReferenceCheckFields({ defaults, language }: { defaults: ProcessDefaults; language: Language }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="reference_id" value={defaults.reference_id ?? ""} />
      <input type="hidden" name="expected_updated_at" value={defaults.reference_check_expected_updated_at ?? ""} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-semibold text-navy md:col-span-2">{translate(language, "finalReferenceConversation")}</div>
      <Field label={translate(language, "checkedDate")}><TextInput autoFocus name="checked_date" type="date" defaultValue={defaults.reference_checked_date ?? today()} required /></Field>
      <Field label={translate(language, "conversationDurationMinutes")}><TextInput name="duration_minutes" type="number" min={1} defaultValue={defaults.reference_duration_minutes ?? ""} required /></Field>
      <Field label={translate(language, "conversationSummary")} className="md:col-span-2"><TextArea name="conversation_summary" rows={5} defaultValue={defaults.reference_conversation_summary ?? ""} required /></Field>
    </div>
  );
}

function ProcessPrefillFields({
  data,
  defaults,
  language,
  selectedId,
  selected,
  onSelect
}: {
  data: DashboardData;
  defaults: ProcessDefaults;
  language: Language;
  selectedId: string;
  selected: DashboardData["candidates"][number] | null;
  onSelect: (value: string) => void;
}) {
  const candidateId = selectedId || defaults.candidate_id || "";
  const logs = selected ? latestLogsForCandidate(data, selected.candidate_id) : [];
  const latest = logs[0] ?? null;
  const blockedReason = processUpdateBlockReason(logs);
  const availableStages = availableProcessUpdateStages(logs);
  const defaultStage = defaults.recruitment_process ?? latest?.recruitment_process;
  const processValue = availableStages.includes(defaultStage as ProcessStage) ? defaultStage : availableStages[0] ?? "";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="source" value={defaults.source ?? "manual"} />
      <Field label={translate(language, "candidate")}>
        <SelectInput name="candidate_id" required value={candidateId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">{translate(language, "selectCandidateOption")}</option>
          {data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}
        </SelectInput>
      </Field>
      <Field label={translate(language, "date")}><TextInput name="log_date" type="date" defaultValue={today()} required /></Field>
      {blockedReason ? <p className="rounded-md bg-lightgray p-3 text-sm font-bold text-orange md:col-span-2">{blockedReason}</p> : null}
      <Field label={translate(language, "process")}>
        <SelectInput name="recruitment_process" required defaultValue={processValue} disabled={availableStages.length === 0}>
          {availableStages.length === 0 ? <option value="">{translate(language, "noProcessUpdateAvailable")}</option> : null}
          {availableStages.map((stage) => <option key={stage} value={stage}>{processLabel(stage, language)}</option>)}
        </SelectInput>
      </Field>
      <Field label={translate(language, "round")}><TextInput name="round" type="number" min={1} defaultValue={defaults.round ?? latest?.round ?? 1} required /></Field>
      <Field label={translate(language, "interviewer")}><TextInput name="interviewer" list="interviewer-options" defaultValue={latest?.interviewer ?? ""} /></Field>
      <Field label={translate(language, "result")}><SelectInput name="result" defaultValue={defaults.result ?? ""}><option value="">{resultText(null, language)}</option><option value="1">{resultText(1, language)}</option><option value="0">{resultText(0, language)}</option></SelectInput></Field>
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="remark" rows={3} defaultValue={defaults.remark ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function DerivedPendingDate({ language, value }: { language: Language; value?: string | null }) {
  return <Field label="Pending date"><TextInput value={formatDate(value, language)} readOnly /></Field>;
}

function PendingEditFields({ defaults, language }: { defaults: ProcessDefaults; language: Language }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="stage_instance_id" value={defaults.stage_instance_id ?? ""} />
      <input type="hidden" name="expected_updated_at" value={defaults.expected_updated_at ?? ""} />
      <input type="hidden" name="opened_date" value={defaults.pending_log_date ?? ""} />
      <Field label={translate(language, "process")}><TextInput value={processLabel(defaults.recruitment_process as ProcessStage, language)} readOnly /></Field>
      <Field label={translate(language, "round")}><TextInput value={defaults.round ?? 1} readOnly /></Field>
      <DerivedPendingDate language={language} value={defaults.pending_log_date} />
      <Field label={translate(language, "estimatedActionDate")}><DayDateSelector ariaLabel={translate(language, "estimatedActionDate")} clearLabel={translate(language, "clear")} defaultValue={defaults.pending_estimated_action_date ?? ""} language={language} name="estimated_action_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} /></Field>
      <Field label={translate(language, "interviewer")}><TextInput name="interviewer" defaultValue={defaults.pending_interviewer ?? ""} /></Field>
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="remark" rows={3} placeholder={translate(language, "pipelinePendingRemarkPlaceholder", { stage: processLabel(defaults.recruitment_process as ProcessStage, language) })} defaultValue={defaults.pending_remark ?? ""} /></Field>
    </div>
  );
}

function PipelineStartFields({ defaults, language }: { defaults: ProcessDefaults; language: Language }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="opened_date" value={defaults.pending_log_date ?? ""} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-semibold text-navy md:col-span-2">{translate(language, "startPhoneScreen")}</div>
      <DerivedPendingDate language={language} value={defaults.pending_log_date} />
      <Field label={translate(language, "estimatedActionDate")}><DayDateSelector ariaLabel={translate(language, "estimatedActionDate")} clearLabel={translate(language, "clear")} defaultValue={defaults.pending_estimated_action_date ?? ""} language={language} name="estimated_action_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} /></Field>
      <Field label={translate(language, "interviewer")}><TextInput name="interviewer" list="interviewer-options" defaultValue={defaults.pending_interviewer ?? ""} /></Field>
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="remark" rows={3} placeholder={translate(language, "pipelinePendingRemarkPlaceholder", { stage: processLabel("Phone Screen", language) })} defaultValue={defaults.pending_remark ?? ""} /></Field>
    </div>
  );
}

function StageOutcomeFields({ defaults, language }: { defaults: ProcessDefaults; language: Language }) {
  const isPass = defaults.outcome === "pass";
  const hasNextPending = isPass && defaults.recruitment_process !== "Offer" && Boolean(defaults.target_stage);
  const [outcomeDate, setOutcomeDate] = useState(today());
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="stage_instance_id" value={defaults.stage_instance_id ?? ""} />
      <input type="hidden" name="expected_updated_at" value={defaults.expected_updated_at ?? ""} />
      <input type="hidden" name="outcome" value={defaults.outcome ?? ""} />
      <input type="hidden" name="current_stage" value={defaults.recruitment_process ?? ""} />
      <input type="hidden" name="target_stage" value={hasNextPending ? defaults.target_stage : ""} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-semibold text-navy md:col-span-2">{isPass ? translate(language, "passStage") : translate(language, "failStage")}: {processLabel(defaults.recruitment_process as ProcessStage, language)}</div>
      <input type="hidden" name="pending_opened_date" value={defaults.pending_log_date ?? ""} />
      <input type="hidden" name="pending_estimated_action_date" value={defaults.pending_estimated_action_date ?? ""} />
      <input type="hidden" name="pending_interviewer" value={defaults.pending_interviewer ?? ""} />
      <input type="hidden" name="pending_remark" value={defaults.pending_remark ?? ""} />
      <div className="border-b border-[#D7DEE8] pb-2 text-sm font-semibold text-navy md:col-span-2">{translate(language, "outcome")}</div>
      <Field label={translate(language, "outcomeDate")}><DayDateSelector ariaLabel={translate(language, "outcomeDate")} language={language} name="outcome_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} value={outcomeDate} onChange={(event) => setOutcomeDate(event.target.value)} required /></Field>
      <Field label={translate(language, "interviewer")}><TextInput name="outcome_interviewer" list="interviewer-options" defaultValue={defaults.pending_interviewer ?? ""} /></Field>
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="outcome_remark" rows={3} placeholder={translate(language, "pipelineOutcomeRemarkPlaceholder", { stage: processLabel(defaults.recruitment_process as ProcessStage, language) })} /></Field>
      {hasNextPending ? <>
        <div className="border-t border-[#D7DEE8] pt-3 text-sm font-semibold text-navy md:col-span-2">{translate(language, "nextPendingStage")}: {processLabel(defaults.target_stage as ProcessStage, language)}</div>
        <input type="hidden" name="next_round" value={defaults.recruitment_process === "Test" && defaults.target_stage === "Test" ? (defaults.round ?? 1) + 1 : 1} />
        <p className="text-sm font-medium text-slate md:col-span-2">{translate(language, "nextPendingDateDerived", { date: outcomeDate || translate(language, "notSet") })}</p>
        <Field label={translate(language, "estimatedActionDate")}><DayDateSelector ariaLabel={translate(language, "estimatedActionDate")} clearLabel={translate(language, "clear")} language={language} name="next_estimated_action_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} /></Field>
        <Field label={translate(language, "interviewer")}><TextInput name="next_interviewer" list="interviewer-options" defaultValue="" /></Field>
        <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="next_remark" rows={3} placeholder={translate(language, "pipelinePendingRemarkPlaceholder", { stage: processLabel(defaults.target_stage as ProcessStage, language) })} /></Field>
      </> : null}
    </div>
  );
}

function PipelinePassFields({ data, defaults, language }: { data: DashboardData; defaults: ProcessDefaults; language: Language }) {
  const stages = defaults.passed_stages ?? [];
  const isTestExit = stages.length === 1 && stages[0] === "Test" && defaults.target_stage === "Reference Check";
  const currentRound = defaults.current_round ?? 1;

  return (
    <div className="grid gap-4">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="target_stage" value={defaults.target_stage ?? ""} />
      <input type="hidden" name="current_stage_instance_id" value={defaults.stage_instance_id ?? ""} />
      <input type="hidden" name="expected_updated_at" value={defaults.expected_updated_at ?? ""} />
      <input type="hidden" name="stage_count" value={stages.length} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-slate">
        {translate(language, "confirmPassedStagesHint", { stage: processLabel(defaults.target_stage as ProcessStage, language), result: resultText(null, language) })}
      </div>
      {(
        <div className="grid gap-4 rounded-md border border-[#D7DEE8] bg-white p-3 md:grid-cols-2">
          <div className="md:col-span-2"><Tag tone="warning">{translate(language, "nextPendingStage")}: {processLabel(defaults.target_stage as ProcessStage, language)}</Tag></div>
          <input type="hidden" name="target_pending_opened_date" value={today()} />
          <p className="text-sm font-medium text-slate">{translate(language, "nextPendingDateDerived", { date: translate(language, "notSet") })}</p>
          <Field label={translate(language, "estimatedActionDate")}><DayDateSelector ariaLabel={translate(language, "estimatedActionDate")} clearLabel={translate(language, "clear")} language={language} name="target_pending_estimated_action_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} /></Field>
          <Field label={translate(language, "round")}><TextInput name="target_pending_round" type="number" min={1} defaultValue={1} required /></Field>
          <Field label={translate(language, "interviewer")}><TextInput name="target_pending_interviewer" list="interviewer-options" defaultValue="" /></Field>
          <Field label={translate(language, "remark")}><TextArea name="target_pending_remark" rows={2} placeholder={translate(language, "pipelinePendingRemarkPlaceholder", { stage: processLabel(defaults.target_stage as ProcessStage, language) })} defaultValue="" /></Field>
        </div>
      )}
      {stages.map((stage, index) => (
        <div key={stage} className="grid gap-4 rounded-md border border-[#D7DEE8] bg-white p-3 md:grid-cols-2">
          <input type="hidden" name={`stage_${index}`} value={stage} />
          <div className="md:col-span-2">
            <Tag tone="teal">{processLabel(stage, language)}</Tag>
          </div>
          <input type="hidden" name={`pending_date_${index}`} value={index === 0 ? (defaults.pending_log_date ?? "") : today()} />
          <p className="text-sm font-medium text-slate">{index === 0 ? `${translate(language, "pendingDetails")}: ${formatDate(defaults.pending_log_date, language)}` : translate(language, "nextPendingDateDerived", { date: translate(language, "notSet") })}</p>
          <input type="hidden" name={`pending_estimated_action_date_${index}`} value={index === 0 ? (defaults.pending_estimated_action_date ?? "") : ""} />
          <Field label={translate(language, "round")}><TextInput name={`round_${index}`} type="number" min={1} value={isTestExit && stage === "Test" ? currentRound : undefined} defaultValue={isTestExit && stage === "Test" ? undefined : 1} readOnly={isTestExit && stage === "Test"} required /></Field>
          <Field label={translate(language, "interviewer")}><TextInput name={`pending_interviewer_${index}`} list="interviewer-options" defaultValue={index === 0 ? (defaults.pending_interviewer ?? "") : ""} /></Field>
          <Field label={translate(language, "remark")}><TextArea name={`pending_remark_${index}`} rows={2} placeholder={translate(language, "pipelinePendingRemarkPlaceholder", { stage: processLabel(stage, language) })} defaultValue={index === 0 ? (defaults.pending_remark ?? "") : ""} /></Field>
          <Field label="Outcome date"><TextInput name={`outcome_date_${index}`} type="date" defaultValue={today()} required /></Field>
          <Field label={translate(language, "interviewer")}><TextInput name={`outcome_interviewer_${index}`} list="interviewer-options" defaultValue={index === 0 ? (defaults.pending_interviewer ?? "") : ""} /></Field>
          <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name={`outcome_remark_${index}`} rows={2} placeholder={translate(language, "pipelineOutcomeRemarkPlaceholder", { stage: processLabel(stage, language) })} defaultValue="" /></Field>
        </div>
      ))}
      <DataLists data={data} />
    </div>
  );
}

function TestMaintenanceFields({ data, defaults, language }: { data: DashboardData; defaults: ProcessDefaults; language: Language }) {
  const currentRound = defaults.current_round ?? defaults.round ?? 1;
  const nextRound = currentRound + 1;

  return (
    <div className="grid gap-4">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-medium text-slate">
        {translate(language, "testMaintenanceHint")}
      </div>
      <div className="grid gap-4 rounded-md border border-[#D7DEE8] bg-white p-3 md:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Tag tone="teal">{translate(language, "currentTest")}</Tag>
          <Tag tone="muted">{translate(language, "round")} {currentRound}</Tag>
          <Tag tone="success">{resultText(1, language)}</Tag>
        </div>
        <Field label={translate(language, "date")}><TextInput name="current_log_date" type="date" defaultValue={today()} required /></Field>
        <Field label={translate(language, "round")}><TextInput name="current_round" type="number" min={1} value={currentRound} readOnly required /></Field>
        <Field label={translate(language, "interviewer")}><TextInput name="current_interviewer" list="interviewer-options" /></Field>
        <Field label={translate(language, "remark")}><TextArea name="current_remark" rows={2} defaultValue={translate(language, "currentTestRoundPassedRemark")} /></Field>
      </div>
      <div className="grid gap-4 rounded-md border border-[#D7DEE8] bg-lightgray/70 p-3 md:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Tag tone="teal">{translate(language, "nextTest")}</Tag>
          <Tag tone="muted">{translate(language, "round")} {nextRound}</Tag>
          <Tag tone="warning">{resultText(null, language)}</Tag>
        </div>
        <Field label={translate(language, "date")}><TextInput name="next_log_date" type="date" defaultValue={today()} required /></Field>
        <Field label={translate(language, "round")}><TextInput name="next_round" type="number" min={1} value={nextRound} readOnly required /></Field>
        <Field label={translate(language, "interviewer")}><TextInput name="next_interviewer" list="interviewer-options" /></Field>
        <Field label={translate(language, "remark")}><TextArea name="next_remark" rows={2} defaultValue={translate(language, "nextTestRoundPendingRemark")} /></Field>
      </div>
      <DataLists data={data} />
    </div>
  );
}

function OfferFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Candidate"><SelectInput name="candidate_id" required>{data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label="Doc ID"><SelectInput name="doc_id" required>{data.requisitions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label="Accepted Date"><TextInput name="accepted_date" type="date" /></Field>
      <Field label="First Working Date"><TextInput name="first_working_date" type="date" /></Field>
      <Field label="Remark" className="md:col-span-2"><TextArea name="remark" rows={3} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function GroupFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4">
      <Field label="Group ID"><SelectInput name="group_id"><option value="">Auto in New mode</option>{data.position_groups.map((row) => <option key={row.group_id} value={row.group_id}>{positionGroupOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label="Group Position"><TextInput name="group_position" list="group-position-options" required /></Field>
      <div className="grid gap-2 rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-navy md:grid-cols-4">
        {SOURCING_CHANNELS.map((channel) => (
          <label key={channel.enabled} className="flex items-center gap-2">
            <input name={channel.enabled} type="checkbox" /> {channel.label}
          </label>
        ))}
      </div>
      <DataLists data={data} />
    </div>
  );
}

function MatchFields({ data, defaults, language }: { data: DashboardData; defaults: ModalDefaults; language: Language }) {
  const matchedDocIds = new Set(data.document_groups.map((group) => group.doc_id));
  const docOptions = data.requisitions.filter((row) => !matchedDocIds.has(row.doc_id) || row.doc_id === defaults.doc_id);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={translate(language, "docId")}><SelectInput name="doc_id" required defaultValue={defaults.doc_id ?? ""}>{docOptions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label={translate(language, "groupId")}><SelectInput name="group_id" required defaultValue={defaults.group_id ?? ""}>{data.position_groups.map((row) => <option key={row.group_id} value={row.group_id}>{positionGroupOptionLabel(row)}</option>)}</SelectInput></Field>
    </div>
  );
}

function SnapshotFields({ data, language }: { data: DashboardData; language: Language }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={translate(language, "weekStart")}><TextInput name="week_start" type="date" defaultValue={currentWeekStart()} required /></Field>
      <Field label={translate(language, "category")}>
        <SelectInput name="waterfall_category">
          {["Week Start", "Open", "Filled", "Total"].map((category) => <option key={category} value={category}>{category}</option>)}
        </SelectInput>
      </Field>
      <Field label={translate(language, "site")}>
        <SelectInput name="site" required>
          <option value="">{translate(language, "selectSite")}</option>
          {SITE_OPTIONS.map((site) => <option key={site} value={site}>{site}</option>)}
        </SelectInput>
      </Field>
      <Field label={translate(language, "requestType")}>
        <SelectInput name="request_type">
          <option value="New">{requestTypeLabel(language, "New")}</option>
          <option value="Replacement">{requestTypeLabel(language, "Replacement")}</option>
        </SelectInput>
      </Field>
      <Field label={translate(language, "vacancyCount")}><TextInput name="vacancy_count" type="number" defaultValue={0} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function UserFields({ canManageUsers, data, language = "en" }: { canManageUsers: boolean; data: DashboardData; language?: Language }) {
  if (!canManageUsers) return <p className="text-sm font-bold text-orange">Only system admins can manage app accounts.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Existing User">
        <SelectInput name="user_id">
          <option value="">Required in Change mode</option>
          {data.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{userOptionLabel(profile, language)}</option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Email"><TextInput name="email" type="email" /></Field>
      <Field label="Temporary Password"><TextInput name="password" type="password" minLength={8} /></Field>
      <Field label="Nickname / Account Name"><TextInput name="nickname" list="pic-options-form" required /></Field>
      <Field label="Full Name"><TextInput name="full_name" /></Field>
      <Field label="Assigned Site"><TextInput name="site" list="site-options-form" /></Field>
      <Field label="Role"><SelectInput name="role">{ROLES.map((role) => <option key={role} value={role}>{roleLabel(language, role)}</option>)}</SelectInput></Field>
      <DataLists data={data} />
    </div>
  );
}

function StartConfirmationFields({ defaults, language }: { defaults: ProcessDefaults; language: Language }) {
  const [outcome, setOutcome] = useState<"started" | "did_not_start">(defaults.offer_start_confirmation ?? "started");
  return <div className="grid gap-4">
    <input type="hidden" name="offer_id" value={defaults.offer_id ?? ""} />
    <input type="hidden" name="expected_updated_at" value={defaults.offer_expected_updated_at ?? ""} />
    <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-medium text-slate">Confirm the candidate’s first working-day attendance. Did not start will reopen headcount and restart the requisition SLA today.</div>
    <Field label="Start confirmation"><SelectInput name="start_confirmation" value={outcome} onChange={(event) => setOutcome(event.target.value as "started" | "did_not_start")}><option value="started">Started work</option><option value="did_not_start">Did not start</option></SelectInput></Field>
    {outcome === "did_not_start" ? <Field label="Reason"><TextArea name="reason" required rows={3} placeholder="Why did the candidate not start?" /></Field> : null}
  </div>;
}

function OfferPrefillFields({
  data,
  defaults,
  language,
  mode,
  selectedId,
  selected,
  onSelect
}: {
  data: DashboardData;
  defaults: ModalDefaults;
  language: Language;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["offers"][number] | null;
  onSelect: (value: string) => void;
}) {
  const offeredCandidateIds = new Set(data.offers.map((offer) => offer.candidate_id));
  const allowedCandidateIds = defaults.offer_candidate_ids ? new Set(defaults.offer_candidate_ids) : null;
  const eligibleCandidates = data.candidates.filter((candidate) => (
    (!allowedCandidateIds || allowedCandidateIds.has(candidate.candidate_id))
    && hasLatestOfferPass(data, candidate.candidate_id)
    && !offeredCandidateIds.has(candidate.candidate_id)
  ));
  const selectedCandidate = selected ? data.candidates.find((candidate) => candidate.candidate_id === selected.candidate_id) : null;
  const candidateOptions = selectedCandidate && !eligibleCandidates.some((candidate) => candidate.candidate_id === selectedCandidate.candidate_id)
    ? [...eligibleCandidates, selectedCandidate]
    : eligibleCandidates;
  const [selectedCandidateId, setSelectedCandidateId] = useState(selected?.candidate_id ?? defaults.candidate_id ?? "");
  const [selectedDocId, setSelectedDocId] = useState(selected?.doc_id ?? defaults.doc_id ?? "");
  const allowedDocIds = defaults.offer_doc_ids ? new Set(defaults.offer_doc_ids) : null;
  const docOptions = mode === "change" && selected?.doc_id
    ? data.requisitions.filter((row) => row.doc_id === selected.doc_id)
    : availableOfferDocOptions(data, selectedCandidateId, selectedDocId).filter((row) => !allowedDocIds || allowedDocIds.has(row.doc_id));

  useEffect(() => {
    setSelectedCandidateId(selected?.candidate_id ?? defaults.candidate_id ?? "");
    setSelectedDocId(selected?.doc_id ?? defaults.doc_id ?? "");
  }, [defaults.candidate_id, defaults.doc_id, selected?.candidate_id, selected?.doc_id]);

  useEffect(() => {
    if (mode === "change") return;
    if (selectedDocId && !docOptions.some((row) => row.doc_id === selectedDocId)) {
      setSelectedDocId("");
    }
  }, [docOptions, mode, selectedDocId]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {mode === "change" ? (
        <Field label={translate(language, "existingOffer")}>
          <SelectInput name="offer_selector" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">{translate(language, "selectOfferOption")}</option>
            {data.offers.map((offer) => <option key={offer.offer_id} value={offer.offer_id}>{offerOptionLabel(data, offer)}</option>)}
          </SelectInput>
        </Field>
      ) : null}
      {mode === "change" ? <input type="hidden" name="candidate_id" value={selected?.candidate_id ?? ""} /> : null}
      <Field label={translate(language, "candidate")}>
        <CreateSelectInput name={mode === "change" ? undefined : "candidate_id"} required value={selectedCandidateId} disabled={mode === "change"} onChange={(event) => {
          setSelectedCandidateId(event.target.value);
          setSelectedDocId("");
        }}>
          <option value="">{translate(language, "selectOfferPassCandidate")}</option>
          {candidateOptions.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}
        </CreateSelectInput>
      </Field>
      {mode === "change" ? <input type="hidden" name="doc_id" value={selected?.doc_id ?? ""} /> : null}
      <Field label={translate(language, "docId")}>
        <CreateSelectInput name={mode === "change" ? undefined : "doc_id"} required value={selectedDocId} disabled={mode === "change" || !selectedCandidateId} onChange={(event) => setSelectedDocId(event.target.value)}>
          <option value="">{selectedCandidateId ? translate(language, "selectRequisitionOption") : translate(language, "selectCandidateFirst")}</option>
          {docOptions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}
        </CreateSelectInput>
      </Field>
      <Field label={translate(language, "acceptedDateField")}><TextInput name="accepted_date" type="date" defaultValue={selected?.accepted_date ?? defaults.accepted_date ?? ""} /></Field>
      <Field label={translate(language, "firstWorkingDate")}><TextInput name="first_working_date" type="date" defaultValue={selected?.first_working_date ?? ""} /></Field>
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="remark" rows={3} defaultValue={selected?.remark ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function availableOfferDocOptions(data: DashboardData, candidateId: string, currentDocId = "") {
  if (!candidateId) return [];
  const candidate = data.candidates.find((row) => row.candidate_id === candidateId);
  if (!candidate) return [];
  const candidateGroupId = candidate.group_id ?? data.document_groups.find((row) => row.doc_group_id === candidate.doc_group_id)?.group_id;
  if (!candidateGroupId) return [];
  const matchedDocIds = new Set(
    data.document_groups
      .filter((row) => row.group_id === candidateGroupId)
      .map((row) => row.doc_id)
  );
  const existingOfferDocIds = new Set(data.offers.filter((offer) => offer.candidate_id === candidateId).map((offer) => offer.doc_id));
  return enrichRequisitions(data)
    .filter((row) => matchedDocIds.has(row.doc_id))
    .filter((row) => row.status !== "filled" && row.status !== "cancel" && row.open_headcount > 0)
    .filter((row) => row.doc_id === currentDocId || !existingOfferDocIds.has(row.doc_id))
    .sort((a, b) => a.doc_id.localeCompare(b.doc_id));
}

function GroupPrefillFields({
  data,
  language,
  mode,
  selectedId,
  selected,
  defaults,
  onSelect
}: {
  data: DashboardData;
  language: Language;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["position_groups"][number] | null;
  defaults: ModalDefaults;
  onSelect: (value: string) => void;
}) {
  const groupPositionValue = mode === "new" ? defaults.group_position ?? "" : selected?.group_position ?? "";

  return (
    <div className="grid gap-4">
      <Field label={translate(language, "groupId")}>
        {mode === "change" ? (
          <SelectInput name="group_id" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">{translate(language, "selectGroup")}</option>
            {data.position_groups.map((row) => <option key={row.group_id} value={row.group_id}>{positionGroupOptionLabel(row)}</option>)}
          </SelectInput>
        ) : (
          <CreateSelectInput name="group_id"><option value="">{translate(language, "autoInNewMode")}</option>{data.position_groups.map((row) => <option key={row.group_id} value={row.group_id}>{positionGroupOptionLabel(row)}</option>)}</CreateSelectInput>
        )}
      </Field>
      <Field label={translate(language, "groupPosition")}><TextInput name="group_position" list="group-position-options" required defaultValue={groupPositionValue} /></Field>
      <div className="grid gap-2 rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-navy md:grid-cols-4">
        {SOURCING_CHANNELS.map((channel) => (
          <label key={channel.enabled} className="flex items-center gap-2">
            <input name={channel.enabled} type="checkbox" defaultChecked={selected?.[channel.enabled] ?? false} /> {channel.label}
          </label>
        ))}
      </div>
      <DataLists data={data} />
    </div>
  );
}

function UserPrefillFields({
  canManageUsers,
  data,
  language,
  mode,
  selectedId,
  selected,
  onSelect
}: {
  canManageUsers: boolean;
  data: DashboardData;
  language: Language;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["profiles"][number] | null;
  onSelect: (value: string) => void;
}) {
  if (!canManageUsers) return <p className="text-sm font-bold text-orange">{translate(language, "onlySystemAdmins")}</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {mode === "change" ? <Field label={translate(language, "existingUser")}>
        <SelectInput name="user_id" required={mode === "change"} value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">{translate(language, "selectUser")}</option>
          {data.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{userOptionLabel(profile, language)}</option>
          ))}
        </SelectInput>
      </Field> : null}
      <Field label={translate(language, "email")}><TextInput name="email" type="email" defaultValue={selected?.email ?? ""} /></Field>
      <Field label={translate(language, "temporaryPassword")}><TextInput name="password" type="password" minLength={8} /></Field>
      <Field label={translate(language, "nicknameAccountName")}><TextInput name="nickname" list="pic-options-form" required defaultValue={selected?.nickname ?? ""} /></Field>
      <Field label={translate(language, "fullName")}><TextInput name="full_name" defaultValue={selected?.full_name ?? ""} /></Field>
      <Field label={translate(language, "assignedSite")}>
        <SelectInput name="site" defaultValue={selected?.site ?? ""}>
          <option value="">{translate(language, "noAssignedSite")}</option>
          {SITE_OPTIONS.map((site) => <option key={site} value={site}>{site}</option>)}
        </SelectInput>
      </Field>
      <Field label={translate(language, "role")}><SelectInput name="role" defaultValue={selected?.role ?? "viewer"}>{ROLES.map((role) => <option key={role} value={role}>{roleLabel(language, role)}</option>)}</SelectInput></Field>
      <DataLists data={data} />
    </div>
  );
}

function DataLists({ data }: { data: DashboardData }) {
  return (
    <>
      <datalist id="doc-id-options">{data.requisitions.map((row) => <option key={row.doc_id} value={row.doc_id} />)}</datalist>
      <datalist id="site-options-form">{uniqueValues(data.requisitions.map((row) => row.site)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="position-options">{uniqueValues(data.requisitions.map((row) => row.position)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="department-options">{uniqueValues(data.requisitions.map((row) => row.department)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="section-options">{uniqueValues(data.requisitions.map((row) => row.section)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="level-options">{uniqueValues(data.requisitions.map((row) => row.level)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="pic-options-form">{uniqueValues(data.requisitions.map((row) => row.person_in_charge)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="manager-options">{uniqueValues(data.requisitions.map((row) => row.line_manager)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="group-position-options">{uniqueValues(data.position_groups.map((row) => row.group_position)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="channel-options">{uniqueValues(data.candidates.map((row) => row.channel)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="ref-options">{uniqueValues(data.candidates.map((row) => row.ref_name)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="interviewer-options">{uniqueValues(data.recruitment_logs.map((row) => row.interviewer)).map((value) => <option key={value} value={value} />)}</datalist>
    </>
  );
}

function WelcomeBackPrompt({
  language,
  open,
  profile,
  summary,
  onClose,
  onPipeline
}: {
  language: Language;
  open: boolean;
  profile: DashboardData["profile"];
  summary: WelcomeSummary;
  onClose: () => void;
  onPipeline: () => void;
}) {
  const name = profile?.nickname ?? profile?.full_name ?? profile?.email ?? translate(language, "system");
  const fallbackMessage = translate(language, welcomeRatioMessageKey(summary.filledResponsibleVacancyBucket));
  const message = dailyWelcomeMessage({
    language,
    ratio: summary.filledResponsibleVacancyRatio,
    name,
    fallback: fallbackMessage
  });
  const progressWidth = `${Math.min(summary.filledResponsibleVacancyRatio, 100)}%`;

  return (
    <Modal open={open} title={translate(language, "welcomeBack")} onClose={onClose} width="max-w-xl">
      <div className="grid gap-4">
        <div className="overflow-hidden rounded-lg border border-[#D7DEE8] bg-[#F8FBFF]">
          <div className="border-l-4 border-primary px-4 py-4">
            <p className="text-sm font-semibold leading-6 text-navy">{message}</p>
            <div className="mt-4 grid gap-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-slate">{translate(language, "welcomeFilledRatioLabel")}</p>
                  <p className="mt-0.5 text-xs font-medium text-slate">
                    {translate(language, "welcomeFilledRatioHelper")
                      .replace("{filled}", formatNumber(summary.filledThisMonth, language))
                      .replace("{total}", formatNumber(summary.responsibleVacancyTotal, language))}
                  </p>
                </div>
                <p className="text-2xl font-semibold tabular-nums text-navy">{formatNumber(summary.filledResponsibleVacancyRatio, language)}%</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#D7DEE8]" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: progressWidth }} />
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <WelcomeSummaryItem language={language} label={translate(language, "welcomeOpenRequisitions")} value={summary.openRequisitions} />
          <WelcomeSummaryItem language={language} label={translate(language, "welcomeOpenVacancy")} value={summary.openVacancy} />
          <WelcomeSummaryItem language={language} label={translate(language, "welcomeActiveCandidates")} value={summary.activeCandidates} />
          <WelcomeSummaryItem language={language} label={translate(language, "welcomeOfferFinalization")} value={summary.offerFinalizationNeeded} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#D7DEE8] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{translate(language, "close")}</Button>
          <Button type="button" onClick={onPipeline}>{translate(language, "viewPipeline")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function WelcomeSummaryItem({ language, label, value }: { language: Language; label: string; value: number }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-[#D7DEE8] bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-normal text-slate">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy">{formatNumber(value, language)}</p>
    </div>
  );
}

function buildWelcomeSummary(
  requisitions: EnrichedRequisition[],
  candidates: EnrichedCandidate[],
  offers: DashboardData["offers"],
  requisitionLogs: DashboardData["requisition_logs"],
  profile: DashboardData["profile"]
): WelcomeSummary {
  const responsibleRequisitions = responsibleRows(requisitions, profile);
  const responsibleCandidates = responsibleRows(candidates, profile);
  const offerCandidateIds = new Set(offers.map((offer) => offer.candidate_id));
  const actionableRequisitions = responsibleRequisitions.filter((row) => row.status !== "filled" && row.status !== "cancel" && row.open_headcount > 0);
  const responsibleVacancyRequisitions = responsibleRequisitions.filter((row) => isPimEligible(row, offers, requisitionLogs));
  const responsibleDocIds = new Set(responsibleVacancyRequisitions.map((row) => row.doc_id));
  const responsibleVacancyTotal = responsibleVacancyRequisitions.reduce((sum, row) => sum + row.head_count, 0);
  const filledThisMonth = offers.filter((offer) =>
    responsibleDocIds.has(offer.doc_id) && isAcceptedThisCalendarMonth(offer.accepted_date)
  ).length;
  const filledResponsibleVacancyRatio = responsibleVacancyTotal > 0
    ? Math.floor((filledThisMonth / responsibleVacancyTotal) * 100)
    : 0;
  const activeCandidates = responsibleCandidates.filter(
    (row) => row.latest_process !== "No activity"
      && ACTIVE_PIPELINE_STAGES.includes(row.latest_process)
      && row.latest_result !== 0
      && !offerCandidateIds.has(row.candidate_id)
  );
  const offerFinalizationNeeded = activeCandidates.filter((row) => row.latest_process === "Offer" && row.latest_result === 1).length;

  return {
    openRequisitions: actionableRequisitions.length,
    openVacancy: actionableRequisitions.reduce((sum, row) => sum + row.open_headcount, 0),
    activeCandidates: activeCandidates.length,
    offerFinalizationNeeded,
    filledThisMonth,
    responsibleVacancyTotal,
    filledResponsibleVacancyRatio,
    filledResponsibleVacancyBucket: welcomeRatioBucket(filledResponsibleVacancyRatio)
  };
}

function isAcceptedThisCalendarMonth(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return false;
  const acceptedDate = dateOnly(value);
  if (!acceptedDate || !isValidCalendarDate(acceptedDate)) return false;
  const today = todayDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  return acceptedDate >= monthStart && acceptedDate <= today;
}

function PipelineRecordCorrectionFields({ canEditPendingDate, defaults, language }: { canEditPendingDate: boolean; defaults: ProcessDefaults; language: Language }) {
  const completed = Boolean(defaults.outcome_result);
  return <div className="grid gap-4 md:grid-cols-2">
    <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
    <input type="hidden" name="stage_instance_id" value={defaults.stage_instance_id ?? ""} />
    <input type="hidden" name="expected_updated_at" value={defaults.expected_updated_at ?? ""} />
    <Field label={translate(language, "process")}><TextInput value={processLabel(defaults.recruitment_process as ProcessStage, language)} readOnly /></Field>
    <Field label={translate(language, "round")}><TextInput value={defaults.round ?? 1} readOnly /></Field>
    <div className="border-b border-[#D7DEE8] pb-2 text-sm font-semibold text-navy md:col-span-2">{translate(language, "pendingDetails")}</div>
    {canEditPendingDate ? <Field label="Pending date"><DayDateSelector ariaLabel="Pending date" defaultValue={defaults.pending_log_date ?? ""} language={language} name="opened_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} required /></Field> : <><input type="hidden" name="opened_date" value={defaults.pending_log_date ?? ""} /><DerivedPendingDate language={language} value={defaults.pending_log_date} /></>}
    <Field label={translate(language, "estimatedActionDate")}><DayDateSelector ariaLabel={translate(language, "estimatedActionDate")} clearLabel={translate(language, "clear")} defaultValue={defaults.pending_estimated_action_date ?? ""} language={language} name="estimated_action_date" nextMonthLabel={translate(language, "nextMonth")} previousMonthLabel={translate(language, "previousMonth")} /></Field>
    <Field label={translate(language, "interviewer")}><TextInput name="interviewer" list="interviewer-options" defaultValue={defaults.pending_interviewer ?? ""} /></Field>
    <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="remark" rows={3} defaultValue={defaults.pending_remark ?? ""} /></Field>
    {completed ? <>
      <div className="border-b border-[#D7DEE8] pb-2 text-sm font-semibold text-navy md:col-span-2">{translate(language, "outcome")}</div>
      <Field label={translate(language, "result")}><SelectInput name="outcome_result" defaultValue={defaults.outcome_result ?? ""}><option value="pass">{resultText(1, language)}</option><option value="fail">{resultText(0, language)}</option></SelectInput></Field>
      <Field label={translate(language, "outcomeDate")}><TextInput name="outcome_date" type="date" defaultValue={defaults.outcome_date ?? today()} required /></Field>
      <Field label={translate(language, "interviewer")}><TextInput name="outcome_interviewer" list="interviewer-options" defaultValue={defaults.outcome_interviewer ?? ""} /></Field>
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="outcome_remark" rows={3} defaultValue={defaults.outcome_remark ?? ""} /></Field>
    </> : null}
  </div>;
}

function CreateAndMatchGroupFields({ data, defaults, language, profile }: { data: DashboardData; defaults: ModalDefaults; language: Language; profile: DashboardData["profile"] }) {
  const matchedDocIds = new Set(data.document_groups.map((group) => group.doc_id));
  const allEligibleRequisitions = enrichRequisitions(data).filter((row) => (
    row.status === "ongoing"
      && row.open_headcount > 0
      && !matchedDocIds.has(row.doc_id)
      && siteRecruiterCanManageRequisition(row, profile)
  ));
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(() => defaults.doc_id ? [defaults.doc_id] : []);
  const [pendingDocId, setPendingDocId] = useState("");
  useEffect(() => {
    setSelectedDocIds(defaults.doc_id ? [defaults.doc_id] : []);
    setPendingDocId("");
  }, [defaults.doc_id]);
  const selectedRequisitions = selectedDocIds.map((docId) => allEligibleRequisitions.find((row) => row.doc_id === docId)).filter((row): row is ReturnType<typeof enrichRequisitions>[number] => Boolean(row));
  const selectedSite = selectedRequisitions[0]?.site;
  const eligibleRequisitions = allEligibleRequisitions.filter((row) => !selectedDocIds.includes(row.doc_id) && (!selectedSite || row.site === selectedSite));
  const addRequisition = () => {
    if (!pendingDocId || !eligibleRequisitions.some((row) => row.doc_id === pendingDocId)) return;
    setSelectedDocIds((ids) => [...ids, pendingDocId]);
    setPendingDocId("");
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={translate(language, "groupId")}><TextInput value={translate(language, "autoInNewMode")} readOnly /></Field>
      <Field label={translate(language, "groupPosition")}><TextInput name="group_position" list="group-position-options" required defaultValue={defaults.group_position ?? ""} /></Field>
      <div className="grid gap-2 rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-navy md:col-span-2 md:grid-cols-4">
        {SOURCING_CHANNELS.map((channel) => <label key={channel.enabled} className="flex items-center gap-2"><input name={channel.enabled} type="checkbox" /> {channel.label}</label>)}
      </div>
      <section className="grid gap-3 rounded-md border border-[#C9D5E6] bg-[#F8FAFD] p-3 md:col-span-2">
        <div><h3 className="font-semibold text-navy">{translate(language, "linkRequisitions")}</h3><p className="mt-1 text-sm text-slate">{translate(language, "groupRequisitionSiteHint")}</p></div>
        <div className="flex flex-wrap items-end gap-2"><Field className="min-w-[16rem] flex-1" label={translate(language, "docId")}><CreateSelectInput value={pendingDocId} onChange={(event) => setPendingDocId(event.target.value)}><option value="">{translate(language, "selectRequisitionOption")}</option>{eligibleRequisitions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}</CreateSelectInput></Field><Button type="button" size="icon-sm" variant="secondary" icon={<Plus size={17} />} aria-label={translate(language, "addRequisition")} title={translate(language, "addRequisition")} onClick={addRequisition} disabled={!pendingDocId} /></div>
        <div className="grid gap-2">{selectedRequisitions.map((row) => <div key={row.doc_id} className="flex min-w-0 items-center gap-2 rounded border border-[#D7DEE8] bg-white px-3 py-2"><input type="hidden" name="doc_ids" value={row.doc_id} /><p className="min-w-0 flex-1 truncate text-sm font-semibold text-navy" title={`${row.doc_id} · ${row.position} · ${row.site} · ${row.person_in_charge ?? translate(language, "unassigned")}`}>{row.doc_id} · {row.position} · {row.site} · {row.person_in_charge ?? translate(language, "unassigned")}</p><Button type="button" size="icon-sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" icon={<X size={16} />} onClick={() => setSelectedDocIds((ids) => ids.filter((id) => id !== row.doc_id))} aria-label={translate(language, "removeRequisition", { docId: row.doc_id })} /></div>)}</div>
        {selectedRequisitions.length === 0 ? <p className="text-sm font-medium text-danger">{translate(language, "selectAtLeastOneRequisition")}</p> : null}
      </section>
      <DataLists data={data} />
    </div>
  );
}

function siteRecruiterCanManageRequisition(requisition: Pick<EnrichedRequisition, "site" | "person_in_charge">, profile: DashboardData["profile"]) {
  if (profile?.role !== "site_recruiter") return true;
  const site = (profile.site ?? "").trim().toLocaleLowerCase();
  const nickname = (profile.nickname ?? profile.full_name ?? "").trim().toLocaleLowerCase();
  return Boolean(site && requisition.site.trim().toLocaleLowerCase() === site)
    || Boolean(nickname && (requisition.person_in_charge ?? "").trim().toLocaleLowerCase() === nickname);
}

function isPimEligible(requisition: EnrichedRequisition, offers: DashboardData["offers"], logs: DashboardData["requisition_logs"]) {
  const today = todayDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = `${today.slice(0, 7)}-${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()}`;
  const prDate = dateOnly(requisition.pr_approved_date);
  if (!prDate || requisition.status === "cancel" || prDate > monthEnd) return false;
  const filledLogDate = logs.filter((log) => log.doc_id === requisition.doc_id && log.status === "filled").map((log) => dateOnly(log.log_date)).filter(Boolean).sort().at(-1);
  const closeDate = filledLogDate ?? offers.filter((offer) => offer.doc_id === requisition.doc_id).map((offer) => dateOnly(offer.accepted_date)).filter(Boolean).sort().at(-1) ?? null;
  return !closeDate || closeDate >= monthStart;
}

function isValidCalendarDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function welcomeRatioBucket(ratio: number): WelcomeRatioBucket {
  if (ratio >= 100) return 100;
  if (ratio >= 75) return 75;
  if (ratio >= 50) return 50;
  if (ratio >= 25) return 25;
  return 0;
}

function welcomeRatioMessageKey(bucket: WelcomeRatioBucket) {
  return `welcomeFilledRatioMessage${bucket}`;
}

function todayDate() {
  return formatLocalDateInput();
}

function addDays(date: string, days: number) {
  const current = new Date(`${date}T00:00:00`);
  current.setDate(current.getDate() + days);
  return dateOnlyFromDate(current);
}

function dateOnly(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return dateOnlyFromDate(date);
}

function dateOnlyFromDate(date: Date) {
  return formatLocalDateInput(date);
}

function responsibleRows<T extends { site?: string | null; person_in_charge?: string | null }>(rows: T[], profile: DashboardData["profile"]) {
  if (!profile || profile.role === "system_admin" || profile.role === "admin_recruiter") return rows;
  const ownerNames = [profile.nickname, profile.full_name].filter(Boolean).map((value) => value!.toLowerCase());
  const site = profile.site?.toLowerCase();
  return rows.filter((row) => {
    const rowOwner = (row.person_in_charge ?? "").toLowerCase();
    const rowSite = (row.site ?? "").toLowerCase();
    return ownerNames.some((owner) => rowOwner.includes(owner)) || Boolean(site && rowSite.includes(site));
  });
}

function welcomeStorageKey(profileKey: string) {
  return `recruitment_welcome_dismissed:${profileKey}`;
}

function GuidePrompt({
  language,
  step,
  context,
  onCreateGroup,
  onCreateCandidate,
  onLater
}: {
  language: Language;
  step: GuideStep;
  context: GuideContext;
  onCreateGroup: () => void;
  onCreateCandidate: () => void;
  onLater: () => void;
}) {
  if (step !== "source_candidates" && step !== "ask_candidate") return null;

  if (step === "source_candidates") {
    return (
      <Modal open title={translate(language, "guideNextStepSourceCandidates")} onClose={onLater} width="max-w-lg">
        <div className="grid gap-4">
          <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-slate">
            <p className="text-navy">{formatRequisitionTitle(context)}</p>
            <p className="mt-1 text-xs font-medium text-cool">{translate(language, "requisitionId")}: {context.doc_id}</p>
            <p className="mt-1">{translate(language, "guideSourceCandidatesMessage")}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onLater}>{translate(language, "later")}</Button>
            <Button type="button" size="icon-sm" className="ring-4 ring-primary/20" icon={<Plus size={17} />} aria-label={translate(language, "newGroup")} title={translate(language, "newGroup")} onClick={onCreateGroup} />
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title={translate(language, "guideHaveCandidateQuestion")} onClose={onLater} width="max-w-lg">
      <div className="grid gap-4">
        <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-slate">
          <p className="text-navy">{formatRequisitionTitle(context)}</p>
          <p className="mt-1 text-xs font-medium text-cool">{translate(language, "requisitionId")}: {context.doc_id}</p>
          <p className="mt-1">{translate(language, "guideCandidateMessage")}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onLater}>{translate(language, "noLater")}</Button>
          <Button type="button" onClick={onCreateCandidate}>{translate(language, "yesCreateCandidate")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ConfirmModal({
  language,
  action,
  busy,
  onClose,
  onConfirm
}: {
  language: Language;
  action: PendingAction | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={Boolean(action)} title={action?.title ?? "Confirm Save"} onClose={onClose} width="max-w-lg">
      <div className="grid gap-4">
        <p className="text-sm font-bold text-slate">{action?.summary}</p>
        <pre className="max-h-72 overflow-auto rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-xs text-navy">{JSON.stringify(action?.payload ?? {}, null, 2)}</pre>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{translate(language, "cancel")}</Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>{translate(language, "saveChanges")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function DestructiveConfirmModal({
  language,
  action,
  busy,
  onClose,
  onConfirm
}: {
  language: Language;
  action: DestructiveAction | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={Boolean(action)} title={action?.title ?? translate(language, "confirmDestructiveAction")} onClose={onClose} width="max-w-lg">
      <div className="grid gap-4">
        <div className="rounded-md border border-[#F4B4AE] bg-[#FFF8F7] p-3">
          <p className="text-sm font-bold text-scarlet">{translate(language, "destructiveActionWarning")}</p>
          <p className="mt-1 text-sm font-medium text-slate">{action?.summary}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{translate(language, "cancel")}</Button>
          <Button type="button" variant="danger" disabled={busy} onClick={onConfirm}>{translate(language, "confirmDestructiveButton")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function UpdateDeniedModal({ language, reason, onClose }: { language: Language; reason: string | null; onClose: () => void }) {
  return (
    <Modal open={Boolean(reason)} title={translate(language, "updateNotSaved")} closeLabel={translate(language, "close")} onClose={onClose} width="max-w-lg">
      <div className="grid gap-4">
        <div className="flex items-start gap-3 rounded-xl bg-danger/5 px-4 py-3 text-scarlet">
          <AlertTriangle className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">{translate(language, "updateDenied")}</p>
            <p className="mt-1 text-sm font-medium leading-6">{translate(language, "updateDeniedHelp")}</p>
          </div>
        </div>
        <div className="rounded-xl bg-[#F8FAFD] px-4 py-3 text-sm font-medium leading-6 text-navy" role="alert">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate">{translate(language, "denialReason")}</p>
          <p className="break-words">{reason}</p>
        </div>
        <div className="flex justify-end"><Button type="button" onClick={onClose}>{translate(language, "reviewAndEdit")}</Button></div>
      </div>
    </Modal>
  );
}

function OfferPassHandoffPrompt({
  handoff,
  language,
  onCreateOffer,
  onStay
}: {
  handoff: OfferPassHandoff | null;
  language: Language;
  onCreateOffer: () => void;
  onStay: () => void;
}) {
  return (
    <Modal open={Boolean(handoff)} title={translate(language, "offerStagePassed")} onClose={onStay} width="max-w-lg">
      <div className="grid gap-4">
        <p className="text-sm font-medium text-slate">
          {translate(language, "offerPassedHandoff", { date: formatDate(handoff?.passedDate ?? null) })}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onStay}>{translate(language, "remainInPipeline")}</Button>
          <Button type="button" onClick={onCreateOffer}>{translate(language, "createOffer")}</Button>
        </div>
      </div>
    </Modal>
  );
}

type DetailBodyResult = {
  title: string;
  headerMeta?: ReactNode;
  headerActions?: ReactNode;
  body: ReactNode;
};

function buildDetailBodyV2(
  detail: { type: "requisition" | "candidate"; id: string } | null,
  data: DashboardData,
  language: Language,
  canWrite: boolean,
  canDeleteRecords: boolean,
  onUpdateCandidate: (candidateId: string) => void,
  onEditPending: (candidate: EnrichedCandidate) => void,
  onEditOffer: (offer: Offer) => void,
  onConfirmOfferStart: (offer: Offer) => void,
  navigationContext: { language: Language; site: string; owner: string; sourcingWeek: string },
  onChangeRequisition: (docId: string) => void,
  onChangeCandidate: (candidateId: string) => void,
  onEditReference: (candidateId: string, referenceId?: string) => void,
  onSetReferenceStatus: (candidateId: string, referenceId: string) => void,
  onSaveReferenceCheck: (candidateId: string, referenceId: string) => void,
  onDeleteRecord: (endpoint: string, payload: Record<string, unknown>, summary: string) => void
): DetailBodyResult {
  if (!detail) return { title: "Detail", body: null };
  const href = (path: string) => buildContextualHref(path, navigationContext);

  if (detail.type === "requisition") {
    const requisition = enrichRequisitions(data).find((row) => row.doc_id === detail.id);
    if (!requisition) return { title: "Requisition", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
    const groups = data.document_groups.filter((row) => row.doc_id === requisition.doc_id);
    const positionGroupIds = new Set(groups.map((row) => row.group_id).filter(Boolean) as string[]);
    const relatedDocGroupIds = positionGroupIds.size > 0
      ? new Set(data.document_groups.filter((row) => row.group_id && positionGroupIds.has(row.group_id)).map((row) => row.doc_group_id))
      : new Set(groups.map((row) => row.doc_group_id));
    const candidates = enrichCandidates(data).filter((row) => row.group_id ? positionGroupIds.has(row.group_id) : Boolean(row.doc_group_id && relatedDocGroupIds.has(row.doc_group_id)));
    const offers = data.offers.filter((row) => row.doc_id === requisition.doc_id);
    const applicantTotal = applicantCountForPositionGroups(data, positionGroupIds);
    const funnelRows = buildPipelineFunnelRows(applicantTotal, historicalPipelineCountsForCandidates(data, candidates.map((row) => row.candidate_id)), language);
    const readiness = requisitionFillReadiness(requisition, enrichCandidates(data));
    const sla = getRequisitionSlaState(requisition, { openOnly: true });
    const issues = deriveDataQualityIssues(data).filter((issue) =>
      issue.entityId === requisition.doc_id
      || candidates.some((candidate) => candidate.candidate_id === issue.entityId)
      || offers.some((offer) => String(offer.offer_id) === issue.entityId)
    );

    return {
      title: formatRequisitionTitle(requisition),
      headerMeta: (
        <>
          <Tag tone={statusTone(requisition.status)}>{requisitionStatusLabel(language, requisition.status)}</Tag>
          <span className={`text-sm font-semibold ${readinessTextClass(readiness.tone)}`}>{fillReadinessLabel(language, readiness.label)}</span>
        </>
      ),
      headerActions: (
        <RecordActionGroup
          label={formatRequisitionOptionLabel(requisition)}
          primary={{ id: "workspace", label: translate(language, "workspaceOpen"), href: href(`/workspace?type=requisition&id=${encodeURIComponent(requisition.doc_id)}&section=overview`), tone: "primary", iconOnly: true }}
          items={[
            ...(canWrite ? [{ id: "change-record", label: translate(language, "changeRecord"), onSelect: () => onChangeRequisition(requisition.doc_id) }] : []),
            ...(canDeleteRecords ? [{
              id: "delete-record",
              label: translate(language, "deleteRecord"),
              tone: "danger" as const,
              onSelect: () => onDeleteRecord("app_delete_recruitment_record", { entity: "requisition", id: requisition.doc_id }, translate(language, "deleteRecordSummary", { entity: translate(language, "requisition"), id: requisition.doc_id }))
            }] : []),
            { id: "sourcing", href: href(`/sourcing?reqSearch=${encodeURIComponent(requisition.doc_id)}`), label: translate(language, "workspaceOpenSourcing") },
            { id: "candidates", href: href(`/candidates?candSearch=${encodeURIComponent(requisition.doc_id)}`), label: translate(language, "workspaceRelatedCandidates") },
            { id: "offers", href: href(`/offers?offerSearch=${encodeURIComponent(requisition.doc_id)}`), label: translate(language, "workspaceRelatedOffers") }
          ]}
        />
      ),
      body: (
        <div className="grid min-w-0 gap-4">
          <OperationalSummaryStrip items={[
            { label: translate(language, "openHeadcountShort"), value: requisition.open_headcount, tone: requisition.open_headcount > 0 ? "warning" : "success", helper: translate(language, "remainingDemand") },
            { label: translate(language, "fillReadiness"), value: fillReadinessLabel(language, readiness.label), tone: readiness.tone, helper: readiness.reason },
            { label: translate(language, "slaLabel"), value: sla?.label ?? "-", tone: sla?.isOverdue ? "danger" : "muted", helper: translate(language, "ageLabel") }
          ]} />
          <InlineDataQualityIssues issues={issues} language={language} />
          <DetailGrid rows={[
            [translate(language, "requisitionId"), requisition.doc_id],
            [translate(language, "site"), requisition.site],
            [translate(language, "department"), requisition.department],
            [translate(language, "section"), requisition.section ?? "-"],
            [translate(language, "requestType"), requisition.request_type],
            [translate(language, "replacementNames"), requisition.request_type === "Replacement" ? replacementNamesDisplay(requisition.replacement_names) : "-"],
            [translate(language, "owner"), requisition.person_in_charge ?? "-"],
            [translate(language, "lineManager"), requisition.line_manager ?? "-"],
            [translate(language, "headcount"), String(requisition.head_count)],
            [translate(language, "accepted"), String(requisition.accepted_count)],
            [translate(language, "open"), String(requisition.open_headcount)]
          ]} />
          <DetailDisclosure title={translate(language, "workspaceJourney")} summary={`${candidates.length} ${translate(language, "candidatesUnit")} / ${offers.length} ${translate(language, "offersDetail")}`}>
            <PipelineFunnel
              language={language}
              rows={funnelRows}
              subtitle="Historical stage touches, de-duplicated per candidate per stage"
              totalValue={applicantTotal}
            />
          </DetailDisclosure>
          <DetailDisclosure title="Related records" summary="Candidates and offers">
            <div className="grid gap-4">
              <DetailList title={translate(language, "candidates")} rows={candidates.map((row) => optionLabel([row.candidate_id, formatCandidateName(row), processLabel(row.latest_process, language)]))} />
              <DetailList title={translate(language, "offers")} rows={offers.map((row) => `${row.candidate_id} / ${translate(language, "acceptedLower")} ${formatDate(row.accepted_date, language)}`)} />
            </div>
          </DetailDisclosure>
        </div>
      )
    };
  }

  const candidate = enrichCandidates(data).find((row) => row.candidate_id === detail.id);
  if (!candidate) return { title: "Candidate", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
  const logs = latestLogsForCandidate(data, candidate.candidate_id);
  const stageRecords = pipelineStageRecords(logs, data.change_logs).sort((a, b) => {
    const stageOrder = ACTIVE_PIPELINE_STAGES.indexOf(a.stage) - ACTIVE_PIPELINE_STAGES.indexOf(b.stage);
    return stageOrder || a.round - b.round || a.logId - b.logId;
  });
  const canEditCurrentPending = candidatePipelineCapability(candidate, logs, data.profile).canWrite;
  const canEditOffers = canWrite && (
    data.profile?.role === "system_admin" ||
    data.profile?.role === "admin_recruiter" ||
    (data.profile?.role === "site_recruiter" &&
      candidate.site?.trim().toLowerCase() === data.profile.site?.trim().toLowerCase() &&
      [data.profile.nickname, data.profile.full_name]
        .filter((name): name is string => Boolean(name?.trim()))
        .some((name) => candidate.person_in_charge?.trim().toLowerCase() === name.trim().toLowerCase()))
  );
  const offers = data.offers.filter((row) => row.candidate_id === candidate.candidate_id);
  const references = data.candidate_references.filter((row) => row.candidate_id === candidate.candidate_id);
  const referenceChecks = new Map(data.candidate_reference_checks.map((row) => [row.reference_id, row]));
  const availableReferenceCount = references.filter((row) => row.status === "available").length;
  const checkedReferenceCount = references.filter((row) => row.status === "available" && referenceChecks.has(row.reference_id)).length;
  const updateDisabledReason = candidateProcessDisabledReason(candidate, logs, data.profile);
  const issues = deriveDataQualityIssues(data).filter((issue) =>
    issue.entityId === candidate.candidate_id || offers.some((offer) => String(offer.offer_id) === issue.entityId)
  );

  return {
    title: `${candidate.candidate_id} / ${formatCandidateName(candidate)}`,
    headerMeta: (
      <>
        <Tag tone={candidate.latest_result === 0 ? "danger" : candidate.accepted_date ? "success" : "teal"}>{processLabel(candidate.latest_process, language)}</Tag>
        <Tag tone={statusTone(resultText(candidate.latest_result).toLowerCase())}>{resultText(candidate.latest_result, language)}</Tag>
      </>
    ),
      headerActions: (
        <RecordActionGroup
          label={formatCandidateName(candidate)}
          primary={{ id: "workspace", label: "Open workspace", href: href(`/workspace?type=${candidate.group_id ? "group" : "requisition"}&id=${encodeURIComponent(candidate.group_id ?? candidate.doc_ids[0] ?? "")}&section=overview`), tone: "primary", iconOnly: true }}
          items={[
            ...(canWrite ? [{ id: "change-record", label: translate(language, "changeRecord"), onSelect: () => onChangeCandidate(candidate.candidate_id) }] : []),
            ...(canDeleteRecords ? [{
              id: "delete-record",
              label: translate(language, "deleteRecord"),
              tone: "danger" as const,
              onSelect: () => onDeleteRecord("app_delete_recruitment_record", { entity: "candidate", id: candidate.candidate_id }, translate(language, "deleteRecordSummary", { entity: translate(language, "candidate"), id: candidate.candidate_id }))
            }] : []),
            ...(candidate.doc_ids[0] ? [{ id: "requisition", href: href(`/requisitions?detailType=requisition&detailId=${encodeURIComponent(candidate.doc_ids[0])}`), label: "View requisition" }] : []),
            { id: "same-group", href: href(`/candidates?candSearch=${encodeURIComponent(candidate.group_position ?? candidate.doc_group_id ?? "")}`), label: "Same group" },
            { id: "pipeline", href: href(`/pipeline?pipelineSearch=${encodeURIComponent(candidate.candidate_id)}&detailType=candidate&detailId=${encodeURIComponent(candidate.candidate_id)}`), label: "Open in pipeline" }
        ]}
      />
    ),
    body: (
      <div className="grid min-w-0 gap-4">
        <InlineDataQualityIssues
          canResolve={(issue) => canEditOffers && issue.entity === "offer" && offers.some((offer) => String(offer.offer_id) === issue.entityId && offer.accepted_date && offer.first_working_date && offer.first_working_date <= today() && offer.start_confirmation === null)}
          issues={issues}
          language={language}
          onResolve={(issue) => {
            const offer = offers.find((row) => String(row.offer_id) === issue.entityId);
            if (offer) onConfirmOfferStart(offer);
          }}
        />
        <DetailDisclosure title="Workflow" summary={`${logs.length} process updates`} defaultOpen>
          <div className="grid gap-4">
            {!updateDisabledReason.blocked ? (
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[#D7DEE8] bg-lightgray/70 p-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-normal text-slate">Update process</p>
                  <p className="mt-1 text-sm font-medium text-slate">Move this candidate through the workflow using the process controls.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!canWrite}
                  onClick={() => onUpdateCandidate(candidate.candidate_id)}
                >
                  Update process
                </Button>
              </div>
            ) : null}
            <CandidateJourney language={language} logs={logs} />
          </div>
        </DetailDisclosure>
        <DetailGrid rows={[
          [translate(language, "phoneNo"), formatThaiMobilePhone(candidate.phone_no)],
          [translate(language, "email"), candidate.email ?? "-"],
          [translate(language, "nickname"), candidate.nickname ?? "-"],
          ["Group ID", candidate.group_id ?? candidate.doc_group_id ?? "-"],
          ["Doc IDs", candidate.doc_ids.join(", ") || "-"],
          ["Group Position", candidate.group_position ?? "-"],
          ["Site", candidate.site ?? "-"],
          ["Owner", candidate.person_in_charge ?? "-"],
          ["Channel", candidate.channel ?? "-"],
          ["Reference", candidate.ref_name ?? "-"]
        ]} />
        <DetailDisclosure title={translate(language, "contactReferences")} summary={translate(language, "referenceProgress", { checked: checkedReferenceCount, available: availableReferenceCount })} defaultOpen={candidate.latest_process === "Reference Check" && candidate.latest_result === null}>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#D7DEE8] bg-lightgray/70 p-3">
              <p className="text-sm font-medium text-slate">{translate(language, "referencePassRequirement")}</p>
              {canWrite ? <Button type="button" size="icon-sm" variant="secondary" icon={<Plus size={17} />} aria-label={translate(language, "addReference")} title={translate(language, "addReference")} onClick={() => onEditReference(candidate.candidate_id)} /> : null}
            </div>
            {references.length === 0 ? <p className="text-sm font-medium text-slate">{translate(language, "noContactReferences")}</p> : references.map((reference) => {
              const check = referenceChecks.get(reference.reference_id);
              const channel = reference.channel_type === "other" ? reference.other_channel_label ?? "Other" : reference.channel_type.toUpperCase();
              return (
                <div key={reference.reference_id} className="rounded-md border border-[#D7DEE8] bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-navy">{reference.reference_name} <span className="font-medium text-slate">/ {reference.relationship}</span></p>
                      <p className="mt-1 break-words text-sm text-slate">{channel}: {reference.channel_value}</p>
                    </div>
                      <Tag tone={reference.status === "available" ? (check ? "success" : "warning") : "muted"}>{reference.status === "available" ? (check ? translate(language, "referenceChecked") : translate(language, "referenceAwaitingCheck")) : reference.status === "unavailable" ? translate(language, "referenceUnavailable") : translate(language, "referenceArchived")}</Tag>
                  </div>
                  {reference.status_reason ? <p className="mt-2 text-sm text-slate">{reference.status_reason}</p> : null}
                  {check ? <p className="mt-2 text-sm font-medium text-slate">{translate(language, "referenceCheckSummary", { date: formatDate(check.checked_date, language), minutes: check.duration_minutes, summary: check.conversation_summary })}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canWrite ? <Button type="button" size="sm" variant="secondary" onClick={() => onEditReference(candidate.candidate_id, reference.reference_id)}>{translate(language, "edit")}</Button> : null}
                    {canWrite && reference.status === "available" ? <Button type="button" size="sm" variant="secondary" onClick={() => onSaveReferenceCheck(candidate.candidate_id, reference.reference_id)}>{check ? translate(language, "editReferenceCheck") : translate(language, "recordReferenceCheck")}</Button> : null}
                    {canWrite ? <Button type="button" size="sm" variant="secondary" onClick={() => onSetReferenceStatus(candidate.candidate_id, reference.reference_id)}>{reference.status === "available" ? translate(language, "markReferenceUnavailableOrArchive") : translate(language, "changeStatus")}</Button> : null}
                    <a className="self-center text-xs font-semibold text-primary underline" href={`/audit?entity=candidate_references&entityId=${reference.reference_id}`}>{translate(language, "viewAudit")}</a>
                  </div>
                </div>
              );
            })}
          </div>
        </DetailDisclosure>
        <DetailDisclosure title="Activity" summary="Stage records and offers" defaultOpen>
          <div className="grid gap-4">
            <div>
              <h4 className="mb-2 font-semibold text-navy">{translate(language, "currentStage")}</h4>
              <div className="grid gap-2">
                {stageRecords.filter((record) => !record.outcome).map((record) => (
                  <div key={record.stageInstanceId} className="min-w-0 rounded-md border border-[#D7DEE8] bg-white p-3 shadow-[0_6px_16px_rgba(11,19,43,0.025)]">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <strong className="min-w-0 break-words text-navy">{processLabel(record.stage, language)} / {translate(language, "round")} {record.round}</strong>
                      <Tag tone="warning">{translate(language, "awaitingOutcome")}</Tag>
                    </div>
                    <p className="mt-1 break-words text-sm font-medium text-slate">{translate(language, "pendingDetails")}: {formatDate(record.pending.openedDate, language)} / {record.pending.interviewer ?? translate(language, "noInterviewer")}</p>
                    {record.pending.estimatedActionDate ? <p className="mt-1 break-words text-sm font-semibold text-primary">{translate(language, "estimatedDateValue", { date: formatDate(record.pending.estimatedActionDate, language) })}</p> : null}
                    {record.pending.remark ? <p className="mt-1 break-words text-sm text-slate">{record.pending.remark}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {record.pending.editedAt ? <Tag tone="muted">{translate(language, "edited")}</Tag> : null}
                      {record.origin === "migration" ? <Tag tone="muted">{translate(language, "migrated")}</Tag> : null}
                      {canEditCurrentPending ? <Button type="button" size="sm" variant="secondary" onClick={() => onEditPending(candidate)}>{translate(language, "edit")}</Button> : null}
                      <a className="text-xs font-semibold text-primary underline" href={`/audit?entity=recruitment_logs&entityId=${record.logId}`}>{translate(language, "viewAudit")}</a>
                    </div>
                    {record.migrationNote ? <p className="mt-2 break-words text-xs font-medium text-slate">{record.migrationNote}</p> : null}
                  </div>
                ))}
                {stageRecords.every((record) => record.outcome) ? <p className="text-sm font-medium text-slate">{translate(language, "noData")}</p> : null}
              </div>
              <h4 className="mb-2 mt-4 font-semibold text-navy">{translate(language, "completedStageHistory")}</h4>
              <div className="grid gap-2">
                {stageRecords.filter((record) => record.outcome).map((record) => (
                  <div key={record.stageInstanceId} className="min-w-0 rounded-md border border-[#D7DEE8] bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-navy">{processLabel(record.stage, language)} / {translate(language, "round")} {record.round}</strong><Tag tone={record.outcome?.result === "pass" ? "success" : "danger"}>{record.outcome?.result === "pass" ? resultText(1, language) : resultText(0, language)}</Tag></div>
                    <p className="mt-1 text-sm font-medium text-slate">{translate(language, "pendingDetails")}: {formatDate(record.pending.openedDate, language)} / {record.pending.interviewer ?? translate(language, "noInterviewer")}</p>
                    {record.pending.estimatedActionDate ? <p className="mt-1 text-sm font-semibold text-primary">{translate(language, "estimatedDateValue", { date: formatDate(record.pending.estimatedActionDate, language) })}</p> : null}
                    <p className="mt-1 text-sm font-medium text-slate">{translate(language, "outcome")}: {formatDate(record.outcome?.date, language)} / {record.outcome?.interviewer ?? translate(language, "noInterviewer")}</p>
                    {record.outcome?.remark ? <p className="mt-1 break-words text-sm text-slate">{translate(language, "remark")}: {record.outcome.remark}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {record.pending.editedAt ? <Tag tone="muted">{translate(language, "edited")}</Tag> : null}
                      {record.origin === "migration" ? <Tag tone="muted">{translate(language, "migrated")}</Tag> : null}
                      <a className="text-xs font-semibold text-primary underline" href={`/audit?entity=recruitment_logs&entityId=${record.logId}`}>{translate(language, "viewAudit")}</a>
                    </div>
                    {record.migrationNote ? <p className="mt-2 break-words text-xs font-medium text-slate">{record.migrationNote}</p> : null}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="mb-2 font-semibold text-navy">{translate(language, "offers")}</h4>
              <div className="grid gap-2">
                {offers.length === 0 ? <p className="text-sm font-medium text-slate">{translate(language, "noData")}</p> : offers.map((offer) => (
                  <div key={offer.offer_id} className="grid gap-3 rounded-md border border-[#D7DEE8] bg-white p-3">
                    <section className="rounded-md border border-[#E4E9F2] bg-[#F8FAFD] p-3">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate">Offer record</p>
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-navy">{offer.doc_id}</strong><div className="flex flex-wrap gap-2">{canEditOffers ? <Button type="button" size="sm" variant="secondary" onClick={() => onEditOffer(offer)}>{translate(language, "edit")}</Button> : null}</div></div>
                    <p className="mt-1 text-sm font-medium text-slate">{translate(language, "acceptedLower")}: {formatDate(offer.accepted_date, language)}</p>
                    <p className="mt-1 text-sm font-medium text-slate">{translate(language, "startLower")}: {formatDate(offer.first_working_date, language)}</p>
                    {offer.remark ? <p className="mt-1 break-words text-sm text-slate">{offer.remark}</p> : null}
                    </section>
                    <section className="rounded-md border border-[#E4E9F2] bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate">Come to work</p>
                    <p className="mt-1 text-sm font-medium text-slate">First working date attendance: {offer.start_confirmation ? `${offer.start_confirmation === "started" ? "Started work" : "Did not start"}${offer.start_confirmed_at ? ` / ${formatDate(offer.start_confirmed_at, language)}` : ""}${offer.start_confirmation_reason ? ` — ${offer.start_confirmation_reason}` : ""}` : offer.first_working_date && offer.first_working_date > today() ? "Available on the first working date" : "Not confirmed"}</p>
                    {canEditOffers && offer.accepted_date && offer.first_working_date && offer.first_working_date <= today() && (!offer.start_confirmation || ["system_admin", "admin_recruiter"].includes(data.profile?.role ?? "")) ? <Button type="button" className="mt-3" size="sm" variant="secondary" onClick={() => onConfirmOfferStart(offer)}>{offer.start_confirmation ? "Correct start" : "Confirm start"}</Button> : null}
                    </section>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DetailDisclosure>
        {candidate.candidate_folder_url ? (
          <a className="text-sm font-semibold text-primary underline" href={candidate.candidate_folder_url} target="_blank" rel="noreferrer">Open candidate folder</a>
        ) : null}
      </div>
    )
  };
}

function readinessTextClass(tone: string) {
  if (tone === "danger") return "text-scarlet";
  if (tone === "warning") return "text-orange";
  if (tone === "success") return "text-primary";
  return "text-slate";
}

function buildDetailBody(detail: { type: "requisition" | "candidate"; id: string } | null, data: DashboardData, language: Language, canWrite: boolean, onUpdateCandidate: (candidateId: string) => void) {
  if (!detail) return { title: "Detail", body: null };

  if (detail.type === "requisition") {
    const requisition = enrichRequisitions(data).find((row) => row.doc_id === detail.id);
    if (!requisition) return { title: "Requisition", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
    const groups = data.document_groups.filter((row) => row.doc_id === requisition.doc_id);
    const positionGroupIds = new Set(groups.map((row) => row.group_id).filter(Boolean) as string[]);
    const relatedDocGroupIds = positionGroupIds.size > 0
      ? new Set(data.document_groups.filter((row) => row.group_id && positionGroupIds.has(row.group_id)).map((row) => row.doc_group_id))
      : new Set(groups.map((row) => row.doc_group_id));
    const candidates = enrichCandidates(data).filter((row) => row.group_id ? positionGroupIds.has(row.group_id) : Boolean(row.doc_group_id && relatedDocGroupIds.has(row.doc_group_id)));
    const offers = data.offers.filter((row) => row.doc_id === requisition.doc_id);
    const applicantTotal = applicantCountForPositionGroups(data, positionGroupIds);
    const funnelRows = buildPipelineFunnelRows(applicantTotal, historicalPipelineCountsForCandidates(data, candidates.map((row) => row.candidate_id)), language);
    const allCandidates = enrichCandidates(data);
    const readiness = requisitionFillReadiness(requisition, allCandidates);
    const issues = deriveDataQualityIssues(data).filter((issue) => issue.entityId === requisition.doc_id || candidates.some((candidate) => candidate.candidate_id === issue.entityId) || offers.some((offer) => String(offer.offer_id) === issue.entityId));

    return {
      title: formatRequisitionTitle(requisition),
      body: (
        <div className="grid gap-5">
          <div className="rounded-md border border-[#D7DEE8] bg-lightgray/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-slate">Fill readiness</p>
                <p className="mt-1 text-sm font-medium text-slate">{readiness.reason}</p>
              </div>
              <Tag tone={readiness.tone}>{fillReadinessLabel(language, readiness.label)}</Tag>
            </div>
            <RecordActionGroup
              label={formatRequisitionOptionLabel(requisition)}
              primary={{ id: "workspace", href: `/workspace?type=requisition&id=${encodeURIComponent(requisition.doc_id)}`, label: "Open workspace", tone: "primary", iconOnly: true }}
              items={[
                { id: "sourcing", href: `/sourcing?site=${encodeURIComponent(requisition.site)}&pic=${encodeURIComponent(requisition.person_in_charge ?? "")}`, label: "Open sourcing", tone: "primary" },
                { id: "candidates", href: `/candidates?candSearch=${encodeURIComponent(requisition.doc_id)}`, label: "Related candidates" },
                { id: "offers", href: `/offers?offerSearch=${encodeURIComponent(requisition.doc_id)}`, label: "Related offers" }
              ]}
            />
          </div>
          <InlineDataQualityIssues issues={issues} language={language} />
          <DetailGrid rows={[
            [translate(language, "requisitionId"), requisition.doc_id],
            ["Site", requisition.site],
            ["Department", requisition.department],
            ["Section", requisition.section ?? "-"],
            ["Request Type", requisition.request_type],
            ["Replacement Names", requisition.request_type === "Replacement" ? replacementNamesDisplay(requisition.replacement_names) : "-"],
            ["Owner", requisition.person_in_charge ?? "-"],
            ["Line Manager", requisition.line_manager ?? "-"],
            ["Headcount", String(requisition.head_count)],
            ["Accepted", String(requisition.accepted_count)],
            ["Open", String(requisition.open_headcount)]
          ]} />
          <PipelineFunnel
            language={language}
            rows={funnelRows}
            subtitle="Historical stage touches, de-duplicated per candidate per stage"
            totalValue={applicantTotal}
          />
          <DetailList title={translate(language, "candidates")} rows={candidates.map((row) => optionLabel([row.candidate_id, formatCandidateName(row), processLabel(row.latest_process, language)]))} />
          <DetailList title={translate(language, "offers")} rows={offers.map((row) => `${row.candidate_id} - ${translate(language, "acceptedLower")} ${formatDate(row.accepted_date, language)}`)} />
        </div>
      )
    };
  }

  const candidate = enrichCandidates(data).find((row) => row.candidate_id === detail.id);
  if (!candidate) return { title: "Candidate", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
  const logs = latestLogsForCandidate(data, candidate.candidate_id);
  const offers = data.offers.filter((row) => row.candidate_id === candidate.candidate_id);
  const updateDisabledReason = candidateProcessDisabledReason(candidate, logs, data.profile);
  const issues = deriveDataQualityIssues(data).filter((issue) => issue.entityId === candidate.candidate_id || offers.some((offer) => String(offer.offer_id) === issue.entityId));

  return {
    title: `${candidate.candidate_id} · ${formatCandidateName(candidate)}`,
    body: (
      <div className="grid gap-5">
        {!updateDisabledReason.blocked ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-slate">Pipeline Action</p>
              <p className="mt-1 text-sm font-medium text-slate">Update this candidate through the available process controls.</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onUpdateCandidate(candidate.candidate_id)}
                >
                  Update
                </Button>
              ) : <Tag tone="muted">{translate(language, "readonly")}</Tag>}
            </div>
          </div>
        ) : null}
        <InlineDataQualityIssues issues={issues} language={language} />
        <RecordActionGroup
          label={formatCandidateName(candidate)}
          primary={{ id: "workspace", href: `/workspace?type=${candidate.group_id ? "group" : "requisition"}&id=${encodeURIComponent(candidate.group_id ?? candidate.doc_ids[0] ?? "")}`, label: "Open workspace", tone: "primary", iconOnly: true }}
          items={[
            ...(candidate.doc_ids[0] ? [{ id: "requisition", href: `/requisitions?detailType=requisition&detailId=${encodeURIComponent(candidate.doc_ids[0])}`, label: "View requisition", tone: "primary" as const }] : []),
            { id: "same-group", href: `/candidates?candSearch=${encodeURIComponent(candidate.group_position ?? candidate.doc_group_id ?? "")}`, label: "Same group" },
            { id: "pipeline", href: `/pipeline?detailType=candidate&detailId=${encodeURIComponent(candidate.candidate_id)}`, label: "Open in pipeline" }
          ]}
        />
        <DetailGrid rows={[
          [translate(language, "phoneNo"), formatThaiMobilePhone(candidate.phone_no)],
          [translate(language, "nickname"), candidate.nickname ?? "-"],
          ["Group ID", candidate.group_id ?? candidate.doc_group_id ?? "-"],
          ["Doc IDs", candidate.doc_id ?? "-"],
          ["Group Position", candidate.group_position ?? "-"],
          ["Site", candidate.site ?? "-"],
          ["Owner", candidate.person_in_charge ?? "-"],
          ["Channel", candidate.channel ?? "-"],
          ["Reference", candidate.ref_name ?? "-"],
          ["Folder", candidate.candidate_folder_url ? "Open candidate folder" : "-"]
        ]} />
        {candidate.candidate_folder_url ? (
          <a className="text-sm font-semibold text-primary underline" href={candidate.candidate_folder_url} target="_blank" rel="noreferrer">Open candidate folder</a>
        ) : null}
        <CandidateJourney language={language} logs={logs} />
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-navy">Timeline</h4>
          </div>
          <div className="grid gap-2">
            {logs.length === 0 ? <p className="text-sm font-medium text-slate">No process logs yet.</p> : logs.map((log) => (
              <div key={log.log_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-[0_6px_16px_rgba(11,19,43,0.025)]">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-navy">{processLabel(log.recruitment_process, language)}</strong>
                  <Tag tone={statusTone(resultText(log.result).toLowerCase())}>{resultText(log.result, language)}</Tag>
                </div>
                <p className="mt-1 text-sm font-bold text-slate">{formatDate(log.log_date, language)} - {translate(language, "round")} {log.round} - {log.interviewer ?? translate(language, "noInterviewer")}</p>
                {log.remark ? <p className="mt-1 text-sm text-slate">{log.remark}</p> : null}
              </div>
            ))}
          </div>
        </div>
        <DetailList title={translate(language, "offers")} rows={offers.map((row) => `${row.doc_id} - ${translate(language, "acceptedLower")} ${formatDate(row.accepted_date, language)} - ${translate(language, "startLower")} ${formatDate(row.first_working_date, language)}`)} />
      </div>
    )
  };
}

function replacementNamesDisplay(value: string | null | undefined) {
  const names = splitReplacementNames(value).filter(Boolean);
  return names.length > 0 ? names.join(", ") : "-";
}

function CandidateJourney({ language, logs }: { language: Language; logs: RecruitmentLog[] }) {
  return <StageRail language={language} logs={logs} label={translate(language, "candidatePipelineJourney")} />;
}

type PipelineFunnelCount = {
  stage: PipelineDisplayStage;
  count: number;
};

function historicalPipelineCountsForCandidates(data: DashboardData, candidateIds: string[]): PipelineFunnelCount[] {
  const relatedCandidateIds = new Set(candidateIds);
  return PIPELINE_FUNNEL_STAGES.map((stage) => {
    const stageCandidateIds = new Set(
      data.recruitment_logs
        .filter((log) => {
          if (!relatedCandidateIds.has(log.candidate_id)) return false;
          if (stage === "Resume Screening") return log.recruitment_process === "Phone Screen";
          return log.recruitment_process === stage && log.result === 1;
        })
        .map((log) => log.candidate_id)
    );
    return { stage, count: stageCandidateIds.size };
  });
}

function applicantCountForPositionGroups(data: DashboardData, groupIds: Set<string>) {
  if (groupIds.size === 0) return 0;
  return data.sourcing_weekly_updates
    .filter((update) => groupIds.has(update.group_id))
    .reduce(
      (sum, update) => sum + SOURCING_CHANNELS.reduce((channelSum, channel) => channelSum + Number(update[channel.count] ?? 0), 0),
      0
    );
}

function buildPipelineFunnelRows(applicantTotal: number, stageCounts: PipelineFunnelCount[], language: Language): PipelineFunnelRow[] {
  const baseRows = [
    { key: "applicants", label: translate(language, "applicants"), count: applicantTotal },
    ...stageCounts.map((row) => ({ key: row.stage, label: pipelineDisplayLabel(row.stage, language), count: row.count }))
  ];

  return baseRows.map((row, index) => {
    const previousCount = index > 0 ? baseRows[index - 1].count : null;
    return {
      ...row,
      conversionRate: previousCount && previousCount > 0 ? row.count / previousCount : null,
      yieldRate: applicantTotal > 0 ? row.count / applicantTotal : null,
      barRatio: applicantTotal > 0 ? Math.min(row.count / applicantTotal, 1) : null
    };
  });
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid min-w-0 gap-3 rounded-lg border border-[#D7DEE8] bg-lightgray p-4 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-normal text-slate">{label}</dt>
          <dd className="mt-1 break-words font-semibold text-navy">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <h4 className="mb-2 font-semibold text-navy">{title}</h4>
      <div className="grid gap-2">
        {rows.length === 0 ? (
          <p className="text-sm font-medium text-slate">No records.</p>
        ) : (
          rows.map((row) => <div key={row} className="min-w-0 break-words rounded-md border border-[#D7DEE8] bg-white p-3 text-sm font-medium text-slate shadow-[0_6px_16px_rgba(11,19,43,0.025)]">{row}</div>)
        )}
      </div>
    </div>
  );
}

function DetailDisclosure({ children, defaultOpen = false, summary, title }: { children: ReactNode; defaultOpen?: boolean; summary: string; title: string }) {
  return (
    <details className="group min-w-0 rounded-md border border-[#D7DEE8] bg-white" open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/25 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold text-navy">{title}</span>
        <span className="text-right text-xs font-medium text-slate group-open:hidden">{summary}</span>
        <span className="hidden text-xs font-semibold text-primary group-open:inline">Hide</span>
      </summary>
      <div className="min-w-0 border-t border-[#D7DEE8] p-4">{children}</div>
    </details>
  );
}

function hasLatestOfferPass(data: DashboardData, candidateId: string) {
  const latest = latestLogsForCandidate(data, candidateId)[0];
  return latest?.recruitment_process === "Offer" && latest.result === 1;
}

function modalTitle(language: Language, modal: ModalName) {
  const titles: Record<Exclude<ModalName, null>, string> = {
    requisition: "modalRequisition", status: "modalRequisitionStatus", candidate: "modalCandidate", candidate_reference: "modalReference",
    reference_status: "modalReferenceStatus", reference_check: "modalReferenceCheck", pipeline_start: "modalStartPhoneScreen", pending_edit: "modalEditPending",
    pipeline_record_correction: "modalEditPipeline", stage_outcome: "modalCompleteStage", pipeline_pass: "modalConfirmStages", offer: "modalOffer",
    start_confirmation: "modalNewHire", group: "modalSourcingGroup", group_match: "modalCreateMatchGroup", match: "modalMatchRequisitionGroup",
    snapshot: "modalVacancySnapshot", user: "modalManageUser"
  };
  return modal ? translate(language, titles[modal]) : "";
}

function modalDialogTitle(language: Language, modal: ModalName, mode: "new" | "change") {
  if (!modal) return "";
  if (modal === "group_match") return translate(language, "modalCreateMatchGroup");
  const editableLabels: Partial<Record<Exclude<ModalName, null>, string>> = {
    requisition: translate(language, "modalRequisition"),
    candidate: translate(language, "modalCandidate"),
    candidate_reference: translate(language, "reference"),
    reference_status: translate(language, "referenceStatus"),
    reference_check: translate(language, "referenceCheck"),
    offer: translate(language, "modalOffer"),
    group: translate(language, "modalSourcingGroup"),
    user: translate(language, "modalUser")
  };
  const label = editableLabels[modal];
  if (!label) return modalTitle(language, modal);
  const action = mode === "change" ? translate(language, "edit") : translate(language, "create");
  return `${action} ${label}`;
}

function today() {
  return formatLocalDateInput();
}

function currentWeekStart() {
  return currentLocalWeekStart();
}

function offerPassHandoffFromResult(result: RpcResult, data: DashboardData): OfferPassHandoff | null {
  const handoff = result.offer_handoff;
  if (!handoff?.candidate_id || !handoff.passed_date) return null;
  const candidate = data.candidates.find((row) => row.candidate_id === handoff.candidate_id);
  const docId = handoff.requisitions?.[0]?.doc_id
    ?? data.document_groups.find((row) => row.doc_group_id === candidate?.doc_group_id)?.doc_id;
  return docId ? { candidateId: handoff.candidate_id, docId, passedDate: handoff.passed_date } : null;
}

function parseWorkspaceUrlState(): ParsedWorkspaceUrlState {
  if (typeof window === "undefined") {
    return { language: null, site: null, owner: null, sourcingWeek: null, detailType: null, detailId: null, workspaceType: null, workspaceId: null, hasFilterParams: false };
  }
  const params = readWorkspaceUrlParams();
  const language = params.get("lang");
  const parsedLanguage: Language | null = language === "en" || language === "th" ? language : null;
  const detailType = params.get("detailType");
  const workspaceType = params.get("type");
  return {
    language: parsedLanguage,
    site: params.get("site") ?? params.get("sourcingSite"),
    owner: params.get("pic") ?? params.get("sourcingOwner"),
    sourcingWeek: params.get("sourcingWeek"),
    detailType: detailType === "candidate" || detailType === "requisition" ? detailType : null,
    detailId: params.get("detailId"),
    workspaceType: workspaceType === "requisition" || workspaceType === "group" ? workspaceType : null,
    workspaceId: params.get("id"),
    hasFilterParams: params.has("site") || params.has("pic") || params.has("sourcingSite") || params.has("sourcingOwner")
  };
}

function WorkspaceStatusScreen({
  busy,
  loginHref,
  message,
  onRetry,
  title
}: {
  busy: boolean;
  loginHref?: string;
  message: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-offwhite p-6">
      <Panel className="w-full max-w-md">
        <div role="status" aria-live="polite" aria-busy={busy} className="grid gap-3 text-center">
          {busy ? <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[#D7DEE8] border-t-primary" /> : null}
          <h1 className="text-xl font-semibold text-navy">{title}</h1>
          <p className="text-sm font-medium text-slate">{message}</p>
          {loginHref ? (
            <div>
              <a href={loginHref} className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
                Go to sign in
              </a>
            </div>
          ) : null}
          {onRetry ? (
            <div>
              <Button type="button" variant="secondary" onClick={onRetry}>Retry</Button>
            </div>
          ) : null}
        </div>
      </Panel>
    </main>
  );
}

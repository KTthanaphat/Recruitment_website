"use client";
import { AttendanceDecisionActions } from "@/components/ui/AttendanceDecisionActions";
import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { NumberSkeleton, LoadingSkeleton, RefreshIndicator } from "@/components/ui/LoadingSkeleton";
import { clearRecruitmentReadQueue } from "@/lib/recruitment-read-scheduler";
import { candidateCanUseGroup, profileCapabilities, canManageApplicationGroup, eligibleApplicationGroups, canManageCandidateJourney } from "@/lib/applications";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Requisition } from "@/types/recruitment";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Activity, AlertTriangle, Bookmark, BriefcaseBusiness, Building2, CalendarDays, CalendarPlus, CheckCircle2, ContactRound, Copy, Factory, EyeOff, Files, Hash, Info, LampDesk, Layers3, Mail, Network, Pencil, Phone, Plus, RefreshCw, Send, UserRound, UsersRound, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CandidateRegistry } from "@/components/candidates/CandidateRegistry";
import { clearRecruitmentListCache, invalidateRecruitmentListsForMutation, useRecruitmentList } from "@/lib/recruitment-list";
import { loadCandidateDetail } from "@/lib/candidate-detail-loader";
import { clearScopedDetailCache } from "@/lib/scoped-detail-cache";
import { loadAuthorizedRecruiterOptions } from "@/lib/recruiter-options-client";
import { loadScopedRequisitionDetail } from "@/lib/requisition-detail-loader";
import { fetchApplicationDestinations, type ApplicationDestination } from "@/lib/application-destinations";
import { fetchOfferCandidates, type OfferCandidateCursor, type OfferCandidateOption } from "@/lib/offer-candidates";
import { readScopedInPages } from "@/lib/scoped-detail-read";
import { clearPipelineSummaryCache } from "@/lib/pipeline-summary-loader";
import { clearDashboardSummaryCache, loadDashboardFilterOptions, loadHomeBannerSummary, loadWelcomeSummary, type HomeBannerSummary, type WelcomeSummary } from "@/lib/dashboard-summary-client";
import { DetailGrid, SectionHeading } from "@/components/ui/RecordDetailFields";
import { CandidateProfilePanel, CandidateApplicationDetailsExtras } from "@/components/candidates/CandidateProfilePanel";
import { applicationLogs, belongsToApplication, selectedApplication, applicationKey } from "@/lib/applications";
import { HomeView } from "@/components/dashboard/HomeView";
import { WelcomeBackPrompt } from "@/components/dashboard/WelcomeBackPrompt";
import { clearDashboardReportCache, readReportPages } from "@/lib/dashboard-report-loader";
import { DASHBOARD_SESSION_PREFIX } from "@/lib/dashboard-filters";
import { DesktopInteractionContext } from "@/components/layout/DesktopInteractionContext";
import { DesktopRequiredNotice } from "@/components/layout/DesktopRequiredNotice";
import { isDesktopOnlyView, isViewAvailable, useLayoutMode, type LayoutMode } from "@/lib/responsive-layout";
import { AppShell } from "@/components/layout/AppShell";
import { OffersView } from "@/components/offers/OffersView";
import { PipelineBoardView } from "@/components/pipeline/PipelineBoardView";
import { RejectionLetterComposer } from "@/components/rejection-letters/RejectionLetterComposer";
import { FailureReasonFields } from "@/components/rejection-reasons/FailureReasonFields";
import { failureActorLabel, failureReasonText } from "@/lib/rejection-reasons";
import { TeamsInterviewComposer } from "@/components/interviews/TeamsInterviewComposer";
import { RequisitionPriorityButton } from "@/components/requisitions/RequisitionPriorityButton";
import { canManageRequisitionPriority, priorityRequisitionScope } from "@/lib/requisition-priority";
import { RequisitionsView } from "@/components/requisitions/RequisitionsView";
import { AuthorizedRequisitionLookup } from "@/components/requisitions/AuthorizedRequisitionLookup";
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
import { currentLocalSourcingCycleSaturday, formatLocalDateInput, sourcingCycleSaturday } from "@/lib/dates";
import { appendLegacyOption, departmentOptions, sectionOptionsForDepartment, type DepartmentSectionRow } from "@/lib/department-section-data";
import {
  emptyDashboardData,
  enrichCandidates,
  enrichOffers,
  enrichRequisitions,
  enrichSourcingGroups,
  filterChangeLogsByText,
  filterByText,
  latestLogsForCandidate,
  loadRecruitmentBootstrap,
  sourcingChannelsForGroup,
  sourcingGroupsInScope,
  staleOpenSourcingGroups,
  uniqueValues
} from "@/lib/data";
import { boolFromForm, emptyToNull, formatCandidateName, formatDate, formatDateTime, formatNumber, formatRecruitmentId, formatRequisitionOptionLabel, formatRequisitionTitle, formatThaiMobilePhone, resultText, statusTone } from "@/lib/format";
import { sourcingLinkReadinessLabel, sourcingLinkReadinessReason, requisitionStatusLabel, requestTypeLabel, roleLabel, translate } from "@/lib/i18n/dictionary";
import { activeProcessStage, candidatePipelineCapability, candidateProcessDisabledReason, deriveDataQualityIssues, latestSuccessfulOfferPassDate, pipelineMoveDisabledReason, pipelineStageRecords, requisitionSourcingLinkReadiness, type SourcingLinkReadiness } from "@/lib/operations";
import { getRequisitionAgeDays, getRequisitionSlaState } from "@/lib/sla";
import { clearStoredSupabaseSession, hasSupabaseConfig, supabase, withAuthTimeout } from "@/lib/supabase/client";
import { asNumber, requireFields } from "@/lib/validation/forms";
import { buildContextualHref, pushWorkspaceUrlState, readWorkspaceUrlState as readWorkspaceUrlParams, updateWorkspaceUrlState, useWorkspaceUrlState } from "@/lib/workspace-url-state";
import type {
  DashboardData,
  DashboardReportData,
  CandidateReference,
  CandidateReferenceCheck,
  EnrichedCandidate,
  EnrichedRequisition,
  EnrichedSourcingGroup,
  InterviewInvitationTemplate,
  InterviewMeeting,
  Language,
  Offer,
  OfferPassHandoff,
  Profile,
  ProcessStage,
  RejectionReason,
  RecruitmentLog,
  RequisitionRequestType,
  RequisitionStatus,
  RpcResult,
  ViewId,
  WorkspaceActionRequest
} from "@/types/recruitment";

const AdminView = dynamic(() => import("@/components/admin/AdminView").then(module => module.AdminView));
const AuditView = dynamic(() => import("@/components/audit/AuditView").then(module => module.AuditView));
const ConfigurationView = dynamic(() => import("@/components/configuration/ConfigurationView").then(module => module.ConfigurationView));
const DashboardPortal = dynamic(() => import("@/components/dashboard/DashboardPortal").then(module => module.DashboardPortal));

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
  application_id?: string;
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
  failure_actor?: "candidate" | "company" | null;
  failure_main_reason_id?: string | null;
  failure_detail_reason_id?: string | null;
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
  application_id?: string;
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

type WorkspaceLoadState = "checking_session" | "redirecting_to_login" | "loading_data" | "ready" | "error";
type ParsedWorkspaceUrlState = {
  detailId: string | null;
  detailType: "candidate" | "requisition" | null;
  hasFilterParams: boolean;
  language: Language | null;
  owner: string | null;
  priorityOnly: boolean;
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
      owner: typeof filters.owner === "string" ? filters.owner : "",
      priorityOnly: filters.priorityOnly === true
    };
  } catch {
    return null;
  }
}

const rpcByModal: Record<Exclude<ModalName, null | "user">, string> = {
  requisition: "app_upsert_requisition",
  status: "app_insert_requisition_log",
  candidate: "app_upsert_candidate_profile_v2",
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
  const layoutMode = useLayoutMode();
  const workspaceUrlState = useWorkspaceUrlState();
  const [language, setLanguage] = useState<Language>("th");
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [companyDashboardReport, setCompanyDashboardReport] = useState<DashboardReportData | null>(null);
  const [workspaceLoadState, setWorkspaceLoadState] = useState<WorkspaceLoadState>("checking_session");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading recruitment records...");
  const [error, setError] = useState<string | null>(null);
  const [updateDenial, setUpdateDenial] = useState<string | null>(null);
  const [filters, setFilters] = useState({ site: "", owner: "", priorityOnly: false });
  const [sourcingWeek, setSourcingWeek] = useState(currentWeekStart());
  const [duplicateReview,setDuplicateReview]=useState<{matches:Array<{candidate_id:string;phone:boolean;email:boolean}>;payload:Record<string,unknown>;summary:string}|null>(null);
  const [candidateReviewBusy,setCandidateReviewBusy]=useState(false);
  const [candidateReviewError,setCandidateReviewError]=useState<string|null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [candidateDetail, setCandidateDetail] = useState<{ key: string; data: DashboardData | null; loading: boolean; error: string | null }>({ key: "", data: null, loading: false, error: null });
  const [candidateDetailRetry, setCandidateDetailRetry] = useState(0);
  const [candidateActionContext, setCandidateActionContext] = useState<{ key: string; scopeKey: string; candidate: EnrichedCandidate; data: DashboardData } | null>(null);
  const [requisitionDetail, setRequisitionDetail] = useState<{ key: string; loading: boolean; error: string | null; result: Awaited<ReturnType<typeof loadScopedRequisitionDetail>> | null }>({ key: "", loading: false, error: null, result: null });
  const [requisitionDetailRetry, setRequisitionDetailRetry] = useState(0);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingSaveLock = useRef(false);
  const [destructiveAction, setDestructiveAction] = useState<DestructiveAction | null>(null);
  const [offerPassHandoff, setOfferPassHandoff] = useState<OfferPassHandoff | null>(null);
  const [processDefaults, setProcessDefaults] = useState<ProcessDefaults>({});
  const [modalDefaults, setModalDefaults] = useState<ModalDefaults>({});
  const [guideStep, setGuideStep] = useState<GuideStep>(null);
  const [guideContext, setGuideContext] = useState<GuideContext>({});
  const [detail, setDetail] = useState<{ type: "requisition" | "candidate"; id: string } | null>(null);
  const [journeyActionCandidateId, setJourneyActionCandidateId] = useState<string | null>(null);
  const [rejectionLetterCandidateId, setRejectionLetterCandidateId] = useState<string | null>(null);
  const [rejectionLetterRetryDraftId, setRejectionLetterRetryDraftId] = useState<string | null>(null);
  const [currentStageActionCandidateId, setCurrentStageActionCandidateId] = useState<string | null>(null);
  const [workspaceTarget, setWorkspaceTarget] = useState<{ type: "requisition" | "group" | null; id: string | null }>({ type: null, id: null });
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [welcomeSummary, setWelcomeSummary] = useState<WelcomeSummary | null>(null);
  const [welcomeSummaryLoading, setWelcomeSummaryLoading] = useState(false);
  const [welcomeSummaryError, setWelcomeSummaryError] = useState<string | null>(null);
  const [welcomeSummaryRetry, setWelcomeSummaryRetry] = useState(0);
  const [homeBannerSummary, setHomeBannerSummary] = useState<HomeBannerSummary | null>(null);
  const [homeBannerLoading, setHomeBannerLoading] = useState(false);
  const [homeBannerError, setHomeBannerError] = useState<string | null>(null);
  const [homeBannerRetry, setHomeBannerRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [urlStateReady, setUrlStateReady] = useState(false);

  const [desktopLocks, setDesktopLocks] = useState<Record<string, boolean>>({});
  const registerDesktopLock = useCallback((id: string, active: boolean) => {
    setDesktopLocks(current => {
      if (Boolean(current[id]) === active) return current;
      const next = { ...current }; if (active) next[id] = true; else delete next[id]; return next;
    });
  }, []);
  const loadedScopeRef = useRef<"profile" | "mobile" | "desktop" | null>(null);
  const loadGeneration = useRef(0);
  const fullDataLoaded = loadedScopeRef.current === "desktop" || loadedScopeRef.current === "mobile";
  const protectedInteraction = fullDataLoaded && (busy || Boolean(activeModal || pendingAction || destructiveAction || detail || currentStageActionCandidateId || rejectionLetterCandidateId) || Object.keys(desktopLocks).length > 0);
  const previousLayout = useRef<LayoutMode>("unknown"), resizeGrace = useRef(false);
  if (previousLayout.current !== layoutMode) {
    resizeGrace.current = previousLayout.current === "desktop" && layoutMode === "mobile" && protectedInteraction;
    previousLayout.current = layoutMode;
  }
  if (!protectedInteraction) resizeGrace.current = false;
  const desktopRequired = layoutMode === "mobile" && !isViewAvailable(initialView, layoutMode) && !resizeGrace.current;
  const loadScope = desktopRequired ? "profile" : layoutMode === "mobile" && !isDesktopOnlyView(initialView) ? "mobile" : "desktop";

  function showUpdateDenial(reason: string) {
    setStatus("Recruitment records loaded.");
    setUpdateDenial(reason);
  }

  const latestData = useRef(data); latestData.current = data;
  const loadData = useCallback(async (refreshReports = true, background = false) => {
    const retainView = background && Boolean(latestData.current.profile);
    if (layoutMode === "unknown") return null;
    const generation = ++loadGeneration.current;
    const currentRequest = () => generation === loadGeneration.current;
    if (!supabase) {
      setLoading(false);
      setWorkspaceLoadState("error");
      setError("Supabase environment variables are not configured. Add .env.local or Vercel environment variables.");
      return null;
    }

    setLoading(true);
    if (!retainView) setWorkspaceLoadState("checking_session");
    setError(null);
    let session;
    try {
      session = await withAuthTimeout(
        supabase.auth.getSession(),
        "Session verification timed out. Your saved session was cleared; please sign in again."
      );
    } catch (sessionError) {
      if (!currentRequest()) return null;
      clearStoredSupabaseSession();
      setLoading(false);
      setWorkspaceLoadState("redirecting_to_login");
      setStatus(sessionError instanceof Error ? sessionError.message : "Session verification failed. Please sign in again.");
      window.location.replace("/login?reason=session-timeout");
      return null;
    }
    if (!currentRequest()) return null;
    if (!session.data.session) {
      setLoading(false);
      setWorkspaceLoadState("redirecting_to_login");
      setStatus("No active session. Redirecting to login...");
      window.location.replace("/login");
      return null;
    }

    if (!retainView || session.data.session.user.id !== latestData.current.profile?.id) setWorkspaceLoadState("loading_data");
    try {
      if (loadScope === "profile") {
        const user = await supabase.auth.getUser();
        if (user.error) throw user.error;
        if (!user.data.user) throw new Error("Could not verify the signed-in user.");
        const result = await supabase.from("profiles").select("*").eq("id", user.data.user.id).limit(1);
        if (result.error) throw result.error;
        if (!currentRequest()) return null;
        const profile = (result.data ?? []).find(row => row.id === user.data.user!.id) as Profile | undefined;
        if (!profile) throw new Error("Could not load the signed-in profile.");
        const minimal = { ...emptyDashboardData, profile, profiles: [profile] };
        loadedScopeRef.current = "profile";
        setData(minimal); setWorkspaceLoadState("ready"); setStatus("Recruitment records loaded.");
        return minimal;
      }
      const [loaded, dashboardReport] = await Promise.all([loadRecruitmentBootstrap(supabase), Promise.resolve(null)]);
      if (!currentRequest()) return null;
      loadedScopeRef.current = loadScope;
      if (refreshReports) { clearDashboardReportCache(); clearDashboardSummaryCache(); }
      setData(loaded);
      setReportRefreshKey(value => value + 1);
      setCompanyDashboardReport(dashboardReport);
      setStatus("Recruitment records loaded.");
      setWorkspaceLoadState("ready");
      return loaded;
    } catch (loadError) {
      if (!currentRequest()) return null;
      setError(loadError instanceof Error ? loadError.message : "Could not load recruitment data.");
      setWorkspaceLoadState("error");
      return null;
    } finally {
      if (currentRequest()) setLoading(false);
    }
  }, [layoutMode, loadScope]);

  useEffect(() => {
    if (layoutMode === "unknown") return;
    const loaded = loadedScopeRef.current;
    loadGeneration.current += 1;
    if (loaded === "desktop" || loaded === "mobile" || loaded === loadScope) { setLoading(false); setWorkspaceLoadState("ready"); return; }
    void loadData(false);
    return () => { loadGeneration.current += 1; };
  }, [layoutMode, loadScope, loadData]);


  const refreshRejectionReasons = useCallback(async () => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: reasons, error: refreshError } = await supabase.from("rejection_reasons").select("*").order("sort_order", { ascending: true });
    if (refreshError) throw refreshError;
    setData((current) => ({ ...current, rejection_reasons: (reasons ?? []) as RejectionReason[] }));
  }, []);

  const refreshConfigurationTemplates = useCallback(async () => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const [letters, invitations] = await Promise.all([
      supabase.from("rejection_letter_templates").select("*"),
      supabase.from("interview_invitation_templates").select("*")
    ]);
    if (letters.error) throw letters.error;
    if (invitations.error) throw invitations.error;
    setData(current => ({ ...current, rejection_letter_templates: (letters.data ?? []) as DashboardData["rejection_letter_templates"], interview_invitation_templates: (invitations.data ?? []) as DashboardData["interview_invitation_templates"] }));
  }, []);

  useEffect(() => {
    const urlState = parseWorkspaceUrlState();
    const savedLanguage = localStorage.getItem("recruitment_lang") as Language | null;
    const savedFilters = localStorage.getItem("recruitment_filters");
    const storedFilters = parseStoredFilters(savedFilters);
    setLanguage(urlState.language ?? savedLanguage ?? "th");
    if (urlState.hasFilterParams) {
      setFilters({ site: urlState.site ?? "", owner: urlState.owner ?? "", priorityOnly: urlState.priorityOnly });
    } else if (storedFilters) {
      setFilters(storedFilters);
    } else if (savedFilters) {
      localStorage.removeItem("recruitment_filters");
    }
    if (urlState.sourcingWeek) setSourcingWeek(sourcingCycleSaturday(urlState.sourcingWeek));
    setSelectedApplicationId(new URLSearchParams(window.location.search).get("applicationId"));
    if (urlState.detailType && urlState.detailId) setDetail({ type: urlState.detailType, id: urlState.detailId });
    setWorkspaceTarget({ type: urlState.workspaceType, id: urlState.workspaceId });
    setUrlStateReady(true);
  }, []);

  useEffect(() => {
    function syncNavigationState() {
      const urlState = parseWorkspaceUrlState();
      setLanguage((current) => urlState.language ?? current);
      if (urlState.hasFilterParams) {
        setFilters((current) => {
          const next = { site: urlState.site ?? "", owner: urlState.owner ?? "", priorityOnly: urlState.priorityOnly };
          return current.site === next.site && current.owner === next.owner && current.priorityOnly === next.priorityOnly ? current : next;
        });
      }
      if (urlState.sourcingWeek) setSourcingWeek(sourcingCycleSaturday(urlState.sourcingWeek));
      setDetail((current) => {
        setSelectedApplicationId(new URLSearchParams(window.location.search).get("applicationId"));
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
    if (!urlStateReady || layoutMode === "unknown") return;
    localStorage.setItem("recruitment_lang", language);
    localStorage.setItem("recruitment_filters", JSON.stringify(filters));
    if (desktopRequired) return;
    updateWorkspaceUrlState({
      lang: language,
      site: filters.site,
      pic: filters.owner,
      priority: filters.priorityOnly ? "only" : "all",
      sourcingSite: null,
      sourcingOwner: null,
      sourcingWeek,
      type: initialView === "workspace" ? workspaceTarget.type : undefined,
      id: initialView === "workspace" ? workspaceTarget.id : undefined,
      detailType: detail?.type,
      detailId: detail?.id,
      applicationId: selectedApplicationId
    });
  }, [detail, filters, initialView, language, sourcingWeek, urlStateReady, workspaceTarget, layoutMode, desktopRequired, selectedApplicationId]);

  const role = data.profile?.role ?? "viewer";
  const workspaceDataRef = useRef(data);
  workspaceDataRef.current = data;
  const detailAccessScope = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "local"}:${data.profile?.id ?? "anonymous"}:${data.profile?.role ?? "viewer"}:${data.profile?.site ?? ""}:${data.profile?.updated_at ?? ""}`;
  useEffect(() => () => { if (supabase) clearRecruitmentReadQueue(supabase); }, [detailAccessScope, supabase]);
  const homeReadKey = JSON.stringify([detailAccessScope, filters.site, filters.owner, filters.priorityOnly]);
  const homeReadIdentity = useRef("");
  const visibleWelcomeSummary = homeReadIdentity.current === homeReadKey ? welcomeSummary : null;
  const visibleHomeBannerSummary = homeReadIdentity.current === homeReadKey ? homeBannerSummary : null;
  useEffect(() => {
    if (initialView !== "home" || workspaceLoadState !== "ready" || !supabase || !data.profile) {
      setWelcomeSummary(null); setWelcomeSummaryLoading(false); setWelcomeSummaryError(null); setHomeBannerSummary(null); setHomeBannerLoading(false); setHomeBannerError(null);
      return;
    }
    let active = true;
    const scope = { headerSite: filters.site, headerPic: filters.owner, priorityOnly: filters.priorityOnly };
    if (homeReadIdentity.current !== homeReadKey) { setWelcomeSummary(null); setHomeBannerSummary(null); }
    homeReadIdentity.current = homeReadKey;
    setWelcomeSummaryLoading(true); setWelcomeSummaryError(null);
    setHomeBannerLoading(true); setHomeBannerError(null);
    void loadWelcomeSummary(supabase, detailAccessScope, reportRefreshKey + welcomeSummaryRetry).then(value => {
      if (active) { setWelcomeSummary(value); setWelcomeSummaryError(null); }
    }).catch(loadError => {
      if (active) setWelcomeSummaryError(loadError instanceof Error ? loadError.message : "Could not load the welcome summary.");
    }).finally(() => { if (active) setWelcomeSummaryLoading(false); });
    void loadHomeBannerSummary(supabase, scope, detailAccessScope, reportRefreshKey + homeBannerRetry).then(value => {
      if (active) { setHomeBannerSummary(value); setHomeBannerError(null); }
    }).catch(loadError => {
      if (active) setHomeBannerError(loadError instanceof Error ? loadError.message : "Could not load the home banner summary.");
    }).finally(() => { if (active) setHomeBannerLoading(false); });
    return () => { active = false; };
  }, [homeReadKey, data.profile, detailAccessScope, filters.owner, filters.priorityOnly, filters.site, homeBannerRetry, initialView, reportRefreshKey, welcomeSummaryRetry, workspaceLoadState]);
  useEffect(() => { if (supabase) clearScopedDetailCache(supabase); }, [detailAccessScope, supabase]);
  const currentDetailAccessScope = useRef(detailAccessScope);
  currentDetailAccessScope.current = detailAccessScope;
  useEffect(() => { setCandidateActionContext(null); }, [detailAccessScope]);
  const candidateDetailKey = detail?.type === "candidate" ? JSON.stringify([detailAccessScope, detail.id, selectedApplicationId ?? ""]) : "";
  const candidateActionGeneration = useRef(0);
  useEffect(() => { candidateActionGeneration.current += 1; }, [detailAccessScope]);
  useEffect(() => {
    const activeProfileId = workspaceDataRef.current.profile?.id;
    if (!candidateDetailKey || !supabase || workspaceLoadState !== "ready" || !activeProfileId) {
      setCandidateDetail({ key: candidateDetailKey, data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    const candidateId = detail?.type === "candidate" ? detail.id : "";
    setCandidateDetail(previous => ({ key: candidateDetailKey, data: previous.key === candidateDetailKey ? previous.data : null, loading: true, error: null }));
    void loadCandidateDetail(supabase, { profileId: activeProfileId, key: detailAccessScope }, candidateId, selectedApplicationId, workspaceDataRef.current)
      .then(result => { if (!cancelled) setCandidateDetail({ key: candidateDetailKey, data: result, loading: false, error: null }); })
      .catch(loadError => { if (!cancelled) setCandidateDetail({ key: candidateDetailKey, data: null, loading: false, error: loadError instanceof Error ? loadError.message : "Could not load candidate details." }); });
    return () => { cancelled = true; };
  // Do not depend on candidateDetail: setting loading state here must not clean up
  // the request that produced it. The request is scoped by the key/retry/auth inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateDetailKey, candidateDetailRetry, detail, detailAccessScope, selectedApplicationId, supabase, workspaceLoadState]);
  const candidateDetailContext = candidateDetail.key === candidateDetailKey ? candidateDetail.data : null;
  const refreshMutationCaches = useCallback((endpoint: string) => {
    invalidateRecruitmentListsForMutation(endpoint);
    clearPipelineSummaryCache();
    clearDashboardSummaryCache();
    clearDashboardReportCache();
    if (supabase) clearScopedDetailCache(supabase, detailAccessScope);
    if (detail?.type === "candidate") setCandidateDetailRetry(value => value + 1);
    setCandidateActionContext(null);
    setReportRefreshKey(value => value + 1);
  }, [detail, detailAccessScope, supabase]);
  const requisitionDetailKey = detail?.type === "requisition" ? JSON.stringify([detailAccessScope, detail.id, reportRefreshKey]) : "";
  useEffect(() => {
    if (!requisitionDetailKey || detail?.type !== "requisition" || !supabase || !data.profile) {
      setRequisitionDetail({ key: requisitionDetailKey, loading: false, error: null, result: null });
      return;
    }
    let cancelled = false;
    setRequisitionDetail(previous => ({ key: requisitionDetailKey, loading: true, error: null, result: previous.key === requisitionDetailKey ? previous.result : null }));
    void loadScopedRequisitionDetail(supabase, { docId: detail.id, accessScope: { profileId: data.profile.id, key: detailAccessScope } })
      .then(result => { if (!cancelled) setRequisitionDetail({ key: requisitionDetailKey, loading: false, error: null, result }); })
      .catch(loadError => { if (!cancelled) setRequisitionDetail({ key: requisitionDetailKey, loading: false, error: loadError instanceof Error ? loadError.message : "Could not load requisition details.", result: null }); });
    return () => { cancelled = true; };
  }, [data.profile, detail, detailAccessScope, requisitionDetailKey, requisitionDetailRetry, supabase]);
  const requisitionDetailResult = requisitionDetail.key === requisitionDetailKey ? requisitionDetail.result : null;
  const loadedRequisition = requisitionDetailResult?.status === "ready" ? requisitionDetailResult : null;
  const actionDataFor = useCallback((candidateId: string) => {
    if (detail?.type === "candidate" && detail.id === candidateId && candidateDetailContext) return candidateDetailContext;
    const actionMatches = candidateActionContext?.scopeKey === detailAccessScope && candidateActionContext.candidate.candidate_id === candidateId && (!selectedApplicationId || candidateActionContext.candidate.application_id === selectedApplicationId);
    return actionMatches ? candidateActionContext.data : data;
  }, [candidateActionContext, candidateDetailContext, data, detail, detailAccessScope, selectedApplicationId]);
  const ensureCandidateActionContext = useCallback(async (candidate: EnrichedCandidate) => {
    if (detail?.type === "candidate" && detail.id === candidate.candidate_id && candidateDetailContext) {
      const resolved = enrichCandidates(candidateDetailContext).find(row => row.candidate_id === candidate.candidate_id && row.application_id === candidate.application_id);
      return resolved ? { data: candidateDetailContext, candidate: resolved } : null;
    }
    if (!supabase || !data.profile) { showUpdateDenial("Candidate details are unavailable. Reopen the record and try again."); return null; }
    const generation = ++candidateActionGeneration.current;
    const applicationId = candidate.application_id ?? null;
    try {
      const hydrated = await loadCandidateDetail(supabase, { profileId: data.profile.id, key: detailAccessScope }, candidate.candidate_id, applicationId, data);
      if (generation !== candidateActionGeneration.current || detailAccessScope !== currentDetailAccessScope.current) return null;
      const resolved = enrichCandidates(hydrated).find(row => row.candidate_id === candidate.candidate_id && row.application_id === applicationId);
      if (!resolved) throw new Error("The selected application is no longer available.");
      setCandidateActionContext({ key: JSON.stringify([detailAccessScope, candidate.candidate_id, applicationId ?? ""]), scopeKey: detailAccessScope, candidate: resolved, data: hydrated });
      return { data: hydrated, candidate: resolved };
    } catch (loadError) {
      if (generation !== candidateActionGeneration.current) return null;
      const message = loadError instanceof Error ? loadError.message : "Could not load candidate details.";
      showUpdateDenial(message);
      return null;
    }
  }, [candidateDetailContext, data, detail, detailAccessScope]);
  const canWrite = canWriteRole(role);
  const canManageSetup = canManageSetupRole(role);
  const canManageUsers = canManageUsersRole(role);
  const canManageRejectionTemplates = role === "system_admin" || role === "admin_recruiter";
  const canDeleteRecords = role === "system_admin";

  const priorityData = useMemo(() => priorityRequisitionScope(data, filters.priorityOnly), [data, filters.priorityOnly]);

  const enrichedRequisitions = useMemo(() => enrichRequisitions(data), [data]);
  const enrichedCandidates = useMemo(() => enrichCandidates(data), [data]);
  const enrichedOffers = useMemo(() => enrichOffers(data), [data]);
  const offeredCandidateIds = useMemo(() => new Set(data.offers.map((offer) => offer.application_id ?? offer.candidate_id)), [data.offers]);
  const rejectionLetterSentCandidateIds = useMemo(() => new Set(data.rejection_letter_drafts.filter((draft) => draft.status === "sent").map((draft) => data.recruitment_logs.find(log=>log.stage_instance_id===draft.failed_stage_instance_id)?.application_id ?? draft.candidate_id)), [data.rejection_letter_drafts, data.recruitment_logs]);
  const enrichedSourcingGroups = useMemo(() => enrichSourcingGroups(data, sourcingWeek), [data, sourcingWeek]);
  const homeSourcingGroups = useMemo(
    () => sourcingGroupsInScope(enrichedSourcingGroups.filter(group => !filters.priorityOnly || group.doc_ids.some(id => data.requisitions.some(req => req.doc_id === id && req.is_priority))), data.profile, filters.site, filters.owner),
    [data.profile, data.requisitions, enrichedSourcingGroups, filters.owner, filters.site, filters.priorityOnly]
  );
  const staleSourcingGroups = useMemo(() => staleOpenSourcingGroups(priorityData), [priorityData]);
  const dataQualityIssues = useMemo(() => deriveDataQualityIssues(priorityData), [priorityData]);
  const priorityRequisitions = useMemo(() => enrichRequisitions(priorityData), [priorityData]);
  const priorityCandidates = useMemo(() => enrichCandidates(priorityData), [priorityData]);
  const priorityOffers = useMemo(() => enrichOffers(priorityData), [priorityData]);

  const filteredRequisitions = useMemo(() => filterByText(priorityRequisitions, filters), [priorityRequisitions, filters]);
  const filteredCandidates = useMemo(() => filterByText(priorityCandidates, filters), [priorityCandidates, filters]);
  const filteredOffers = useMemo(() => filterByText(priorityOffers, filters), [priorityOffers, filters]);
  const dashboardReportData = useMemo(
    () => priorityRequisitionScope(companyDashboardReport ? { ...data, ...companyDashboardReport } : data, filters.priorityOnly),
    [companyDashboardReport, data, filters.priorityOnly]
  );
  const dashboardRequisitions = useMemo(
    () => filterByText(enrichRequisitions(dashboardReportData), filters),
    [dashboardReportData, filters]
  );
  const dashboardOffers = useMemo(
    () => filterByText(enrichOffers(dashboardReportData), filters),
    [dashboardReportData, filters]
  );
  const filteredChangeLogs = useMemo(() => filterChangeLogsByText(priorityData, filters), [priorityData, filters]);
  useEffect(() => {
    if (initialView !== "workspace" || workspaceLoadState !== "ready" || workspaceTarget.type !== "requisition" || !workspaceTarget.id || !supabase || !data.profile) return;
    let cancelled = false;
    const docId = workspaceTarget.id;
    const identity = { profileId: data.profile.id, key: detailAccessScope };
    void loadScopedRequisitionDetail(supabase, { docId, accessScope: identity }).then(result => {
      if (cancelled || workspaceTarget.id !== docId || result.status !== "ready" || result.scopeKey !== detailAccessScope) return;
      const requisition = result.requisition;
      const inHeaderScope = (!filters.site || requisition.site === filters.site)
        && (!filters.owner || requisition.person_in_charge === filters.owner)
        && (data.profile?.role !== "site_recruiter" || requisition.site === data.profile.site || requisition.person_in_charge === data.profile.nickname);
      const eligible = inHeaderScope && requisition.status === "ongoing" && result.metrics.openHeadcount > 0
        ? [...new Set(result.documentGroups.map(row => row.group_id).filter((id): id is string => Boolean(id)))].sort()
        : [];
      if (eligible.length === 1) {
        setWorkspaceTarget({ type: "group", id: eligible[0] });
        updateWorkspaceUrlState({ type: "group", id: eligible[0], doc: null, detailType: null, detailId: null });
      } else {
        setWorkspaceTarget({ type: null, id: null });
        updateWorkspaceUrlState({ type: null, id: null, doc: null, detailType: "requisition", detailId: docId, groupChoices: eligible.length > 1 ? eligible.join(",") : null });
        setDetail({ type: "requisition", id: docId });
      }
    }).catch(() => {
      if (!cancelled) { setWorkspaceTarget({ type: null, id: null }); setDetail({ type: "requisition", id: docId }); }
    });
    return () => { cancelled = true; };
  }, [homeReadKey, data.profile, detailAccessScope, filters.owner, filters.site, initialView, supabase, workspaceLoadState, workspaceTarget]);

  useEffect(() => {
    if (initialView === "workspace" && workspaceUrlState.params.has("doc")) updateWorkspaceUrlState({ doc: null });
  }, [initialView, workspaceUrlState.params]);

  useEffect(() => {
    if (initialView !== "workspace" || workspaceLoadState !== "ready" || activeModal) return;
    const candidateId = workspaceUrlState.params.get("offerCandidate");
    if (!candidateId) return;
    const handoffApplicationId = workspaceUrlState.params.get("offerApplication") ?? selectedApplication(data, candidateId)?.application_id;
    const candidate = enrichedCandidates.find((row) => row.candidate_id === candidateId && row.application_id === handoffApplicationId);
    const docId = workspaceUrlState.params.get("offerDoc")
      ?? data.document_groups.find((row) => row.group_id === candidate?.group_id)?.doc_id;
    setModalDefaults({
      mode: "new",
      candidate_id: candidateId,
      application_id: handoffApplicationId,
      doc_id: docId,
      accepted_date: workspaceUrlState.params.get("offerDate") ?? undefined,
      offer_candidate_ids: enrichedCandidates.filter((row) => row.group_id === candidate?.group_id).map((row) => row.candidate_id),
      offer_doc_ids: docId ? [docId] : undefined
    });
    setActiveModal("offer");
    updateWorkspaceUrlState({ offerApplication: null, offerCandidate: null, offerDate: null, offerDoc: null });
  }, [activeModal, data, enrichedCandidates, initialView, workspaceLoadState, workspaceUrlState.params]);
  const workspaceScope = useMemo(() => {
    const docIds = new Set<string>();
    const groupIds = new Set<string>();
    if (workspaceTarget.type === "requisition" && workspaceTarget.id) {
      docIds.add(workspaceTarget.id);
      data.document_groups.filter((row) => row.doc_id === workspaceTarget.id && row.group_id).forEach((row) => groupIds.add(row.group_id!));
    } else if (workspaceTarget.type === "group" && workspaceTarget.id) {
      groupIds.add(workspaceTarget.id);
      const linked = data.document_groups.filter((row) => row.group_id === workspaceTarget.id).map((row) => row.doc_id);
      linked.forEach((docId) => docIds.add(docId));
    }
    const visibleDocIds = new Set([...docIds].filter((docId) => {
      const requisition = enrichedRequisitions.find((row) => row.doc_id === docId);
      return Boolean(requisition && (!filters.priorityOnly || requisition.is_priority) && (!filters.site || requisition.site === filters.site) && (!filters.owner || requisition.person_in_charge === filters.owner));
    }));
    const documentGroups = data.document_groups.filter((row) => (
      (row.group_id && groupIds.has(row.group_id))
      || (visibleDocIds.has(row.doc_id) && groupIds.size === 0)
    ) && visibleDocIds.has(row.doc_id));
    const scopedDocumentGroups = documentGroups;
    const candidateDocGroupIds = new Set(documentGroups.map((row) => row.doc_group_id));
    const scopedCandidates = enrichedCandidates.filter((row) => (row.group_id ? groupIds.has(row.group_id) && (!filters.priorityOnly || documentGroups.some(match => match.group_id === row.group_id)) : Boolean(row.doc_group_id && candidateDocGroupIds.has(row.doc_group_id))));
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
  }, [data.document_groups, enrichedCandidates, enrichedOffers, enrichedRequisitions, filters.owner, filters.site, filters.priorityOnly, workspaceTarget]);
  const historicalWorkspace = workspaceTarget.type === "group" && workspaceScope.requisitions.length > 0
    && !workspaceScope.requisitions.some((row) => row.status === "ongoing" && row.open_headcount > 0);

  const siteOptions = SITE_OPTIONS;
  const [authorizedOwnerOptions, setAuthorizedOwnerOptions] = useState<string[]>([]);
  const [ownerOptionsError, setOwnerOptionsError] = useState<string | null>(null);
  const [ownerOptionsRetry, setOwnerOptionsRetry] = useState(0);
  const [invitationTemplateError, setInvitationTemplateError] = useState<string | null>(null);
  const [rejectionTemplateError, setRejectionTemplateError] = useState<string | null>(null);
  const [invitationProfiles, setInvitationProfiles] = useState<Profile[]>([]);
  const [invitationProfilesError, setInvitationProfilesError] = useState<string | null>(null);
  const [invitationProfilesRetry, setInvitationProfilesRetry] = useState(0);
  const ownerOptions = useMemo(() => [...new Set([
    ...recruiterNicknameOptions(data.profiles),
    ...authorizedOwnerOptions,
    ...(filters.owner ? [filters.owner] : [])
  ])].sort((left, right) => left.localeCompare(right)), [authorizedOwnerOptions, data.profiles, filters.owner]);
  useEffect(() => {
    if (!supabase || !data.profile || workspaceLoadState !== "ready" || desktopRequired) return;
    let active = true;
    setOwnerOptionsError(null);
    void loadDashboardFilterOptions(supabase, {
      headerSite: filters.site,
      headerPic: filters.owner,
      priorityOnly: filters.priorityOnly,
      sites: []
    }, detailAccessScope).then(options => {
      if (!active) return;
      setAuthorizedOwnerOptions(options.owners);
    }).catch(loadError => {
      if (!active) return;
      setOwnerOptionsError(loadError instanceof Error ? loadError.message : "Could not load owner options.");
    });
    return () => { active = false; };
  }, [data.profile, desktopRequired, detailAccessScope, filters.owner, filters.priorityOnly, filters.site, ownerOptionsRetry, supabase, workspaceLoadState]);
  useEffect(() => {
    if (!supabase || !currentStageActionCandidateId) return;
    let active = true;
    setInvitationTemplateError(null);
    void Promise.resolve(supabase.from("interview_invitation_templates").select("*")).then(({ data: rows, error: queryError }) => {
      if (!active) return;
      if (queryError) throw queryError;
      setData(current => ({ ...current, interview_invitation_templates: (rows ?? []) as DashboardData["interview_invitation_templates"] }));
    }).catch(loadError => {
      if (active) setInvitationTemplateError(loadError instanceof Error ? loadError.message : "Could not load invitation templates.");
    });
    return () => { active = false; };
  }, [currentStageActionCandidateId, detailAccessScope, supabase]);
  useEffect(() => {
    if (!supabase || !currentStageActionCandidateId || !data.profile) { setInvitationProfiles([]); setInvitationProfilesError(null); return; }
    let active = true;
    setInvitationProfiles([]); setInvitationProfilesError(null);
    void loadAuthorizedRecruiterOptions(supabase, { profileId: data.profile.id, key: detailAccessScope }).then(rows => {
      if (active) setInvitationProfiles(rows);
    }).catch(loadError => {
      if (active) setInvitationProfilesError(loadError instanceof Error ? loadError.message : "Could not load authorized interviewer options.");
    });
    return () => { active = false; };
  }, [currentStageActionCandidateId, data.profile, detailAccessScope, invitationProfilesRetry, supabase]);
  useEffect(() => {
    if (!supabase || !rejectionLetterCandidateId) return;
    let active = true;
    setRejectionTemplateError(null);
    void Promise.resolve(supabase.from("rejection_letter_templates").select("*")).then(({ data: rows, error: queryError }) => {
      if (!active) return;
      if (queryError) throw queryError;
      setData(current => ({ ...current, rejection_letter_templates: (rows ?? []) as DashboardData["rejection_letter_templates"] }));
    }).catch(loadError => {
      if (active) setRejectionTemplateError(loadError instanceof Error ? loadError.message : "Could not load rejection templates.");
    });
    return () => { active = false; };
  }, [detailAccessScope, rejectionLetterCandidateId, supabase]);
  useEffect(() => {
    if (initialView !== "home" || loading || !data.profile) return;
    const key = welcomeStorageKey(data.profile.id ?? data.profile.email ?? "unknown");
    if (sessionStorage.getItem(key)) return;
    setWelcomeOpen(true);
  }, [data.profile, initialView, loading]);

  async function signOut() {
    clearDashboardReportCache();
    clearDashboardSummaryCache();
    clearRecruitmentListCache();
    if (supabase) clearScopedDetailCache(supabase);
    try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(DASHBOARD_SESSION_PREFIX)) sessionStorage.removeItem(key); } catch { /* Optional preferences storage. */ }
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
    void ensureCandidateActionContext(candidate).then(resolved => {
      if (!resolved) return;
      const candidate = resolved.candidate;
      const context = resolved.data;
    const logs = applicationLogs(context, candidate);
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
      candidate_id: candidate.candidate_id, application_id: candidate.application_id,
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
    });
  }

  const openPendingEdit = useCallback((candidate: EnrichedCandidate) => {
    void ensureCandidateActionContext(candidate).then(resolved => {
      if (!resolved) return;
      candidate = resolved.candidate;
      const context = resolved.data;
    const logs = applicationLogs(context, candidate);
    const active = activeProcessStage(logs);
    if (!active) return;
    const pending = logs.find((row) => row.stage_instance_id === active.stageInstanceId);
    if (!pending || !candidatePipelineCapability(candidate, logs, context.profile).canWrite) {
      showUpdateDenial("This pending stage is outside your update responsibility.");
      return;
    }
    setProcessDefaults({ candidate_id: candidate.candidate_id, application_id: candidate.application_id, recruitment_process: active.stage, round: active.round, pending_log_id: active.pendingLogId, stage_instance_id: active.stageInstanceId, expected_updated_at: active.updatedAt, pending_log_date: pending.log_date, pending_estimated_action_date: pending.estimated_action_date, pending_interviewer: pending.interviewer, pending_remark: pending.remark });
    setActiveModal("pending_edit");
    });
  }, [ensureCandidateActionContext]);

  function openPipelineRecordCorrection(candidate: EnrichedCandidate, log: RecruitmentLog) {
    void ensureCandidateActionContext(candidate).then(resolved => {
    if (!resolved) return;
    candidate = resolved.candidate;
    log = resolved.data.recruitment_logs.find(row => row.log_id === log.log_id && row.application_id === candidate.application_id) ?? log;
    const context = resolved.data;
    if (!context.profile || !["system_admin", "admin_recruiter"].includes(context.profile.role)) return;
    setProcessDefaults({
      candidate_id: candidate.candidate_id, application_id: candidate.application_id,
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
      outcome_remark: log.outcome_remark,
      failure_actor: log.failure_actor,
      failure_main_reason_id: log.failure_main_reason_id,
      failure_detail_reason_id: log.failure_detail_reason_id
    });
    setActiveModal("pipeline_record_correction");
    });
  }

  function openStageOutcome(candidate: EnrichedCandidate, outcome: "pass" | "fail") {
    void ensureCandidateActionContext(candidate).then(resolved => {
    if (!resolved) return;
    candidate = resolved.candidate;
    const context = resolved.data;
    const logs = applicationLogs(context, candidate);
    const active = activeProcessStage(logs);
    if (!active || !candidatePipelineCapability(candidate, logs, context.profile).canWrite) return;
    const nextIndex = ACTIVE_PIPELINE_STAGES.indexOf(active.stage) + 1;
    const nextStage = outcome === "pass" && active.stage !== "Offer" ? ACTIVE_PIPELINE_STAGES[nextIndex] : undefined;
    const pending = logs.find((row) => row.stage_instance_id === active.stageInstanceId);
    setProcessDefaults({ candidate_id: candidate.candidate_id, application_id: candidate.application_id, recruitment_process: active.stage, round: active.round, pending_log_id: active.pendingLogId, stage_instance_id: active.stageInstanceId, expected_updated_at: active.updatedAt, pending_log_date: pending?.log_date, pending_estimated_action_date: pending?.estimated_action_date, pending_interviewer: pending?.interviewer, pending_remark: pending?.remark, outcome, target_stage: nextStage, source: "pipeline" });
    setActiveModal("stage_outcome");
    });
  }

  function openMaintainTest(candidate: EnrichedCandidate) {
    void ensureCandidateActionContext(candidate).then(resolved => {
    if (!resolved) return;
    candidate = resolved.candidate;
    const context = resolved.data;
    const logs = applicationLogs(context, candidate);
    const blockedReason = processUpdateBlockReason(logs);
    if (blockedReason) {
      showUpdateDenial(blockedReason);
      return;
    }
    const active = activeProcessStage(logs);
    const pending = active ? logs.find((row) => row.stage_instance_id === active.stageInstanceId) : null;
    if (!(["Test", "Line Interview"] as ProcessStage[]).includes(candidate.latest_process as ProcessStage) || !active || !pending) return;
    const stage = active.stage;
    setProcessDefaults({ candidate_id: candidate.candidate_id, application_id: candidate.application_id, recruitment_process: stage, round: active.round, pending_log_id: pending.log_id, stage_instance_id: active.stageInstanceId, expected_updated_at: active.updatedAt, pending_log_date: pending.log_date, pending_estimated_action_date: pending.estimated_action_date, pending_interviewer: pending.interviewer, pending_remark: pending.remark, outcome: "pass", target_stage: stage, current_round: active.round });
    setActiveModal("stage_outcome");
    });
  }

  function openOfferUpdate(candidate: EnrichedCandidate) {
    void ensureCandidateActionContext(candidate).then(resolved => {
      if (!resolved || resolved.candidate.latest_process !== "Offer") return;
      const active = activeProcessStage(applicationLogs(resolved.data, resolved.candidate));
      if (active) openStageOutcome(resolved.candidate, "pass");
    });
  }

  function openInitialProcessUpdate(candidate: EnrichedCandidate) {
    void ensureCandidateActionContext(candidate).then(resolved => {
      if (!resolved) return;
      candidate = resolved.candidate;
    if (!candidate.first_contact_date) {
      showUpdateDenial("Add First Contact Date in Candidate Detail before starting Phone Screen.");
      return;
    }
    setProcessDefaults({
      candidate_id: candidate.candidate_id, application_id: candidate.application_id,
      recruitment_process: "Phone Screen",
      pending_log_date: candidate.first_contact_date,
      pending_remark: "Started from pipeline no-activity lane"
    });
    setActiveModal("pipeline_start");
    });
  }

  const openProcessFromDetail = useCallback((candidateId: string) => setJourneyActionCandidateId(candidateId), []);

  const openDetailRequisitionChange = useCallback((docId: string) => {
    setModalDefaults({ mode: "change", selectedId: docId });
    setActiveModal("requisition");
  }, []);

  const openDetailCandidateChange = useCallback((candidateId: string) => {
    setModalDefaults({ mode: "change", selectedId: candidateId });
    setActiveModal("candidate");
  }, []);

  const openCandidateReference = useCallback((candidateId: string, referenceId?: string) => {
    const sourceContext = actionDataFor(candidateId);
    const sourceCandidate = enrichCandidates(sourceContext).find(row => row.candidate_id === candidateId && (!selectedApplicationId || row.application_id === selectedApplicationId));
    if (!sourceCandidate) return;
    void ensureCandidateActionContext(sourceCandidate).then(resolved => {
    if (!resolved) return;
    const context = resolved.data;
    const reference = context.candidate_references.find((row) => row.reference_id === referenceId);
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
    });
  }, [actionDataFor, ensureCandidateActionContext, selectedApplicationId]);

  const openCandidateReferenceStatus = useCallback((candidateId: string, referenceId: string) => {
    const sourceContext = actionDataFor(candidateId);
    const sourceCandidate = enrichCandidates(sourceContext).find(row => row.candidate_id === candidateId && (!selectedApplicationId || row.application_id === selectedApplicationId));
    if (!sourceCandidate) return;
    void ensureCandidateActionContext(sourceCandidate).then(resolved => {
    if (!resolved) return;
    const reference = resolved.data.candidate_references.find((row) => row.reference_id === referenceId);
    if (!reference) return;
    setProcessDefaults({ candidate_id: candidateId, reference_id: reference.reference_id, reference_expected_updated_at: reference.updated_at, reference_status: reference.status, reference_status_reason: reference.status_reason });
    setActiveModal("reference_status");
    });
  }, [actionDataFor, ensureCandidateActionContext, selectedApplicationId]);

  const openCandidateReferenceCheck = useCallback((candidateId: string, referenceId: string) => {
    const sourceContext = actionDataFor(candidateId);
    const sourceCandidate = enrichCandidates(sourceContext).find(row => row.candidate_id === candidateId && (!selectedApplicationId || row.application_id === selectedApplicationId));
    if (!sourceCandidate) return;
    void ensureCandidateActionContext(sourceCandidate).then(resolved => {
    if (!resolved) return;
    const context = resolved.data;
    const check = context.candidate_reference_checks.find((row) => row.reference_id === referenceId && row.application_id === selectedApplicationId);
    setProcessDefaults({ candidate_id: candidateId, application_id: selectedApplicationId ?? undefined, reference_id: referenceId, reference_check_expected_updated_at: check?.updated_at, reference_checked_date: check?.checked_date, reference_duration_minutes: check?.duration_minutes, reference_conversation_summary: check?.conversation_summary });
    setActiveModal("reference_check");
    });
  }, [actionDataFor, ensureCandidateActionContext, selectedApplicationId]);

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
      setGuideContext({ doc_id: request.docId });
      setGuideStep(request.docId ? "create_group" : null);
      setModalDefaults({ mode: "new", group_position: "", doc_id: request.docId ?? "" });
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
      const candidate = enrichedCandidates.find((row) => row.candidate_id === request.candidateId && row.application_id === (request.applicationId ?? selectedApplicationId ?? selectedApplication(data, request.candidateId ?? "")?.application_id));
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
      const candidate = enrichedCandidates.find((row) => row.candidate_id === request.candidateId && row.application_id === (request.applicationId ?? selectedApplicationId ?? selectedApplication(data, request.candidateId ?? "")?.application_id));
      const candidateDocId = request.docId
        ?? data.document_groups.find((row) => row.group_id === candidate?.group_id)?.doc_id;
      const proposedAcceptedDate = request.proposedAcceptedDate
        ?? latestSuccessfulOfferPassDate(request.candidateId ?? "", candidate ? applicationLogs(data, candidate) : [])
        ?? undefined;
      setModalDefaults({
        mode: request.offerId ? "change" : "new",
        selectedId: request.offerId ? String(request.offerId) : "",
        candidate_id: request.candidateId,
        application_id: candidate?.application_id,
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
    const payload = modal === "candidate" && formData.get("existing_candidate_id") ? {} : buildPayload(modal, formData);
    const actionPayload = payload as Record<string, unknown>;
    const formApplicationId = String(formData.get("application_id") ?? "");
    if (modal !== "candidate" && (processDefaults.application_id || modalDefaults.application_id || selectedApplicationId)) actionPayload.application_id = formApplicationId || processDefaults.application_id || modalDefaults.application_id || selectedApplicationId;
    if (modal === "candidate" && formData.get("existing_candidate_id")) {
      prepareRpcAction("app_create_candidate_application_v1", { candidate_id: String(formData.get("existing_candidate_id")), group_id: String(formData.get("group_id")) }, `Add application: ${formData.get("existing_candidate_id")} → ${formData.get("group_id")}`);
      return;
    }
    if (modal === "candidate") validateCandidatePayload(payload, language);
    const summary = buildSummary(modal, payload);
    if(modal === "candidate") {
      if(!supabase||candidateReviewBusy) return;
      const original=JSON.stringify(Array.from(new FormData(form).entries()));
      setCandidateReviewBusy(true);setCandidateReviewError(null);
      Promise.resolve(supabase.rpc("app_candidate_duplicate_matches_v1",{payload:actionPayload})).then(({data:matches,error:matchError})=>{
        if(matchError) throw new Error(matchError.message);
        if(!form.isConnected||original!==JSON.stringify(Array.from(new FormData(form).entries()))) throw new Error(language==="th"?"ข้อมูลเปลี่ยนแปลง โปรดตรวจสอบอีกครั้ง":"The form changed. Review the current values again.");
        if(Array.isArray(matches)&&matches.length) setDuplicateReview({matches,payload:actionPayload,summary});
        else setPendingAction({title:"Confirm Save",summary,endpoint:"app_upsert_candidate_profile_v2",payload:actionPayload,modal,route:"rpc"});
      }).catch(reviewError=>setCandidateReviewError(reviewError instanceof Error?reviewError.message:"Could not check duplicate profiles.")).finally(()=>setCandidateReviewBusy(false));
      return;
    }
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
    if (!pendingAction || !supabase || pendingSaveLock.current) return;
    pendingSaveLock.current = true;

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
        if(rpcError && pendingAction.endpoint==="app_upsert_candidate_profile_v2" && rpcError.message.includes("PROFILE_DUPLICATE_REVIEW_REQUIRED")) {
          const latest=await supabase.rpc("app_candidate_duplicate_matches_v1",{payload:pendingAction.payload});
          if(latest.error) throw new Error(latest.error.message);
          setPendingAction(null);setDuplicateReview({matches:Array.isArray(latest.data)?latest.data:[],payload:pendingAction.payload,summary:pendingAction.summary});return;
        }
        if (rpcError) throw new Error(rpcError.message);
        result = (rpcResult ?? { ok: true }) as RpcResult;
      }

      setPendingAction(null);
      setActiveModal(null);
      setProcessDefaults({});
      setModalDefaults({});
      const previousDocId = savedAction.modal === "requisition" ? valueAsString(savedAction.payload.previous_doc_id) : "";
      const nextDocId = savedAction.modal === "requisition" ? valueAsString(result.id ?? savedAction.payload.doc_id) : "";
      if (previousDocId && nextDocId && previousDocId !== nextDocId) {
        setDetail((current) => current?.type === "requisition" && current.id === previousDocId ? { ...current, id: nextDocId } : current);
        setWorkspaceTarget((current) => current.type === "requisition" && current.id === previousDocId ? { ...current, id: nextDocId } : current);
      }
      refreshMutationCaches(savedAction.endpoint);
      const changedCandidateId = String(savedAction.payload.candidate_id ?? "");
      if (detail?.type === "candidate" && detail.id === changedCandidateId) {
        setCandidateDetail(previous => ({ key: candidateDetailKey, data: previous.key === candidateDetailKey ? previous.data : null, loading: true, error: null }));
        setCandidateDetailRetry(value => value + 1);
      }
      const handoff = offerPassHandoffFromResult(result, candidateDetailContext ?? data);
      if (handoff) {
        setOfferPassHandoff(handoff);
        setStatus("Offer stage passed. Review and create the offer record when ready.");
      } else {
        const guideContinued = continueGuideAfterSave(savedAction, result);
        if (!guideContinued) setStatus("Saved successfully.");
      }
    } catch (saveError) {
      setPendingAction(null);
      const message = saveError instanceof Error ? saveError.message : translate(language, "updateDeniedFallback");
      showUpdateDenial(message.includes("APPLICATION_GROUP_ALREADY_USED") ? (language === "th" ? "ผู้สมัครมีเส้นทางใบสมัครสำหรับกลุ่มนี้แล้ว โปรดเลือกกลุ่มอื่น หรือย้ายเส้นทางเดิมกลับมา" : "This candidate already has a journey for this group. Choose another group, or return the original journey.") : message);
    } finally {
      pendingSaveLock.current = false;
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
      refreshMutationCaches(savedAction.endpoint);
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
    const section = docId ? "sourcing" : "overview";
    const path = `/workspace?type=group&id=${encodeURIComponent(groupId)}&section=${section}`;
    router.push(buildContextualHref(path, { language, site: filters.site, owner: filters.owner, sourcingWeek, priority: filters.priorityOnly ? "only" : "all" }));
  }

  function openOfferFromHandoff() {
    if (!offerPassHandoff) return;
    const groupId = data.document_groups.find((row) => row.doc_id === offerPassHandoff.docId)?.group_id ?? null;
    const defaults = {
      candidate_id: offerPassHandoff.candidateId,
      application_id: offerPassHandoff.applicationId,
      doc_id: offerPassHandoff.docId,
      accepted_date: offerPassHandoff.passedDate,
      offer_candidate_ids: initialView === "workspace" ? workspaceScope.candidates.map((row) => row.candidate_id) : undefined,
      offer_doc_ids: initialView === "workspace" ? workspaceScope.requisitions.map((row) => row.doc_id) : undefined
    };
    const handoff = offerPassHandoff;
    setOfferPassHandoff(null);
    if (initialView === "workspace") {
      if (groupId) setWorkspaceTarget({ type: "group", id: groupId });
      pushWorkspaceUrlState({ type: groupId ? "group" : "requisition", id: groupId ?? handoff.docId, doc: null, section: "offer", focusType: null, focusId: null });
      setModalDefaults({ mode: "new", ...defaults });
      setActiveModal("offer");
      return;
    }
    const path = `/workspace?type=${groupId ? "group" : "requisition"}&id=${encodeURIComponent(groupId ?? handoff.docId)}&section=offer&offerApplication=${encodeURIComponent(handoff.applicationId ?? "")}&offerCandidate=${encodeURIComponent(handoff.candidateId)}&offerDoc=${encodeURIComponent(handoff.docId)}&offerDate=${encodeURIComponent(handoff.passedDate)}`;
    router.push(buildContextualHref(path, { language, site: filters.site, owner: filters.owner, sourcingWeek, priority: filters.priorityOnly ? "only" : "all" }));
  }

  const navigationContext = useMemo(
    () => ({ language, site: filters.site, owner: filters.owner, sourcingWeek, priority: filters.priorityOnly ? "only" : "all" }),
    [filters.owner, filters.site, filters.priorityOnly, language, sourcingWeek]
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
    setModalDefaults({ mode: "change", application_id: offer.application_id, selectedId: String(offer.offer_id), candidate_id: offer.candidate_id, doc_id: offer.doc_id });
    setActiveModal("offer");
  }, []);
  const openCandidateDetail = useCallback((candidateId: string, applicationId?: string) => {
    setSelectedApplicationId(applicationId ?? null);
    setCandidateDetail({ key: "", data: null, loading: true, error: null });
    setDetail({ type: "candidate", id: candidateId });
  }, []);
  const openRejectionLetter = useCallback((candidate: EnrichedCandidate, retryDraftId?: string) => {
    void ensureCandidateActionContext(candidate).then(resolved => { if (!resolved) return; setSelectedApplicationId(resolved.candidate.application_id ?? null); setRejectionLetterCandidateId(resolved.candidate.candidate_id); setRejectionLetterRetryDraftId(retryDraftId ?? null); });
  }, [ensureCandidateActionContext]);
  const openCurrentStageEdit = useCallback((candidate: EnrichedCandidate, _stage: ProcessStage) => {
    void ensureCandidateActionContext(candidate).then(resolved => { if (!resolved) return; setSelectedApplicationId(resolved.candidate.application_id ?? null); setCurrentStageActionCandidateId(resolved.candidate.candidate_id); });
  }, [ensureCandidateActionContext]);
  const saveTeamsInterview = useCallback(async (payload: Record<string, unknown>) => {
    if (!supabase) throw new Error("Sign in before scheduling a Teams interview."); setBusy(true);
    try { const { data: session } = await supabase.auth.getSession(); const response = await fetch("/api/interview-meetings", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.session?.access_token ?? ""}` }, body: JSON.stringify(payload) }); const result = await response.json() as { ok?: boolean; error?: string }; if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not update Teams interview."); setStatus(payload.operation === "cancel" ? "Teams interview cancelled." : "Teams interview scheduled and invitations sent."); setCurrentStageActionCandidateId(null); refreshMutationCaches("app_interview_meetings"); if (detail?.type === "candidate" && detail.id === payload.candidate_id) { setCandidateDetail(previous => ({ key: candidateDetailKey, data: previous.key === candidateDetailKey ? previous.data : null, loading: true, error: null })); setCandidateDetailRetry(value => value + 1); } } finally { setBusy(false); }
  }, [detail, candidateDetailKey, refreshMutationCaches]);
  const saveCurrentStageEstimate = useCallback(async (payload: Record<string, unknown>) => {
    if (!supabase) throw new Error("Sign in before updating the pending stage."); setBusy(true);
    try { const { data: rpcResult, error: rpcError } = await supabase.rpc("app_update_pipeline_pending_v2", { payload }); if (rpcError) throw new Error(rpcError.message); const result = (rpcResult ?? { ok: true }) as RpcResult; if (result.error) throw new Error(result.error); setStatus("Estimated action date updated."); setCurrentStageActionCandidateId(null); refreshMutationCaches("app_update_pipeline_pending_v2"); if (detail?.type === "candidate" && detail.id === payload.candidate_id) { setCandidateDetail(previous => ({ key: candidateDetailKey, data: previous.key === candidateDetailKey ? previous.data : null, loading: true, error: null })); setCandidateDetailRetry(value => value + 1); } } finally { setBusy(false); }
  }, [detail, candidateDetailKey, refreshMutationCaches]);
  const createRejectionLetterDraft = useCallback(async (payload: { candidate_id: string; failed_stage_instance_id: string; template_id: string; language: "th" | "en"; recipient_email: string; subject: string; body: string; retry_of_draft_id?: string }) => {
    if (!supabase) throw new Error("Sign in before sending a rejection letter.");
    setBusy(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch("/api/rejection-letters/draft", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.session?.access_token ?? ""}` }, body: JSON.stringify(payload) });
      const result = await response.json() as { ok?: boolean; error?: string; shared_mailbox?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not send rejection letter.");
      setStatus(`Rejection letter sent from ${result.shared_mailbox ?? "the shared HR mailbox"}.`);
      setRejectionLetterCandidateId(null); setRejectionLetterRetryDraftId(null);
      refreshMutationCaches("app_rejection_letter_draft");
    } finally { setBusy(false); }
  }, [refreshMutationCaches]);
  const toggleRequisitionPriority = useCallback(async (requisition: Requisition) => {
    if (!supabase || !canManageRequisitionPriority(data.profile, requisition)) throw new Error("Permission denied");
    const { data: result, error: rpcError } = await supabase.rpc("app_set_requisition_priority_v1", { payload: {
      doc_id: requisition.doc_id, is_priority: !requisition.is_priority, expected_updated_at: requisition.updated_at
    } });
    if (rpcError || result?.error || result?.ok !== true) throw new Error(rpcError?.message ?? result?.error ?? "Priority could not be saved");
    const patch = (rows: Requisition[]) => rows.map(row => row.doc_id === requisition.doc_id ? { ...row, is_priority: result.is_priority, updated_at: result.updated_at } : row);
    setData(current => ({ ...current, requisitions: patch(current.requisitions) }));
    setCompanyDashboardReport(current => current ? { ...current, requisitions: patch(current.requisitions) } : current);
    refreshMutationCaches("app_set_requisition_priority_v1");
    setStatus(translate(language, "prioritySaved"));
  }, [data.profile, language, refreshMutationCaches]);

  const hydratedCandidateData = candidateDetail.key === candidateDetailKey ? candidateDetail.data : null;
  const detailSource: DashboardData = detail?.type === "candidate" ? hydratedCandidateData ?? data : detail?.type === "requisition" && loadedRequisition ? {
    ...data,
    requisitions: [loadedRequisition.requisition],
    document_groups: loadedRequisition.documentGroups,
    position_groups: loadedRequisition.groups,
    offers: loadedRequisition.offers,
    requisition_logs: loadedRequisition.history,
  } : data;
  const selectedJourney = detail?.type === "candidate" ? selectedApplication(detailSource, detail.id, selectedApplicationId) : null;
  const detailData: DashboardData = detail?.type === "candidate" && detailSource.candidate_applications ? {
    ...detailSource, candidate_applications: selectedJourney ? [selectedJourney] : [],
    recruitment_logs: selectedJourney ? detailSource.recruitment_logs.filter(row => row.application_id === selectedJourney.application_id) : [],
    candidate_reference_checks: selectedJourney ? detailSource.candidate_reference_checks.filter(row => row.application_id === selectedJourney.application_id) : []
  } : detail?.type === "requisition" ? detailSource : data;
  const applicationAwareCandidate = (candidateId: string) => {
    const context = actionDataFor(candidateId);
    const journey = selectedApplication(context, candidateId, selectedApplicationId);
    const candidates = context === data ? enrichedCandidates : enrichCandidates(context);
    return candidates.find(row => row.candidate_id === candidateId && (journey ? row.application_id === journey.application_id : !context.candidate_applications));
  };
  const rejectionActionData = actionDataFor(rejectionLetterCandidateId ?? "");
  const currentStageActionData = actionDataFor(currentStageActionCandidateId ?? "");
  const legacyDetailBody = useMemo(
    () => buildDetailBodyV2(detail, detailData, language, canWrite && (detail?.type !== "candidate" || Boolean(selectedJourney && canManageApplicationGroup(detailSource,selectedJourney.group_id))), canDeleteRecords, openProcessFromDetail, openCurrentStageEdit, openDetailOffer, (offer, attendance) => { setProcessDefaults({ offer_id: offer.offer_id, offer_expected_updated_at: offer.updated_at, offer_start_confirmation: attendance ?? offer.start_confirmation }); setActiveModal("start_confirmation"); }, navigationContext, openDetailRequisitionChange, openDetailCandidateChange, openCandidateReference, openCandidateReferenceStatus, openCandidateReferenceCheck, prepareDestructiveRpcAction, openRejectionLetter, toggleRequisitionPriority),
    [canDeleteRecords, canWrite, detailSource, detail, detailData, selectedJourney, language, navigationContext, openCandidateReference, openCandidateReferenceCheck, openCandidateReferenceStatus, openDetailCandidateChange, openDetailRequisitionChange, openDetailOffer, openCurrentStageEdit, openProcessFromDetail, prepareDestructiveRpcAction, openRejectionLetter, toggleRequisitionPriority]
  );

  const detailBody: DetailBodyResult = detail?.type === "candidate" ? {
    title: `${formatRecruitmentId(detail.id)} / ${hydratedCandidateData?.candidates.find(row => row.candidate_id === detail.id)?.name ?? "Candidate"}`,
    body: (candidateDetail.loading && !hydratedCandidateData) || candidateDetail.key !== candidateDetailKey
      ? <LoadingSkeleton variant="detail" label={<>{translate(language, "loadingRecruitmentRecords")}</>} className="py-6 text-sm text-slate" />
      : candidateDetail.error
        ? <div role="alert" className="grid gap-3 py-4 text-sm text-slate"><p>{candidateDetail.error}</p><RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Recruitment Workspace`} type="button"  onClick={() => setCandidateDetailRetry(value => value + 1)}>{translate(language, "retry")}</RetryIconButton></div>
        : hydratedCandidateData ? <><div aria-busy={candidateDetail.loading}>{candidateDetail.loading ? <RefreshIndicator language={language} /> : null}</div><CandidateProfilePanel key={detail.id} candidateId={detail.id} applicationId={selectedJourney?.application_id ?? null} data={hydratedCandidateData} language={language} client={supabase} accessScope={detailAccessScope} onSelect={(id)=>{setSelectedApplicationId(id);const url=new URL(window.location.href);url.searchParams.set("applicationId",id);window.history.pushState({},"",url);}} onEdit={() => openDetailCandidateChange(detail.id)} onAction={prepareRpcAction}>{selectedJourney ? legacyDetailBody.body : null}</CandidateProfilePanel></>
        : <p>{translate(language, "candidateUnavailable")}</p>
  } : detail?.type === "requisition" ? {
    title: loadedRequisition ? formatRequisitionTitle(enrichRequisitions(detailSource)[0]) : detail.id,
    body: (requisitionDetail.loading && !loadedRequisition) || requisitionDetail.key !== requisitionDetailKey
      ? <LoadingSkeleton variant="detail" label={<>{translate(language, "loadingRecruitmentRecords")}</>} className="py-6 text-sm text-slate" />
      : requisitionDetail.error || requisitionDetailResult?.status !== "ready"
        ? <div role="alert" className="grid gap-3 py-4 text-sm text-slate"><p>{requisitionDetail.error ?? translate(language, "loadFailed")}</p><RetryIconButton type="button"  onClick={() => setRequisitionDetailRetry(value => value + 1)}>{translate(language, "retry")}</RetryIconButton></div>
        : <div aria-busy={requisitionDetail.loading}>{requisitionDetail.loading ? <RefreshIndicator language={language} /> : null}{legacyDetailBody.body}</div>
  } : legacyDetailBody;

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

  if (layoutMode === "unknown" || workspaceLoadState !== "ready") {
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
        language={language}
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

  const journeyActionData = journeyActionCandidateId ? actionDataFor(journeyActionCandidateId) : data;

  return (
    <DesktopInteractionContext.Provider value={registerDesktopLock}><AppShell
      layoutMode={layoutMode}
      activeView={initialView}
      variant={initialView === "dashboard" ? "dashboard" : undefined}
      headerScopeSummary={!desktopRequired && initialView === "dashboard" ? `${translate(language, "site")}: ${filters.site || translate(language, "allSites")} · ${translate(language, "personInCharge")}: ${filters.owner || translate(language, "allOwners")}${filters.priorityOnly ? ` · ${translate(language, "priorityRequisitions")}` : ""}` : undefined}
      headerControls={desktopRequired ? undefined : (
        <>
          <CommandSelector ariaLabel={translate(language, "site")} density="compact" emptyLabel={translate(language, "allSites")} options={[{ value: "", label: translate(language, "allSites") }, ...siteOptions.map((value) => ({ value, label: value }))]} value={filters.site} onValueChange={(value) => setFilters((old) => ({ ...old, site: value }))} className="w-full min-w-[8.5rem] sm:w-36" />
          <CommandSelector ariaLabel={translate(language, "personInCharge")} density="compact" emptyLabel={translate(language, "allOwners")} options={[{ value: "", label: translate(language, "allOwners") }, ...ownerOptions.map((value) => ({ value, label: value }))]} value={filters.owner} onValueChange={(value) => setFilters((old) => ({ ...old, owner: value }))} className="w-full min-w-[11rem] sm:w-48" />
          {ownerOptionsError ? <RetryIconButton type="button"   title={ownerOptionsError} onClick={() => setOwnerOptionsRetry(value => value + 1)}>Retry owners</RetryIconButton> : null}
          <Button type="button" size={initialView === "dashboard" ? "icon-toolbar" : "icon-sm"} variant="secondary" className={initialView === "dashboard" ? filters.priorityOnly ? "!bg-[#E8F0FF] !text-[#0A3CDC] !ring-[#9FBFFF]" : "!text-[#0A3CDC]" : filters.priorityOnly ? "min-h-11 min-w-11 !bg-[#E8F0FF] !text-[#0A3CDC] !ring-[#9FBFFF] sm:min-h-9 sm:min-w-9" : "min-h-11 min-w-11 !text-[#0A3CDC] sm:min-h-9 sm:min-w-9"}
            icon={<Bookmark size={initialView === "dashboard" ? 16 : 18} fill={filters.priorityOnly ? "currentColor" : "none"} aria-hidden="true" />}
            aria-label={translate(language, "priorityRequisitionFilter")} aria-pressed={filters.priorityOnly}
            title={translate(language, filters.priorityOnly ? "priorityRequisitions" : "allRequisitions")}
            onClick={() => setFilters(current => ({ ...current, priorityOnly: !current.priorityOnly }))} />
        </>
      )}
      language={language}
      navigationContext={navigationContext}
      profile={data.profile}
      onLanguageChange={() => setLanguage((current) => (current === "en" ? "th" : "en"))}
      onRefresh={desktopRequired ? undefined : () => { clearDashboardReportCache(); clearDashboardSummaryCache(); clearRecruitmentListCache(); if (supabase) clearScopedDetailCache(supabase); void loadData(true, true); }}
      onSignOut={signOut}
    >
      {desktopRequired ? <DesktopRequiredNotice view={initialView} language={language} navigationContext={navigationContext} /> : <>
      {loading || busy || error || showOperationalStatus ? (
        <StatusBanner
          busy={loading || busy}
          tone={error ? "error" : loading || busy ? "loading" : "info"}
          message={loading ? translate(language, "loadingRecruitmentRecordsEllipsis") : error ?? status}
        />
      ) : null}

      {initialView === "home" ? (
        <HomeView refreshKey={reportRefreshKey} bannerSummary={visibleHomeBannerSummary} bannerSummaryLoading={homeBannerLoading} bannerSummaryError={homeBannerError} onRetryBannerSummary={() => setHomeBannerRetry(value => value + 1)} listClient={supabase} accessScope={detailAccessScope} summaryScope={{ headerSite: filters.site, headerPic: filters.owner, priorityOnly: filters.priorityOnly }} language={language} profile={data.profile} requisitions={filteredRequisitions} candidates={filteredCandidates} offers={filteredOffers} recruitmentLogs={data.recruitment_logs} sourcingGroups={homeSourcingGroups} sourcingHref={buildContextualHref("/sourcing", { language, site: filters.site, owner: filters.owner, sourcingWeek, priority: filters.priorityOnly ? "only" : "all" })} staleSourcingGroups={staleSourcingGroups} changeLogs={filteredChangeLogs} dataQualityIssues={dataQualityIssues} canViewRecentActivity={canWrite} onConfirmStart={(offer, outcome) => { setProcessDefaults({ offer_id: offer.offer_id, offer_expected_updated_at: offer.updated_at, offer_start_confirmation: outcome ?? offer.start_confirmation }); setActiveModal("start_confirmation"); }} onEditPending={openPendingEdit} onOpenRequisition={(id) => setDetail({ type: "requisition", id })} onOpenCandidate={openCandidateDetail} />
      ) : null}

      {initialView === "dashboard" ? (
        <div className="grid min-w-0 gap-6">
          <DashboardPortal language={language} data={dashboardReportData} requisitions={dashboardRequisitions} offers={dashboardOffers} candidateOffers={priorityData.offers} globalSite={filters.site} globalOwner={filters.owner} globalPriorityOnly={filters.priorityOnly}
            refreshKey={reportRefreshKey}
            onOpenCandidate={(id, applicationId) => openCandidateDetail(id, applicationId)}
            onOpenRequisition={async row => { if (!supabase) return false; setBusy(true); setError(null); try {
              const authorized = await readReportPages<DashboardData["requisitions"][number]>(supabase, "requisitions", "doc_id", "*", ["doc_id", row.doc_id]);
              if (!authorized.length) return false;
              const [logs, offers] = await Promise.all([readReportPages<DashboardData["requisition_logs"][number]>(supabase, "requisition_logs", "log_id", "*", ["doc_id", row.doc_id]), readReportPages<DashboardData["offers"][number]>(supabase, "offers", "offer_id", "*", ["doc_id", row.doc_id])]);
              setData(current => ({ ...current, requisitions: [...current.requisitions.filter(req => req.doc_id !== row.doc_id), ...authorized], requisition_logs: [...current.requisition_logs.filter(log => log.doc_id !== row.doc_id), ...logs], offers: [...current.offers.filter(offer => offer.doc_id !== row.doc_id), ...offers] })); setDetail({ type: "requisition", id: row.doc_id }); return true;
            } catch { setError(language === "th" ? "โหลดรายละเอียดใบขออัตราไม่สำเร็จ โปรดลองใหม่" : "Could not load requisition details. Please retry."); return true; } finally { setBusy(false); } }} />
        </div>
      ) : null}

      {initialView === "workspace" ? (
        <HiringWorkspaceView
          canManageSetup={canManageSetup}
          canWrite={canWrite && !historicalWorkspace}
          data={priorityData}
          language={language}
          siteFilter={filters.site}
          ownerFilter={filters.owner}
          listClient={supabase}
          accessScope={detailAccessScope}
          priorityOnly={filters.priorityOnly}
          refreshKey={reportRefreshKey}
          onDispatchAction={dispatchWorkspaceAction}
          offerSlot={(
            <WorkspaceOfferSection
              allOffers={data.offers}
              candidates={workspaceScope.candidates}
              canWrite={canWrite && !historicalWorkspace}
              offers={workspaceScope.offers}
              profile={data.profile}
              requisitions={workspaceScope.requisitions}
              onAction={dispatchWorkspaceAction}
              onOpenCandidate={openCandidateDetail}
              onOpenRequisition={(id) => setDetail({ type: "requisition", id })}
            />
          )}
          pipelineSlot={(
            <PipelineBoardView
              embedded
              listClient={supabase}
              mutationRevision={reportRefreshKey}
              accessScope={`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "local"}:${data.profile?.id ?? "anonymous"}:${data.profile?.role ?? "viewer"}:${data.profile?.site ?? ""}:${data.profile?.updated_at ?? ""}`}
              listScope={{ headerSite: filters.site, headerPic: filters.owner, priorityOnly: filters.priorityOnly, groupId: workspaceTarget.type === "group" ? workspaceTarget.id : null }}
              onEnsureActionContext={ensureCandidateActionContext}
              canWrite={canWrite && !historicalWorkspace}
              dataQualityIssues={dataQualityIssues}
              language={language}
              profile={data.profile}
              recruitmentLogs={data.recruitment_logs}
              candidateReferences={data.candidate_references}
              candidateReferenceChecks={data.candidate_reference_checks}
              rows={workspaceScope.candidates}
              offeredCandidateIds={offeredCandidateIds}
              rejectionLetterSentCandidateIds={rejectionLetterSentCandidateIds}
              onNewCandidate={!historicalWorkspace && canWrite ? () => {
                const eligible = eligibleCandidateGroups(data, data.profile, workspaceScope.groupIds);
                if (eligible.length) dispatchWorkspaceAction({ kind: "candidate.create", docGroupIds: eligible.flatMap(group => data.document_groups.filter(match => match.group_id === group.group_id).slice(0, 1).map(match => match.doc_group_id)) });
                else if (workspaceTarget.type === "group" && workspaceTarget.id) {
                  setModalDefaults({ mode: "new", group_id: workspaceTarget.id, lock_group_id: true, first_contact_date: today() });
                  setActiveModal("candidate");
                }
              } : undefined}
              onOpen={openCandidateDetail}
              onMove={openProcessForMove}
              onFailCurrentStage={(candidate) => openStageOutcome(candidate, "fail")}
              onMaintainTest={openMaintainTest}
              onStartProcess={openInitialProcessUpdate}
              onEditPending={openPendingEdit}
              onPassStage={(candidate) => openStageOutcome(candidate, "pass")}
              onManageReferenceChecks={(candidate) => openCandidateDetail(candidate.candidate_id, candidate.application_id)}
              onCreateOffer={(candidate) => dispatchWorkspaceAction({ kind: "offer.upsert", candidateId: candidate.candidate_id, applicationId: candidate.application_id })}
              onUpdateOffer={openOfferUpdate}
              onCreateRejectionLetter={openRejectionLetter}
            />
          )}
          profile={data.profile}
          sourcingSlot={(selectedGroupData) => (
            <EmbeddedSourcingEditor
              canManageSetup={canManageSetup && !historicalWorkspace}
              canWrite={canWrite}
              data={selectedGroupData}
              client={supabase}
              accessScope={detailAccessScope}
              priorityOnly={filters.priorityOnly}
              refreshKey={reportRefreshKey}
              docIds={selectedGroupData.requisitions.map((row) => row.doc_id)}
              groupIds={workspaceScope.groupIds}
              language={language}
              profile={data.profile}
              siteFilter={filters.site}
              ownerFilter={filters.owner}
              weekStart={sourcingWeek}
              onSaveSourcing={(payload, summary) => prepareRpcAction("app_upsert_sourcing_weekly_update", payload, summary)}
              onUpdateGroupInfo={historicalWorkspace ? undefined : (payload, summary) => prepareRpcAction("app_update_sourcing_group_info_v1", payload, summary)}
              onSetGroupChannel={historicalWorkspace ? undefined : (payload, summary) => prepareRpcAction("app_set_sourcing_group_channel_v1", payload, summary)}
              onUnmatchGroupRequisition={historicalWorkspace ? undefined : (payload, summary) => prepareDestructiveRpcAction("app_unmatch_group_requisition", payload, summary)}
              onDeleteGroup={historicalWorkspace ? undefined : (payload, summary) => prepareDestructiveRpcAction("app_delete_recruitment_record", payload, summary)}
              onAddGroupRequisition={historicalWorkspace ? undefined : (groupId, docId) => prepareRpcAction("app_create_group_match", { group_id: groupId, doc_id: docId }, `Match sourcing group ${groupId} to requisition ${docId}`)}
              onWeekChange={setSourcingWeek}
            />
          )}
          target={workspaceTarget}
          weekStart={sourcingWeek}
          onOpenCandidate={openCandidateDetail}
          onOpenRequisition={(id) => setDetail({ type: "requisition", id })}
        />
      ) : null}

      {initialView === "requisitions" ? (
        <RequisitionsView language={language} rows={filteredRequisitions} candidates={filteredCandidates} profile={data.profile} canWrite={canWrite} client={supabase} accessScope={detailAccessScope} listScope={{ headerSite: filters.site, headerPic: filters.owner, priorityOnly: filters.priorityOnly }} onNew={() => setActiveModal("requisition")} onStatus={() => setActiveModal("status")} onOpen={(id) => setDetail({ type: "requisition", id })} />
      ) : null}

      {initialView === "candidates" ? (
        <CandidateRegistry data={data} client={supabase} language={language} canWrite={canWrite} site={filters.site} owner={filters.owner} onNew={() => { setModalDefaults({}); setActiveModal("candidate"); }} onOpen={openCandidateDetail} />
      ) : null}

      {initialView === "pipeline" ? (
        <PipelineBoardView listClient={supabase} mutationRevision={reportRefreshKey} accessScope={`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "local"}:${data.profile?.id ?? "anonymous"}:${data.profile?.role ?? "viewer"}:${data.profile?.site ?? ""}:${data.profile?.updated_at ?? ""}`} listScope={{ headerSite: filters.site, headerPic: filters.owner, priorityOnly: filters.priorityOnly }} onEnsureActionContext={ensureCandidateActionContext} language={language} rows={filteredCandidates} recruitmentLogs={data.recruitment_logs} recruitmentLogHistory={data.recruitment_log_history} candidateReferences={data.candidate_references} candidateReferenceChecks={data.candidate_reference_checks} profile={data.profile} dataQualityIssues={dataQualityIssues} canWrite={canWrite} offeredCandidateIds={offeredCandidateIds} rejectionLetterSentCandidateIds={rejectionLetterSentCandidateIds} onNewCandidate={() => setActiveModal("candidate")} onOpen={openCandidateDetail} onMove={openProcessForMove} onFailCurrentStage={(candidate) => openStageOutcome(candidate, "fail")} onMaintainTest={openMaintainTest} onStartProcess={openInitialProcessUpdate} onEditPending={openPendingEdit} onPassStage={(candidate) => openStageOutcome(candidate, "pass")} onManageReferenceChecks={(candidate) => openCandidateDetail(candidate.candidate_id, candidate.application_id)} onCreateOffer={(candidate) => dispatchWorkspaceAction({ kind: "offer.upsert", candidateId: candidate.candidate_id, applicationId: candidate.application_id })} onUpdateOffer={openOfferUpdate} onEditCandidate={openDetailCandidateChange} onCorrectPipelineRecord={openPipelineRecordCorrection} onCreateRejectionLetter={openRejectionLetter} />
      ) : null}

      {initialView === "offers" ? <OffersView language={language} rows={filteredOffers} allOffers={data.offers} requisitions={filteredRequisitions} profile={data.profile} canWrite={canWrite} client={supabase} accessScope={detailAccessScope} listScope={{ headerSite: filters.site, headerPic: filters.owner, priorityOnly: filters.priorityOnly }} onNew={() => setActiveModal("offer")} onOpenCandidate={openCandidateDetail} /> : null}

      {initialView === "sourcing" ? (
        <SourcingView
          client={supabase}
          accessScope={detailAccessScope}
          language={language}
          data={priorityData}
          profile={data.profile}
          siteFilter={filters.site}
          ownerFilter={filters.owner}
          priorityOnly={filters.priorityOnly}
          refreshKey={reportRefreshKey}
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

      {initialView === "configuration" ? <ConfigurationView language={language} data={data} canManageRejectionTemplates={canManageRejectionTemplates} onTemplatesChanged={refreshConfigurationTemplates} onReasonsChanged={refreshRejectionReasons} /> : null}

      {initialView === "admin" ? <AdminView language={language} data={data} canManageUsers={canManageUsers} onInvite={() => setActiveModal("user")} client={supabase} accessScope={detailAccessScope} refreshKey={reportRefreshKey} /> : null}

      {initialView === "audit" ? <AuditView language={language} rows={data.change_logs} client={supabase} accessScope={detailAccessScope} /> : null}

      <RecordModal
        modal={activeModal}
        client={supabase}
        accessScope={detailAccessScope}
        language={language}
        data={data}
        profile={data.profile}
        canManageUsers={canManageUsers}
        processDefaults={processDefaults}
        modalDefaults={modalDefaults}
        selectedRequisition={detail?.type === "requisition" ? loadedRequisition?.requisition ?? null : null}
        lookupScope={{ headerSite: filters.site, headerPic: filters.owner, priorityOnly: filters.priorityOnly }}
        onClose={closeRecordModal}
        onSubmit={prepareAction}
        onValidationError={showUpdateDenial}
        reviewBusy={candidateReviewBusy}
        reviewError={activeModal==="candidate"?candidateReviewError:null}
      />

      <Modal open={Boolean(duplicateReview)} title={language==="th"?"พบข้อมูลติดต่อซ้ำ":"Matching candidate contacts"} onClose={()=>setDuplicateReview(null)}>
        <div className="grid gap-4 p-5"><p className="text-sm text-slate">{language==="th"?"ตรวจสอบรหัสผู้สมัครที่ตรงกันก่อนบันทึกเป็นคนละราย":"Review these matching candidate IDs before saving a separate person."}</p>
          {duplicateReview?.matches.map(match=><div key={match.candidate_id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#D7DEE8] p-3"><p className="text-sm font-semibold text-navy">{formatRecruitmentId(match.candidate_id)}<span className="block text-xs font-normal text-slate">{[match.phone?(language==="th"?"โทรศัพท์":"Phone"):null,match.email?(language==="th"?"อีเมล":"Email"):null].filter(Boolean).join(" + ")}</span></p><a className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline" href={`/candidates?detailType=candidate&detailId=${encodeURIComponent(match.candidate_id)}`} target="_blank" rel="noreferrer">{language==="th"?"เปิดข้อมูลเดิม":"Open existing profile"}</a></div>)}
          <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={()=>setDuplicateReview(null)}>{language==="th"?"กลับไปแก้ไข":"Back to form"}</Button><Button type="button" onClick={()=>{if(!duplicateReview)return;const {payload,matches,summary}=duplicateReview;setDuplicateReview(null);setPendingAction({title:"Confirm Save",summary,endpoint:"app_upsert_candidate_profile_v2",payload:{...payload,duplicate_review:{phone:String(payload.phone_no??"").trim(),email:String(payload.email??"").trim().toLowerCase(),matches}},modal:"candidate",route:"rpc"});}}>{language==="th"?"ดำเนินการเป็นคนละราย":"Continue as a separate candidate"}</Button></div>
        </div>
      </Modal>

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
        summary={visibleWelcomeSummary}
        loading={welcomeSummaryLoading}
        error={welcomeSummaryError}
        onClose={closeWelcomeSummary}
        onPipeline={openWelcomePipeline}
        onRetry={() => setWelcomeSummaryRetry(value => value + 1)}
      />

      <ConfirmModal
        language={language}
        reasons={data.rejection_reasons}
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

      <CandidateJourneyActions
        candidate={applicationAwareCandidate(journeyActionCandidateId ?? "") ?? null}
        language={language}
        logs={journeyActionCandidateId ? latestLogsForCandidate(journeyActionData, journeyActionCandidateId, selectedJourney?.application_id ?? selectedApplicationId) : []}
        references={journeyActionData.candidate_references.filter((reference) => reference.candidate_id === journeyActionCandidateId)}
        checks={journeyActionData.candidate_reference_checks.filter(row => row.application_id === (selectedJourney?.application_id ?? selectedApplicationId))}
        profile={data.profile}
        onClose={() => setJourneyActionCandidateId(null)}
        onStart={(candidate) => { setJourneyActionCandidateId(null); openInitialProcessUpdate(candidate); }}
        onPass={(candidate) => { setJourneyActionCandidateId(null); openStageOutcome(candidate, "pass"); }}
        onFail={(candidate) => { setJourneyActionCandidateId(null); openStageOutcome(candidate, "fail"); }}
        onTest={(candidate) => { setJourneyActionCandidateId(null); openMaintainTest(candidate); }}
        onReferences={(candidate) => { setJourneyActionCandidateId(null); setDetail({ type: "candidate", id: candidate.candidate_id }); }}
        onOffer={(candidate) => { setJourneyActionCandidateId(null); openOfferUpdate(candidate); }}
        onEditPending={(candidate) => { setJourneyActionCandidateId(null); openPendingEdit(candidate); }}
        onMove={(candidate, stage) => { setJourneyActionCandidateId(null); openProcessForMove(candidate, stage); }}
      />

      <Drawer
        open={Boolean(detail)}
        eyebrow={detail?.type === "candidate" ? "Candidate Detail" : "Requisition Detail"}
        title={detailBody.title}
        headerMeta={detailBody.headerMeta}
        headerContent={detailBody.headerContent}
        headerActions={detailBody.headerActions}
        variant={detail ? "candidate-workspace" : "side"}
        uniformHeaderActions={detail?.type === "requisition"}
        inactive={Boolean(activeModal || pendingAction || destructiveAction || offerPassHandoff || journeyActionCandidateId || currentStageActionCandidateId)}
        onClose={() => setDetail(null)}
      >
        {detailBody.body}
      </Drawer>
      <RejectionLetterComposer open={Boolean(rejectionLetterCandidateId)} candidate={applicationAwareCandidate(rejectionLetterCandidateId ?? "") ?? null} failedLog={rejectionActionData.recruitment_logs.find((log) => log.candidate_id === rejectionLetterCandidateId && (!selectedApplicationId || log.application_id === selectedApplicationId) && log.result === 0 && !log.superseded_at) ?? null} language={language} templates={data.rejection_letter_templates} drafts={rejectionActionData.rejection_letter_drafts} retryOf={rejectionActionData.rejection_letter_drafts.find((draft) => draft.draft_id === rejectionLetterRetryDraftId) ?? null} recruiterName={data.profile?.nickname ?? data.profile?.full_name ?? data.profile?.email ?? "Recruitment"} busy={busy} onClose={() => { setRejectionLetterCandidateId(null); setRejectionLetterRetryDraftId(null); }} onCreate={createRejectionLetterDraft} />
      {rejectionLetterCandidateId && rejectionTemplateError ? <p role="alert" className="fixed bottom-4 right-4 z-[90] rounded-md bg-white p-3 text-sm text-scarlet shadow-lg">Could not load rejection templates: {rejectionTemplateError}</p> : null}
      <CurrentStageEditModal candidate={applicationAwareCandidate(currentStageActionCandidateId ?? "") ?? null} stage={currentStageActionData.recruitment_logs.find((log) => log.candidate_id === currentStageActionCandidateId && log.application_id === selectedApplicationId && log.result === null && !log.superseded_at) ?? null} meeting={currentStageActionData.interview_meetings.find((meeting) => meeting.candidate_id === currentStageActionCandidateId && currentStageActionData.recruitment_logs.some(log => log.stage_instance_id === meeting.stage_instance_id && log.application_id === selectedApplicationId) && meeting.status !== "cancelled") ?? null} templates={data.interview_invitation_templates} profiles={invitationProfiles} language={language} recruiterName={data.profile?.nickname ?? data.profile?.full_name ?? data.profile?.email ?? "Recruitment"} busy={busy} onClose={() => setCurrentStageActionCandidateId(null)} onSaveEstimate={saveCurrentStageEstimate} onSaveTeams={saveTeamsInterview} />
      {currentStageActionCandidateId && invitationTemplateError ? <p role="alert" className="fixed bottom-4 right-4 z-[90] rounded-md bg-white p-3 text-sm text-scarlet shadow-lg">Could not load interview templates: {invitationTemplateError}</p> : null}
      {currentStageActionCandidateId && invitationProfilesError ? <p role="alert" className="fixed bottom-4 right-4 z-[90] rounded-md bg-white p-3 text-sm text-scarlet shadow-lg">Could not load interviewer options: {invitationProfilesError} <RetryIconButton type="button" onClick={() => setInvitationProfilesRetry(value => value + 1)}>{translate(language, "retry")}</RetryIconButton></p> : null}
      </>}
    </AppShell></DesktopInteractionContext.Provider>
  );
}

function buildPayload(modal: Exclude<ModalName, null>, formData: FormData) {
  if (modal === "requisition") {
    const payload = {
      mode: String(formData.get("mode") ?? "new"),
      doc_id: emptyToNull(formData.get("doc_id")),
      previous_doc_id: emptyToNull(formData.get("previous_doc_id")),
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
      position_interests: emptyToNull(formData.get("position_interests")),
      ...(formData.has("note") ? {note: emptyToNull(formData.get("note")),expected_note_id:emptyToNull(formData.get("expected_note_id")),expected_note_version:emptyToNull(formData.get("expected_note_version"))}:{}),
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
        remark: emptyToNull(formData.get("outcome_remark")),
        ...(outcome === "fail" ? { failure_actor: emptyToNull(formData.get("failure_actor")), failure_main_reason_id: emptyToNull(formData.get("failure_main_reason_id")), failure_detail_reason_id: emptyToNull(formData.get("failure_detail_reason_id")) } : {})
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
    if (!payload.pending.opened_date || !payload.outcome.date) throw new Error("An outcome date is required.");
    if (outcome === "fail" && (!payload.outcome.failure_actor || !payload.outcome.failure_main_reason_id || !payload.outcome.failure_detail_reason_id)) throw new Error("Select who ended the process, a main reason, and a detailed reason.");
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
      outcome: outcomeResult ? { result: outcomeResult, date: emptyToNull(formData.get("outcome_date")), interviewer: emptyToNull(formData.get("outcome_interviewer")), remark: emptyToNull(formData.get("outcome_remark")), ...(outcomeResult === "fail" && formData.get("failure_actor") ? { failure_actor: emptyToNull(formData.get("failure_actor")), failure_main_reason_id: emptyToNull(formData.get("failure_main_reason_id")), failure_detail_reason_id: emptyToNull(formData.get("failure_detail_reason_id")) } : {}) } : undefined
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
  client,
  accessScope,
  language,
  data,
  profile,
  canManageUsers,
  processDefaults,
  modalDefaults,
  selectedRequisition = null,
  lookupScope = {},
  onClose,
  onSubmit,
  onValidationError,
  reviewBusy=false,
  reviewError=null
}: {
  modal: ModalName;
  client: SupabaseClient | null;
  accessScope: string;
  language: Language;
  data: DashboardData;
  profile: DashboardData["profile"];
  canManageUsers: boolean;
  processDefaults: ProcessDefaults;
  modalDefaults: ModalDefaults;
  selectedRequisition?: Requisition | null;
  lookupScope?: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (modal: Exclude<ModalName, null>, form: HTMLFormElement) => void;
  onValidationError: (message: string) => void;
  reviewBusy?: boolean;
  reviewError?: string|null;
}) {
  const [mode, setMode] = useState<"new" | "change">("new");
  const [selectedId, setSelectedId] = useState("");
  const [selectedRequisitionRow, setSelectedRequisitionRow] = useState<EnrichedRequisition | null>(null);
  const [exactRequisitionState, setExactRequisitionState] = useState<{ id: string; scope: string; client: SupabaseClient | null; status: "loading" | "ready" | "missing" | "error"; row: EnrichedRequisition | null; error?: string } | null>(null);
  const [exactRequisitionRetry, setExactRequisitionRetry] = useState(0);
  const [groupSeedStatus, setGroupSeedStatus] = useState<{ scope: string; client: SupabaseClient | null; status: "none" | "loading" | "ready" | "missing" | "error" }>({ scope: "", client: null, status: "none" });
  const reportGroupSeedState = useCallback((status: "none" | "loading" | "ready" | "missing" | "error") => setGroupSeedStatus({ scope: accessScope, client, status }), [accessScope, client]);
  const [assignableProfiles, setAssignableProfiles] = useState<Profile[]>([]);
  const [ownerOptionsLoading, setOwnerOptionsLoading] = useState(false);
  const [ownerOptionsError, setOwnerOptionsError] = useState<string | null>(null);
  const [ownerOptionsRetry, setOwnerOptionsRetry] = useState(0);

  useEffect(() => {
    setMode(modalDefaults.mode ?? "new");
    setSelectedId(modalDefaults.selectedId ?? processDefaults.candidate_id ?? "");
    setSelectedRequisitionRow(null);
  }, [modal, modalDefaults.mode, modalDefaults.selectedId, processDefaults.candidate_id]);

  useEffect(() => {
    if (selectedRequisition && selectedRequisition.doc_id === selectedId) {
      const enriched = enrichRequisitions({ ...data, requisitions: [selectedRequisition] })[0];
      if (enriched) setSelectedRequisitionRow(enriched);
    } else if (!selectedId) setSelectedRequisitionRow(null);
  }, [data, selectedId, selectedRequisition]);

  useEffect(() => {
    setSelectedRequisitionRow(null);
    setExactRequisitionState(null);
    setGroupSeedStatus({ scope: accessScope, client, status: "none" });
  }, [accessScope, client]);

  useEffect(() => {
    const needsExactTarget = (modal === "status" || (modal === "requisition" && mode === "change")) && Boolean(selectedId);
    if (!needsExactTarget) { setExactRequisitionState(null); return; }
    if (selectedRequisitionRow?.doc_id === selectedId) {
      setExactRequisitionState({ id: selectedId, scope: accessScope, client, status: "ready", row: selectedRequisitionRow });
      return;
    }
    if (selectedRequisition?.doc_id === selectedId) {
      const row = enrichRequisitions({ ...data, requisitions: [selectedRequisition] })[0] ?? null;
      setExactRequisitionState({ id: selectedId, scope: accessScope, client, status: row ? "ready" : "missing", row });
      return;
    }
    if (!client) { setExactRequisitionState({ id: selectedId, scope: accessScope, client, status: "error", row: null, error: "Database connection is unavailable." }); return; }
    let active = true;
    setExactRequisitionState({ id: selectedId, scope: accessScope, client, status: "loading", row: null });
    void (async () => {
      try {
        const { data: raw, error } = await client.from("requisitions").select("*").eq("doc_id", selectedId).maybeSingle();
        if (!active) return;
        if (error) { setExactRequisitionState({ id: selectedId, scope: accessScope, client, status: "error", row: null, error: error.message }); return; }
        if (!raw || raw.doc_id !== selectedId) { setExactRequisitionState({ id: selectedId, scope: accessScope, client, status: "missing", row: null }); return; }
        const row = enrichRequisitions({ ...data, requisitions: [raw as Requisition] })[0] ?? null;
        setExactRequisitionState({ id: selectedId, scope: accessScope, client, status: row ? "ready" : "missing", row });
      } catch (error) {
        if (active) setExactRequisitionState({ id: selectedId, scope: accessScope, client, status: "error", row: null, error: error instanceof Error ? error.message : "Could not load the selected requisition." });
      }
    })();
    return () => { active = false; };
  }, [accessScope, client, data, exactRequisitionRetry, modal, mode, selectedId, selectedRequisition, selectedRequisitionRow]);

  useEffect(() => {
    if ((modal !== "requisition" && modal !== "user") || !client || !profile || (modal === "user" && !canManageUsers)) return;
    if (modal === "requisition" && profile.role === "site_recruiter") { setAssignableProfiles([profile]); setOwnerOptionsError(null); setOwnerOptionsLoading(false); return; }
    let active = true;
    setOwnerOptionsLoading(true); setOwnerOptionsError(null);
    void loadAuthorizedRecruiterOptions(client, { profileId: profile.id, key: accessScope }).then(rows => {
      if (active) setAssignableProfiles(rows);
    }).catch(loadError => {
      if (active) setOwnerOptionsError(loadError instanceof Error ? loadError.message : "Could not load authorized recruiter options.");
    }).finally(() => { if (active) setOwnerOptionsLoading(false); });
    return () => { active = false; };
  }, [accessScope, canManageUsers, client, modal, ownerOptionsRetry, profile]);

  if (!modal) return null;
  const selectedRecords = selectedModalRecords(data, selectedId);
  const exactStateMatches = exactRequisitionState?.id === selectedId && exactRequisitionState.scope === accessScope && exactRequisitionState.client === client;
  const scopedSelectedRequisition = selectedRequisitionRow?.doc_id === selectedId ? selectedRequisitionRow : selectedRequisition?.doc_id === selectedId ? enrichRequisitions({ ...data, requisitions: [selectedRequisition] })[0] ?? null : exactStateMatches && exactRequisitionState.status === "ready" ? exactRequisitionState.row : null;
  const exactTargetRequired = Boolean(selectedId && (modal === "status" || (modal === "requisition" && mode === "change")));
  const exactGroupSeedRequired = Boolean(modal === "group_match" && modalDefaults.doc_id);
  const groupSeedMatches = groupSeedStatus.scope === accessScope && groupSeedStatus.client === client;
  const exactTargetPending = (exactTargetRequired && (!exactStateMatches || exactRequisitionState.status === "loading")) || (exactGroupSeedRequired && (!groupSeedMatches || groupSeedStatus.status === "none" || groupSeedStatus.status === "loading"));
  const exactTargetUnavailable = (exactTargetRequired && exactStateMatches && (exactRequisitionState.status === "missing" || exactRequisitionState.status === "error")) || (exactGroupSeedRequired && groupSeedMatches && (groupSeedStatus.status === "missing" || groupSeedStatus.status === "error"));
  const selectedProfile = assignableProfiles.find(row => row.id === selectedId) ?? selectedRecords.profile;
  const profileFormData = assignableProfiles.length ? { ...data, profiles: assignableProfiles } : data;
  function handleModeChange(nextMode: "new" | "change") {
    setMode(nextMode);
    setSelectedId("");
    setSelectedRequisitionRow(null);
  }

  function selectRequisition(row: EnrichedRequisition | null) {
    setSelectedRequisitionRow(row);
    setSelectedId(row?.doc_id ?? "");
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
        {modal === "requisition" ? <RequisitionFields key={`${selectedId}-${scopedSelectedRequisition?.updated_at ?? "pending"}`} data={data} client={client} accessScope={accessScope} lookupScope={lookupScope} language={language} profile={profile} ownerProfiles={assignableProfiles} ownerOptionsLoading={ownerOptionsLoading} ownerOptionsError={ownerOptionsError} onRetryOwnerOptions={() => setOwnerOptionsRetry(value => value + 1)} mode={mode} selectedId={selectedId} selected={scopedSelectedRequisition} onSelect={setSelectedId} onSelectRow={selectRequisition} /> : null}
        {modal === "status" ? <StatusFields key={`${selectedId}-${scopedSelectedRequisition?.status ?? "pending"}`} client={client} accessScope={accessScope} lookupScope={lookupScope} language={language} selectedId={selectedId} selected={scopedSelectedRequisition} onSelect={selectRequisition} /> : null}
        {exactTargetPending ? <LoadingSkeleton variant="lookup" label={<>{translate(language, "loading")}</>} className="text-sm text-slate" /> : null}
        {exactTargetUnavailable ? <div className="flex items-center gap-2 text-sm text-danger" role="alert"><span>{exactRequisitionState?.error ?? translate(language, "recordUnavailable")}</span><RetryIconButton type="button"  onClick={() => setExactRequisitionRetry(value => value + 1)}>{translate(language, "retry")}</RetryIconButton></div> : null}
        {modal === "candidate" ? <CandidatePrefillFields data={data} language={language} profile={profile} mode={mode} selectedId={selectedId} selected={selectedRecords.candidate} defaults={modalDefaults} onSelect={setSelectedId} client={client} accessScope={accessScope} /> : null}
        {modal === "candidate_reference" ? <CandidateReferenceFields defaults={processDefaults} language={language} /> : null}
        {modal === "reference_status" ? <CandidateReferenceStatusFields defaults={processDefaults} language={language} /> : null}
        {modal === "reference_check" ? <CandidateReferenceCheckFields defaults={processDefaults} language={language} /> : null}
        {modal === "pipeline_start" ? <PipelineStartFields defaults={processDefaults} language={language} /> : null}
        {modal === "pending_edit" ? <PendingEditFields defaults={processDefaults} language={language} /> : null}
        {modal === "pipeline_record_correction" ? <PipelineRecordCorrectionFields canEditPendingDate={data.profile?.role === "system_admin"} defaults={processDefaults} language={language} reasons={data.rejection_reasons} /> : null}
        {modal === "stage_outcome" ? <StageOutcomeFields defaults={processDefaults} language={language} reasons={data.rejection_reasons} /> : null}
        {modal === "pipeline_pass" ? <PipelinePassFields data={data} defaults={processDefaults} language={language} /> : null}
        {modal === "offer" ? <OfferPrefillFields data={data} language={language} mode={mode} selectedId={selectedId} selected={selectedRecords.offer} defaults={modalDefaults} onSelect={setSelectedId} client={client} accessScope={accessScope} /> : null}
        {modal === "start_confirmation" ? <StartConfirmationFields defaults={processDefaults} language={language} /> : null}
        {modal === "group" ? <GroupPrefillFields data={data} language={language} mode={mode} selectedId={selectedId} selected={selectedRecords.group} defaults={modalDefaults} onSelect={setSelectedId} client={client} accessScope={accessScope} /> : null}
        {modal === "group_match" ? <CreateAndMatchGroupFields client={client} accessScope={accessScope} lookupScope={lookupScope} profile={profile} defaults={modalDefaults} language={language} onLookupState={reportGroupSeedState} /> : null}
        {modal === "match" ? <MatchFields client={client} accessScope={accessScope} lookupScope={lookupScope} defaults={modalDefaults} language={language} /> : null}
        {modal === "snapshot" ? <SnapshotFields data={data} language={language} /> : null}
        {modal === "user" ? <UserPrefillFields canManageUsers={canManageUsers} data={profileFormData} profiles={assignableProfiles} profilesLoading={ownerOptionsLoading} profilesError={ownerOptionsError} onRetryProfiles={() => setOwnerOptionsRetry(value => value + 1)} language={language} mode={mode} selectedId={selectedId} selected={selectedProfile} onSelect={setSelectedId} /> : null}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-[#D7DEE8] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4">
          <Button type="button" variant="secondary" className="min-h-11 flex-1 sm:flex-none" onClick={onClose}>{translate(language, "cancel")}</Button>
          {reviewError?<p role="alert" className="text-sm text-scarlet">{reviewError}</p>:null}<Button type="submit" disabled={reviewBusy || exactTargetPending || exactTargetUnavailable || (exactTargetRequired && !scopedSelectedRequisition) || (exactGroupSeedRequired && (!groupSeedMatches || groupSeedStatus.status !== "ready"))} className="min-h-11 flex-1 sm:flex-none">{translate(language, "reviewChanges")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function AuthorizedPositionGroupLookup({ client, accessScope, scope, language, value, selectedRow = null, onSelect, label, name }: { client: SupabaseClient | null; accessScope: string; scope: Record<string, unknown>; language: Language; value: string; selectedRow?: EnrichedSourcingGroup | null; onSelect: (row: EnrichedSourcingGroup | null) => void; label: string; name: string }) {
  const [search, setSearch] = useState("");
  const [retained, setRetained] = useState<{ id: string; row: EnrichedSourcingGroup } | null>(null);
  const page = useRecruitmentList<EnrichedSourcingGroup>({ client, accessScope, entity: "position_groups", filters: { ...scope, scope: "all" }, sort: "name", direction: "asc", searchInput: { value: search, setValue: setSearch }, enabled: Boolean(client && accessScope) });
  const visibleRow = page.items.find(row => row.group_id === value) ?? null;
  useEffect(() => { if (visibleRow) setRetained({ id: visibleRow.group_id, row: visibleRow }); }, [visibleRow]);
  useEffect(() => { if (selectedRow) setRetained({ id: selectedRow.group_id, row: selectedRow }); else if (!value) setRetained(null); }, [selectedRow, value]);
  useEffect(() => { if (value && !visibleRow && selectedRow?.group_id !== value && !retained) setSearch(value); }, [retained, selectedRow, value, visibleRow]);
  const effectiveSelected = value ? visibleRow ?? (selectedRow?.group_id === value ? selectedRow : null) ?? (retained?.id === value ? retained.row : null) : null;
  const rows = effectiveSelected && !page.items.some(row => row.group_id === effectiveSelected.group_id) ? [effectiveSelected, ...page.items] : page.items;
  return <div className="grid gap-2" data-testid="authorized-group-lookup">
    <Field label={language === "th" ? "ค้นหากลุ่มตำแหน่ง" : "Search position groups"}><TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder={language === "th" ? "รหัสกลุ่ม ตำแหน่ง หรือไซต์" : "Group ID, position, or site"} aria-label={language === "th" ? "ค้นหากลุ่มตำแหน่ง" : "Search position groups"} /></Field>
    <Field label={label}><SelectInput name={name} aria-label={label} value={value} required onChange={event => { const row = rows.find(candidate => candidate.group_id === event.target.value) ?? null; setRetained(row ? { id: row.group_id, row } : null); onSelect(row); }}>{[<option key="" value="">{language === "th" ? "เลือกกลุ่ม" : "Select group"}</option>, ...rows.map(row => <option key={row.group_id} value={row.group_id}>{formatRecruitmentId(row.group_id)} · {row.group_position}{row.sites.length ? ` · ${row.sites.join(", ")}` : ""}</option>)]}</SelectInput></Field>
    <div className="flex items-center justify-between gap-2 text-xs text-slate"><span>{page.totalCount === null && page.countLoading ? <NumberSkeleton/> : page.countLabel} · {language === "th" ? "กลุ่ม" : "groups"}</span>{page.countError ? <RetryIconButton type="button"   onClick={page.retryCount} loading={page.countLoading}>{translate(language, "retry")}</RetryIconButton> : null}</div>
    {page.initialLoading ? <LoadingSkeleton variant="lookup" label={<>{translate(language, "loading")}</>} className="text-sm text-slate" /> : null}
    {page.error ? <div role="alert" className="flex items-center justify-between gap-2 text-sm text-danger"><span>{translate(language, "recordUnavailableOrLoadFailed")}</span><RetryIconButton type="button"   onClick={page.retry} loading={page.loading}>{translate(language, "retry")}</RetryIconButton></div> : null}
    {!page.error ? <div className="flex items-center justify-end gap-2"><SelectInput aria-label={translate(language, "rowsPerPage")} value={page.pageSize} onChange={event => page.setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></SelectInput><Button type="button" size="sm" variant="secondary" disabled={!page.canPrevious} onClick={page.goPrevious}>{translate(language, "previous")}</Button><span className="text-xs tabular-nums">{page.page}</span><Button type="button" size="sm" variant="secondary" disabled={!page.canNext} onClick={page.goNext}>{translate(language, "next")}</Button></div> : null}
  </div>;
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
  return optionLabel([formatRecruitmentId(row.candidate_id), formatCandidateName(row)]);
}

function documentGroupOptionLabel(row: DashboardData["document_groups"][number]) {
  return optionLabel([row.doc_group_id, row.group_position]);
}

function positionGroupOptionLabel(row: Pick<DashboardData["position_groups"][number], "group_id" | "group_position">) {
  return optionLabel([formatRecruitmentId(row.group_id), row.group_position]);
}

function offerOptionLabel(data: DashboardData, offer: DashboardData["offers"][number]) {
  const candidate = data.candidates.find((row) => row.candidate_id === offer.candidate_id);
  return optionLabel([formatRecruitmentId(offer.candidate_id), candidate?.name, offer.doc_id]);
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
  client,
  accessScope,
  lookupScope,
  language,
  profile,
  ownerProfiles,
  ownerOptionsLoading,
  ownerOptionsError,
  onRetryOwnerOptions,
  mode,
  selectedId,
  selected,
  onSelect,
  onSelectRow
}: {
  data: DashboardData;
  client: SupabaseClient | null;
  accessScope: string;
  lookupScope: Record<string, unknown>;
  language: Language;
  profile: DashboardData["profile"];
  ownerProfiles: Profile[];
  ownerOptionsLoading: boolean;
  ownerOptionsError: string | null;
  onRetryOwnerOptions: () => void;
  mode: "new" | "change";
  selectedId: string;
  selected: EnrichedRequisition | null;
  onSelect: (value: string) => void;
  onSelectRow: (row: EnrichedRequisition | null) => void;
}) {
  const isSiteRecruiter = profile?.role === "site_recruiter";
  const forceAssignedScope = isSiteRecruiter && mode === "new";
  const nickname = profile?.nickname ?? profile?.full_name ?? "";
  const assignedSite = profile?.site ?? "";
  const personOptions = [...new Set([...recruiterNicknameOptions(ownerProfiles), ...(selected?.person_in_charge ? [selected.person_in_charge] : [])])].sort((left,right)=>left.localeCompare(right));
  const siteValue = forceAssignedScope ? assignedSite : selected?.site;
  const ownerValue = forceAssignedScope ? nickname : selected?.person_in_charge;
  const initialSiteValue = siteValue ?? "";
  const [docId, setDocId] = useState(selected?.doc_id ?? "");
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
    setDocId(selected?.doc_id ?? "");
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
      {mode === "change" ? (
        <>
          <AuthorizedRequisitionLookup client={client} accessScope={accessScope} language={language} filters={{ ...lookupScope, managedOnly: true }} value={selectedId} selectedRow={selected} onSelect={onSelectRow} label={translate(language, "selectRequisitionOption")} name="selected_doc_id" />
          <Field label={translate(language, "docId")}>
          <TextInput name="doc_id" required value={docId} disabled={!selected} onChange={(event) => setDocId(event.target.value)} />
          {selected ? <input type="hidden" name="previous_doc_id" value={selected.doc_id} /> : null}
          <p className="mt-1 text-xs font-normal text-slate-600">{translate(language, "requisitionDocIdEditHint")}</p>
          </Field>
        </>
      ) : <Field label={translate(language, "docId")}><TextInput name="doc_id" list="doc-id-options" required placeholder={translate(language, "requisitionDocIdPlaceholder")} /></Field>}
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
          {selected?.level && !/^(0|[1-9]|1[0-4])$/.test(selected.level) ? <option value={selected.level}>{selected.level}</option> : null}
          {Array.from({ length: 15 }, (_, level) => <option key={level} value={String(level)}>{`L${level}`}</option>)}
        </CreateSelectInput>
      </Field>
      <Field label={translate(language, "headCount")}><TextInput name="head_count" type="number" min={1} value={headCount} onChange={(event) => changeHeadCount(event.target.value)} required /></Field>
      <Field label={translate(language, "personInCharge")}>
        {forceAssignedScope ? <input type="hidden" name="person_in_charge" value={nickname} /> : null}
        <CreateSelectInput name={forceAssignedScope ? undefined : "person_in_charge"} defaultValue={ownerValue ?? ""} disabled={isSiteRecruiter || ownerOptionsLoading || Boolean(ownerOptionsError) || ownerProfiles.length === 0}>
          <option value="">{translate(language, "unassigned")}</option>
          {personOptions.map((person) => <option key={person} value={person}>{person}</option>)}
        </CreateSelectInput>
        {!isSiteRecruiter && ownerOptionsLoading ? <LoadingSkeleton variant="lookup" label={<>{translate(language, "loading")}</>} className="text-xs text-slate" /> : null}
        {!isSiteRecruiter && ownerOptionsError ? <p className="text-xs text-scarlet" role="alert">Could not load recruiter options. <RetryIconButton type="button" className="font-semibold underline" onClick={onRetryOwnerOptions}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</RetryIconButton></p> : null}
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
    </div>
  );
}

function StatusFields({
  client,
  accessScope,
  lookupScope,
  language,
  selectedId,
  selected,
  onSelect
}: {
  client: SupabaseClient | null;
  accessScope: string;
  lookupScope: Record<string, unknown>;
  language: Language;
  selectedId: string;
  selected: EnrichedRequisition | null;
  onSelect: (row: EnrichedRequisition | null) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <AuthorizedRequisitionLookup client={client} accessScope={accessScope} language={language} filters={{ ...lookupScope, managedOnly: true }} value={selectedId} selectedRow={selected} onSelect={onSelect} label={translate(language, "docId")} name="doc_id" />
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

function isRepeatableStage(stage: ProcessStage | null | undefined): stage is "Line Interview" | "Test" {
  return stage === "Line Interview" || stage === "Test";
}

function nextPipelineStage(stage: ProcessStage) {
  return ACTIVE_PIPELINE_STAGES[ACTIVE_PIPELINE_STAGES.indexOf(stage) + 1];
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
  const logs = candidate ? applicationLogs(data, candidate) : [];
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
  return eligibleApplicationGroups(data).filter(group=>!limitIds||limitIds.includes(group.group_id));
}

function useApplicationDestinationOptions(client: SupabaseClient | null, accessScope: string, enabled: boolean) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ApplicationDestination[]>([]);
  const [nextGroupId, setNextGroupId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !client || !accessScope) { setItems([]); setNextGroupId(null); setHasMore(false); setLoading(false); return; }
    let cancelled = false;
    setItems([]); setNextGroupId(null); setHasMore(false); setLoading(true); setError(false);
    const timer = setTimeout(() => {
      fetchApplicationDestinations(client, { search, limit: 50 })
        .then(page => { if (!cancelled) { setItems(page.items); setNextGroupId(page.next_cursor?.group_id ?? null); setHasMore(page.has_more); } })
        .catch(() => { if (!cancelled) { setItems([]); setError(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accessScope, client, enabled, retry, search]);
  async function loadMore() {
    if (!client || !enabled || !hasMore || !nextGroupId || loading) return;
    setLoading(true); setError(false);
    try { const page = await fetchApplicationDestinations(client, { search, afterGroupId: nextGroupId, limit: 50 }); setItems(current => [...current, ...page.items.filter(row => !current.some(item => item.group_id === row.group_id))]); setNextGroupId(page.next_cursor?.group_id ?? null); setHasMore(page.has_more); }
    catch { setError(true); }
    finally { setLoading(false); }
  }
  return { search, setSearch, items, hasMore, loading, error, retry: () => setRetry(value => value + 1), loadMore };
}

function DestinationControls({ language, name, label, emptyLabel, value, onChange, options, locked = false }: { language: Language; name?: string; label: string; emptyLabel: string; value: string; onChange: (value: string) => void; options: ReturnType<typeof useApplicationDestinationOptions>; locked?: boolean }) {
  const rows = options.items.some(row => row.group_id === value) || !value ? options.items : [{ group_id: value, group_position: value, sites: [], owners: [], doc_ids: [] }, ...options.items];
  return <div className="grid gap-2">{!locked ? <TextInput aria-label={language === "th" ? `ค้นหา${label}` : `Search ${label}`} value={options.search} onChange={event => options.setSearch(event.target.value)} placeholder={language === "th" ? "ค้นหารหัสหรือชื่อตำแหน่ง" : "Search ID or position"} /> : null}<SelectInput aria-label={locked ? (language === "th" ? "กลุ่มใบสมัครที่เลือก" : "Locked application group") : undefined} name={locked ? undefined : name} disabled={locked} value={value} onChange={event => onChange(event.target.value)}>{locked ? null : <option value="">{emptyLabel}</option>}{(locked ? rows.filter(row => row.group_id === value) : rows).map(row => <option key={row.group_id} value={row.group_id}>{formatRecruitmentId(row.group_id)} · {row.group_position}</option>)}</SelectInput>{!locked && options.loading ? <LoadingSkeleton variant="lookup" label={<>{translate(language,"loading")}</>} className="text-xs text-slate" /> : null}{!locked && options.error ? <p role="alert" className="flex items-center gap-2 text-xs text-danger">{translate(language,"loadFailed")} <RetryIconButton type="button"   onClick={options.retry} loading={options.loading}>{translate(language,"retry")}</RetryIconButton></p> : null}{!locked && options.hasMore ? <Button type="button" variant="secondary" size="sm" disabled={options.loading} onClick={options.loadMore}>{language === "th" ? "โหลดตัวเลือกเพิ่ม" : "Load more options"}</Button> : null}</div>;
}

function CandidatePrefillFields({
  data,
  language,
  profile,
  mode,
  selectedId,
  selected,
  defaults,
  onSelect,
  client,
  accessScope
}: {
  data: DashboardData;
  language: Language;
  profile: DashboardData["profile"];
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["candidates"][number] | null;
  defaults: ModalDefaults;
  onSelect: (value: string) => void;
  client: SupabaseClient | null;
  accessScope: string;
}) {
  const groupValue = mode === "new" ? defaults.group_id ?? "" : "";
  const groupLocked = mode === "new" && Boolean(defaults.lock_group_id);
  const firstContactDate = mode === "new" ? defaults.first_contact_date ?? "" : selected?.first_contact_date ?? "";
  const [selectedGroupId, setSelectedGroupId] = useState(groupValue);
  const [existingCandidateId, setExistingCandidateId] = useState("");
  const [authorizedExistingCandidateId, setAuthorizedExistingCandidateId] = useState("");
  const [existingCandidateSearch, setExistingCandidateSearch] = useState("");
  const [existingCandidateAccess, setExistingCandidateAccess] = useState<"idle"|"loading"|"denied"|"error">("idle");
  const [contactPhone, setContactPhone] = useState(selected?.phone_no ?? "");
  const [contactEmail, setContactEmail] = useState(selected?.email ?? "");
  const [selectedChannel, setSelectedChannel] = useState(selected?.channel ?? "");
  const [referenceRows, setReferenceRows] = useState<number[]>([]);
  const [referenceChannelTypes, setReferenceChannelTypes] = useState<Record<number, string>>({});
  const destinationOptions = useApplicationDestinationOptions(client, accessScope, !groupLocked);
  const existingCandidates = useRecruitmentList<{candidate_id:string;name:string|null;nickname:string|null;home_site:string|null}>({client,accessScope,entity:"candidate_registry",filters:{scope:"all"},sort:"updated_at",direction:"desc",initialPageSize:50,enabled:mode==="new"&&Boolean(client&&accessScope),searchInput:{value:existingCandidateSearch,setValue:setExistingCandidateSearch}});
  const [selectedGroupProjection,setSelectedGroupProjection]=useState<{id:string;row:DashboardData["position_groups"][number]|null;loading:boolean;error:boolean}>({id:"",row:null,loading:false,error:false});
  useEffect(()=>{
    if(!selectedGroupId||!client||!accessScope){setSelectedGroupProjection({id:selectedGroupId,row:null,loading:false,error:false});return;}
    const bootstrap=data.position_groups.find(row=>row.group_id===selectedGroupId);
    if(bootstrap){setSelectedGroupProjection({id:selectedGroupId,row:bootstrap,loading:false,error:false});return;}
    let cancelled=false;setSelectedGroupProjection({id:selectedGroupId,row:null,loading:true,error:false});
    Promise.resolve(client.from("position_groups").select("*").eq("group_id",selectedGroupId).maybeSingle()).then(({data:row,error})=>{
      if(!cancelled)setSelectedGroupProjection({id:selectedGroupId,row:error||!row?null:row as DashboardData["position_groups"][number],loading:false,error:Boolean(error||!row)});
    }).catch(()=>{if(!cancelled)setSelectedGroupProjection({id:selectedGroupId,row:null,loading:false,error:true});});
    return()=>{cancelled=true;};
  },[accessScope,client,data.position_groups,selectedGroupId]);
  const projectedGroup=selectedGroupProjection.id===selectedGroupId?selectedGroupProjection.row:null;
  const availableChannels = useMemo(() => selectedGroupId ? (projectedGroup ? SOURCING_CHANNELS.filter(channel=>Boolean(projectedGroup[channel.enabled])) : []) : SOURCING_CHANNELS, [projectedGroup, selectedGroupId]);
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

  useEffect(() => {
    if (!existingCandidateId || !client || !accessScope || mode !== "new") { setAuthorizedExistingCandidateId(""); setExistingCandidateAccess("idle"); return; }
    let cancelled=false;setAuthorizedExistingCandidateId("");setExistingCandidateAccess("loading");
    Promise.resolve(client.rpc("app_candidate_profile_detail_v1",{p_candidate_id:existingCandidateId})).then(({data:projection,error})=>{
      if(cancelled)return;
      if(error){setExistingCandidateAccess("error");return;}
      const capabilities=(projection as {capabilities?:{can_add_application?:unknown}|null}|null)?.capabilities;
      if(capabilities?.can_add_application===true){setAuthorizedExistingCandidateId(existingCandidateId);setExistingCandidateAccess("idle");}
      else{setExistingCandidateId("");setExistingCandidateAccess("denied");}
    }).catch(()=>{if(!cancelled)setExistingCandidateAccess("error");});
    return()=>{cancelled=true;};
  },[accessScope,client,existingCandidateId,mode]);

  const existingPicker = mode === "new" ? <Field label={language === "th" ? "ใช้ข้อมูลผู้สมัครเดิม" : "Use existing candidate"}><TextInput aria-label={language==="th"?"ค้นหาผู้สมัครเดิม":"Search existing candidates"} value={existingCandidateSearch} onChange={event=>setExistingCandidateSearch(event.target.value)} placeholder={language==="th"?"ค้นหารหัสหรือชื่อ":"Search ID or name"}/><SelectInput name="existing_candidate_id" value={existingCandidateId} onChange={event => {setExistingCandidateId(event.target.value);setAuthorizedExistingCandidateId("");setExistingCandidateAccess("idle");}}><option value="">{language === "th" ? "สร้างข้อมูลผู้สมัครใหม่" : "Create a new profile"}</option>{existingCandidates.items.map(row => <option key={row.candidate_id} value={row.candidate_id}>{`${formatRecruitmentId(row.candidate_id)} · ${[row.name,row.nickname].filter(Boolean).join(" ")}`}</option>)}</SelectInput>{existingCandidateAccess==="loading"?<LoadingSkeleton variant="lookup" label={<>{translate(language,"loading")}</>} className="text-xs text-slate" />:null}{existingCandidateAccess==="denied"?<p role="alert" className="text-xs text-danger">{language==="th"?"ไม่มีสิทธิ์เพิ่มใบสมัครให้ผู้สมัครรายนี้":"You cannot add an application for this candidate."}</p>:null}{existingCandidateAccess==="error"?<p role="alert" className="text-xs text-danger">{translate(language,"loadFailed")}</p>:null}{existingCandidates.error?<p role="alert" className="text-xs text-danger">{translate(language,"loadFailed")} <RetryIconButton type="button"   onClick={existingCandidates.retry} loading={existingCandidates.loading}>{translate(language,"retry")}</RetryIconButton></p>:null}{existingCandidates.canNext?<Button type="button" variant="secondary" size="sm" disabled={existingCandidates.loading} onClick={existingCandidates.goNext}>{language==="th"?"ถัดไป":"Next candidates"}</Button>:null}</Field> : null;
  if (authorizedExistingCandidateId) return <div className="grid gap-4">{existingPicker}<Field label={translate(language, "groupId")}><DestinationControls language={language} name="group_id" label={translate(language,"groupId")} emptyLabel={translate(language,"selectGroup")} value={groupLocked ? groupValue : selectedGroupId} onChange={setSelectedGroupId} options={destinationOptions} locked={groupLocked}/>{groupLocked ? <input type="hidden" name="group_id" value={groupValue}/> : null}{groupLocked ? <span className="text-xs font-medium text-slate">{translate(language, "groupLockedToWorkspace")}</span> : null}</Field><p className="text-sm text-slate">{language === "th" ? "เพิ่มใบสมัครใหม่โดยใช้ข้อมูลเดิม ไม่สร้างผู้สมัครซ้ำ" : "Create an application using this profile; no duplicate person is created."}</p></div>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {existingPicker}
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
      <div className="grid gap-4 md:col-span-2 md:grid-cols-2"><Field label={translate(language, "name")}><TextInput name="name" required placeholder={translate(language, "candidateNamePlaceholder")} defaultValue={selected?.name ?? ""} /></Field><Field label={translate(language, "nickname")}><TextInput name="nickname" defaultValue={selected?.nickname ?? ""} /></Field></div>
      <Field label={language === "th" ? "ตำแหน่งที่สนใจ" : "Position interests"}><TextInput name="position_interests" defaultValue={selected?.position_interests ?? ""}/></Field>
      {mode==="new"||selected&&profileCapabilities(data,selected.candidate_id).can_edit_note?<Field label={language === "th" ? "บันทึก" : "Profile note"}><textarea name="note" defaultValue={data.candidate_notes?.find(row=>row.candidate_id===selected?.candidate_id)?.body??""} className="min-h-24 rounded-md border border-[#C9D5E6] p-2 text-sm text-navy"/><input type="hidden" name="expected_note_id" value={data.candidate_notes?.find(row=>row.candidate_id===selected?.candidate_id)?.note_id??""}/><input type="hidden" name="expected_note_version" value={data.candidate_notes?.find(row=>row.candidate_id===selected?.candidate_id)?.version??""}/></Field>:null}

      <Field label={translate(language, "phoneNo")}><TextInput name="phone_no" type="tel" inputMode="numeric" maxLength={10} pattern="0[0-9]{9}" required={mode === "change"} placeholder={translate(language, "candidatePhonePlaceholder")} value={contactPhone} onChange={event => setContactPhone(event.target.value)} /></Field>
      <Field label={translate(language, "email")}><TextInput name="email" type="text" inputMode="email" autoComplete="email" placeholder={translate(language, "candidateEmailPlaceholder")} value={contactEmail} onChange={event => setContactEmail(event.target.value)} /></Field>
      <Field label={language === "th" ? "กลุ่มใบสมัคร (ไม่บังคับ)" : "Application group (optional)"}>
        <DestinationControls language={language} name={groupLocked ? undefined : "group_id"} label={language === "th"?"กลุ่มใบสมัคร":"Application group"} emptyLabel={language === "th" ? "เก็บในฐานผู้สมัคร (ยังไม่มีกลุ่ม)" : "Talent pool (no application yet)"} value={groupLocked ? groupValue : selectedGroupId} onChange={setSelectedGroupId} options={destinationOptions} locked={groupLocked}/>
        {groupLocked ? <input type="hidden" name="group_id" value={groupValue} /> : null}
        {mode === "new" && defaults.lock_group_id ? <span className="text-xs font-medium text-slate">{translate(language, "groupLockedToWorkspace")}</span> : null}
      </Field>
      <Field label={translate(language, "channel")}>
        <CreateSelectInput name="channel" required value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value)} disabled={availableChannels.length === 0}>
          <option value="">{availableChannels.length === 0 ? translate(language, "noSourcingChannelsForGroup") : translate(language, "selectChannel")}</option>
          {availableChannels.map((channel) => <option key={channel.enabled} value={channel.label}>{channel.label}</option>)}
        </CreateSelectInput>
        {selectedGroupId&&selectedGroupProjection.loading?<LoadingSkeleton variant="lookup" label={<>{translate(language,"loading")}</>} className="text-xs text-slate" />:null}
        {selectedGroupId&&selectedGroupProjection.error?<p role="alert" className="text-xs text-danger">{translate(language,"loadFailed")}</p>:null}
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

function StageOutcomeFields({ defaults, language, reasons }: { defaults: ProcessDefaults; language: Language; reasons: DashboardData["rejection_reasons"] }) {
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
      {!isPass ? <FailureReasonFields reasons={reasons} language={language} /> : null}
      <Field label={!isPass ? (language === "th" ? "หมายเหตุ (ไม่บังคับ)" : "Remark (optional)") : translate(language, "remark")} className="md:col-span-2"><TextArea name="outcome_remark" rows={3} placeholder={translate(language, "pipelineOutcomeRemarkPlaceholder", { stage: processLabel(defaults.recruitment_process as ProcessStage, language) })} /></Field>
      {hasNextPending ? <>
        <div className="border-t border-[#D7DEE8] pt-3 text-sm font-semibold text-navy md:col-span-2">{translate(language, "nextPendingStage")}: {processLabel(defaults.target_stage as ProcessStage, language)}</div>
        <input type="hidden" name="next_round" value={isRepeatableStage(defaults.recruitment_process as ProcessStage) && defaults.recruitment_process === defaults.target_stage ? (defaults.round ?? 1) + 1 : 1} />
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
  const repeatableStage = stages.length === 1 && isRepeatableStage(stages[0] as ProcessStage) ? stages[0] as ProcessStage : null;
  const isRepeatableStageExit = Boolean(repeatableStage && defaults.target_stage === nextPipelineStage(repeatableStage));
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
          <Field label={translate(language, "round")}><TextInput name={`round_${index}`} type="number" min={1} value={isRepeatableStageExit && stage === stages[0] ? currentRound : undefined} defaultValue={isRepeatableStageExit && stage === stages[0] ? undefined : 1} readOnly={isRepeatableStageExit && stage === stages[0]} required /></Field>
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
  const stage = defaults.recruitment_process as ProcessStage;

  return (
    <div className="grid gap-4">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-medium text-slate">
        {translate(language, "repeatableStageHint", { stage: processLabel(stage, language) })}
      </div>
      <div className="grid gap-4 rounded-md border border-[#D7DEE8] bg-white p-3 md:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Tag tone="teal">{translate(language, "currentRepeatableStage", { stage: processLabel(stage, language) })}</Tag>
          <Tag tone="muted">{translate(language, "round")} {currentRound}</Tag>
          <Tag tone="success">{resultText(1, language)}</Tag>
        </div>
        <Field label={translate(language, "date")}><TextInput name="current_log_date" type="date" defaultValue={today()} required /></Field>
        <Field label={translate(language, "round")}><TextInput name="current_round" type="number" min={1} value={currentRound} readOnly required /></Field>
        <Field label={translate(language, "interviewer")}><TextInput name="current_interviewer" list="interviewer-options" /></Field>
        <Field label={translate(language, "remark")}><TextArea name="current_remark" rows={2} defaultValue={translate(language, "currentRepeatableRoundPassedRemark", { stage: processLabel(stage, language) })} /></Field>
      </div>
      <div className="grid gap-4 rounded-md border border-[#D7DEE8] bg-lightgray/70 p-3 md:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Tag tone="teal">{translate(language, "nextRepeatableStage", { stage: processLabel(stage, language) })}</Tag>
          <Tag tone="muted">{translate(language, "round")} {nextRound}</Tag>
          <Tag tone="warning">{resultText(null, language)}</Tag>
        </div>
        <Field label={translate(language, "date")}><TextInput name="next_log_date" type="date" defaultValue={today()} required /></Field>
        <Field label={translate(language, "round")}><TextInput name="next_round" type="number" min={1} value={nextRound} readOnly required /></Field>
        <Field label={translate(language, "interviewer")}><TextInput name="next_interviewer" list="interviewer-options" /></Field>
        <Field label={translate(language, "remark")}><TextArea name="next_remark" rows={2} defaultValue={translate(language, "nextRepeatableRoundPendingRemark", { stage: processLabel(stage, language) })} /></Field>
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

function MatchFields({ client, accessScope, lookupScope, defaults, language }: { client: SupabaseClient | null; accessScope: string; lookupScope: Record<string, unknown>; defaults: ModalDefaults; language: Language }) {
  const [group, setGroup] = useState<EnrichedSourcingGroup | null>(null);
  const [groupId, setGroupId] = useState(defaults.group_id ?? "");
  const [requisition, setRequisition] = useState<EnrichedRequisition | null>(null);
  const [docId, setDocId] = useState(defaults.doc_id ?? "");
  const scopeKey = JSON.stringify([accessScope, lookupScope]);
  useEffect(() => { setGroup(null); setGroupId(defaults.group_id ?? ""); setRequisition(null); setDocId(defaults.doc_id ?? ""); }, [defaults.doc_id, defaults.group_id, scopeKey]);
  return <div className="grid gap-4 md:grid-cols-2">
    <AuthorizedRequisitionLookup client={client} accessScope={accessScope} language={language} filters={{ ...lookupScope, managedOnly: true, unmatchedOnly: true, ...(groupId ? { linkToGroupId: groupId } : {}) }} value={docId} selectedRow={requisition} onSelect={row => { setRequisition(row); setDocId(row?.doc_id ?? ""); }} label={translate(language, "docId")} name="doc_id" />
    <AuthorizedPositionGroupLookup client={client} accessScope={accessScope} scope={lookupScope} language={language} value={groupId} selectedRow={group} onSelect={row => { setGroup(row); setGroupId(row?.group_id ?? ""); setRequisition(null); setDocId(""); }} label={translate(language, "groupId")} name="group_id" />
  </div>;
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
    <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-medium text-slate">{language === "th" ? "ยืนยันการมาทำงานวันแรกของผู้สมัคร หากไม่ได้เริ่มงาน ระบบจะเปิดอัตราว่างและเริ่มนับ SLA ของคำขอใหม่ในวันนี้" : "Confirm the candidate’s first working-day attendance. Did not start will reopen headcount and restart the requisition SLA today."}</div>
    <Field label={language === "th" ? "ยืนยันการเริ่มงาน" : "Start confirmation"}><SelectInput name="start_confirmation" value={outcome} onChange={(event) => setOutcome(event.target.value as "started" | "did_not_start")}><option value="started">{language === "th" ? "เริ่มงานแล้ว" : "Started work"}</option><option value="did_not_start">{language === "th" ? "ไม่ได้เริ่มงาน" : "Did not start"}</option></SelectInput></Field>
    {outcome === "did_not_start" ? <Field label={language === "th" ? "เหตุผล" : "Reason"}><TextArea name="reason" required rows={3} placeholder={language === "th" ? "เหตุผลที่ผู้สมัครไม่ได้เริ่มงาน" : "Why did the candidate not start?"} /></Field> : null}
  </div>;
}

function OfferPrefillFields({
  data,
  defaults,
  language,
  mode,
  selectedId,
  selected,
  onSelect,
  client,
  accessScope
}: {
  data: DashboardData;
  defaults: ModalDefaults;
  language: Language;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["offers"][number] | null;
  onSelect: (value: string) => void;
  client: SupabaseClient | null;
  accessScope: string;
}) {
  const offeredCandidateIds = new Set(data.offers.map((offer) => offer.application_id ?? offer.candidate_id));
  const allowedCandidateIds = defaults.offer_candidate_ids ? new Set(defaults.offer_candidate_ids) : null;
  const eligibleCandidates = enrichCandidates(data).filter((candidate) => (
    canManageCandidateJourney(candidate,data.profile) && (!allowedCandidateIds || allowedCandidateIds.has(candidate.candidate_id))
    && applicationLogs(data, candidate).some(log => log.recruitment_process === "Offer" && log.result === 1)
    && !offeredCandidateIds.has(applicationKey(candidate))
  ));
  const selectedCandidate = selected ? enrichCandidates(data).find(candidate => candidate.application_id === selected.application_id) : null;
  const candidateOptions = selectedCandidate && !eligibleCandidates.some((candidate) => applicationKey(candidate) === applicationKey(selectedCandidate))
    ? [...eligibleCandidates, selectedCandidate]
    : eligibleCandidates;
  const [offerApplicationId, setOfferApplicationId] = useState(selected?.application_id ?? defaults.application_id ?? "");
  const [selectedCandidateId, setSelectedCandidateId] = useState(selected?.candidate_id ?? defaults.candidate_id ?? "");
  const [selectedDocId, setSelectedDocId] = useState(selected?.doc_id ?? defaults.doc_id ?? "");
  const allowedDocIds = defaults.offer_doc_ids ? new Set(defaults.offer_doc_ids) : null;
  const [search, setSearch] = useState(defaults.candidate_id ?? "");
  const [remoteCandidates, setRemoteCandidates] = useState<OfferCandidateOption[]>([]);
  const [selectedOfferCandidate, setSelectedOfferCandidate] = useState<OfferCandidateOption | null>(null);
  const [cursor, setCursor] = useState<OfferCandidateCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [remoteRequisitions, setRemoteRequisitions] = useState<DashboardData["requisitions"]>([]);
  const [loadingRequisitions, setLoadingRequisitions] = useState(false);
  const [requisitionError, setRequisitionError] = useState(false);
  const selectedRemote = remoteCandidates.find(row => row.application_id === offerApplicationId) ?? (selectedOfferCandidate?.application_id === offerApplicationId ? selectedOfferCandidate : null);
  const docIdsForSelection = selectedRemote?.doc_ids ?? [];
  const remoteDocIds = mode === "new" ? docIdsForSelection.filter(id => !allowedDocIds || allowedDocIds.has(id)) : [];
  const docOptions = mode === "change" && selected?.doc_id
    ? data.requisitions.filter((row) => row.doc_id === selected.doc_id)
    : mode === "new" ? remoteRequisitions.filter(row => remoteDocIds.includes(row.doc_id)) : availableOfferDocOptions(data, selectedCandidateId, selectedDocId, offerApplicationId).filter((row) => !allowedDocIds || allowedDocIds.has(row.doc_id));

  useEffect(() => {
    if (mode !== "new" || !client || !accessScope) return;
    let cancelled = false;
    setLoadingCandidates(true); setCandidateError(false); setRemoteCandidates([]); setCursor(null); setHasMore(false);
    const timer = setTimeout(() => {
      fetchOfferCandidates(client, { search, limit: 50 })
      .then(page => { if (!cancelled) { setRemoteCandidates(page.items); setCursor(page.next_cursor); setHasMore(page.has_more); const preselected=page.items.find(row=>row.application_id===(defaults.application_id??"")||row.candidate_id===(defaults.candidate_id??"")); if(preselected){setSelectedOfferCandidate(preselected);setOfferApplicationId(preselected.application_id);setSelectedCandidateId(preselected.candidate_id);if(defaults.doc_id&&preselected.doc_ids.includes(defaults.doc_id))setSelectedDocId(defaults.doc_id);} } })
        .catch(() => { if (!cancelled) setCandidateError(true); })
        .finally(() => { if (!cancelled) setLoadingCandidates(false); });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accessScope, client, defaults.application_id, defaults.candidate_id, mode, retry, search]);

  useEffect(() => {
    if (mode !== "new" || !client || !offerApplicationId || !docIdsForSelection.length) { setRemoteRequisitions([]); setLoadingRequisitions(false); return; }
    let cancelled = false;
    setLoadingRequisitions(true); setRequisitionError(false);
    readScopedInPages<DashboardData["requisitions"][number]>(client, "requisitions", "doc_id", docIdsForSelection, "doc_id", "eligible offer requisitions")
      .then(rows => { if (!cancelled) setRemoteRequisitions(rows); })
      .catch(() => { if (!cancelled) { setRemoteRequisitions([]); setRequisitionError(true); } })
      .finally(() => { if (!cancelled) setLoadingRequisitions(false); });
    return () => { cancelled = true; };
  }, [accessScope, client, docIdsForSelection.join("\u001f"), mode, offerApplicationId]);

  async function loadMoreCandidates() {
    if (!client || !cursor || !hasMore || loadingCandidates) return;
    setLoadingCandidates(true); setCandidateError(false);
    try { const page = await fetchOfferCandidates(client, { search, cursor, limit: 50 }); setRemoteCandidates(rows => [...rows, ...page.items.filter(item => !rows.some(row => row.application_id === item.application_id))]); setCursor(page.next_cursor); setHasMore(page.has_more); }
    catch { setCandidateError(true); }
    finally { setLoadingCandidates(false); }
  }

  useEffect(() => {
    setOfferApplicationId(selected?.application_id ?? defaults.application_id ?? "");
    setSelectedCandidateId(selected?.candidate_id ?? defaults.candidate_id ?? "");
    setSelectedDocId(selected?.doc_id ?? defaults.doc_id ?? "");
    setSelectedOfferCandidate(null);
  }, [defaults.application_id, defaults.candidate_id, defaults.doc_id, selected?.application_id, selected?.candidate_id, selected?.doc_id]);

  useEffect(() => {
    if (mode === "change") return;
    if (selectedRemote && selectedDocId && !docOptions.some((row) => row.doc_id === selectedDocId) && !remoteDocIds.includes(selectedDocId)) {
      setSelectedDocId("");
    }
  }, [docOptions, mode, remoteDocIds, selectedDocId, selectedRemote]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="application_id" value={offerApplicationId}/>
      {mode === "new" ? <input type="hidden" name="candidate_id" value={selectedCandidateId}/> : null}
      {mode === "change" ? (
        <Field label={translate(language, "existingOffer")}>
          <SelectInput name="offer_selector" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">{translate(language, "selectOfferOption")}</option>
            {data.offers.map((offer) => <option key={offer.offer_id} value={offer.offer_id}>{offerOptionLabel(data, offer)}</option>)}
          </SelectInput>
        </Field>
      ) : null}
      {mode === "change" ? <input type="hidden" name="candidate_id" value={selected?.candidate_id ?? ""} /> : null}
      {mode === "new" ? <Field label={translate(language, "candidate")}><TextInput aria-label={language === "th" ? "ค้นหาผู้สมัครที่ผ่าน Offer" : "Search Offer-pass candidates"} value={search} onChange={event => setSearch(event.target.value)} placeholder={language === "th" ? "ค้นหาด้วยรหัสหรือชื่อ" : "Search by ID or name"} /><div className="grid gap-2"><CreateSelectInput name={undefined} required value={offerApplicationId} onChange={event => { const chosen = remoteCandidates.find(row => row.application_id === event.target.value); setSelectedOfferCandidate(chosen ?? null); setOfferApplicationId(chosen?.application_id ?? ""); setSelectedCandidateId(chosen?.candidate_id ?? ""); setSelectedDocId(chosen && defaults.doc_id && chosen.doc_ids.includes(defaults.doc_id) ? defaults.doc_id : chosen?.doc_ids.length === 1 ? chosen.doc_ids[0] : ""); }}><option value="">{translate(language, "selectOfferPassCandidate")}</option>{selectedRemote && !remoteCandidates.some(row => row.application_id === selectedRemote.application_id) ? <option value={selectedRemote.application_id}>{`${formatRecruitmentId(selectedRemote.candidate_id)} · ${selectedRemote.name} · ${selectedRemote.group_position}`}</option> : null}{remoteCandidates.map(row => <option key={row.application_id} value={row.application_id}>{`${formatRecruitmentId(row.candidate_id)} · ${row.name} · ${row.group_position}`}</option>)}</CreateSelectInput>{loadingCandidates ? <LoadingSkeleton variant="lookup" label={<>{translate(language, "loading")}</>} className="text-xs text-slate" /> : null}{candidateError ? <p role="alert" className="text-xs text-danger">{translate(language, "loadFailed")} <RetryIconButton type="button"   onClick={() => setRetry(value => value + 1)}>{translate(language, "retry")}</RetryIconButton></p> : null}{hasMore ? <Button type="button" variant="secondary" size="sm" disabled={loadingCandidates} onClick={() => void loadMoreCandidates()}>{language === "th" ? "โหลดเพิ่ม" : "Load more"}</Button> : null}</div></Field> : null}
      {mode === "change" ? <Field label={translate(language, "candidate")}><p className="rounded-md border border-[#D7DEE8] bg-lightgray px-3 py-2 text-sm text-navy">{selectedCandidate ? `${formatRecruitmentId(selectedCandidate.candidate_id)} · ${formatCandidateName(selectedCandidate)}` : formatRecruitmentId(selected?.candidate_id)}</p></Field> : null}
      {mode === "change" ? <input type="hidden" name="doc_id" value={selected?.doc_id ?? ""} /> : null}
      <Field label={translate(language, "docId")}>
        <CreateSelectInput name={mode === "change" ? undefined : "doc_id"} required value={selectedDocId} disabled={mode === "change" || !selectedCandidateId} onChange={(event) => setSelectedDocId(event.target.value)}>
          <option value="">{selectedCandidateId ? translate(language, "selectRequisitionOption") : translate(language, "selectCandidateFirst")}</option>
          {mode === "new" ? remoteDocIds.map(docId => { const row=docOptions.find(option=>option.doc_id===docId); return <option key={docId} value={docId}>{row?requisitionOptionLabel(row):docId}</option>; }) : docOptions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}
        </CreateSelectInput>
        {mode === "new" && loadingRequisitions ? <LoadingSkeleton variant="lookup" label={<>{translate(language, "loading")}</>} className="text-xs text-slate" /> : null}{mode === "new" && requisitionError ? <p role="alert" className="text-xs text-danger">{translate(language, "loadFailed")}</p> : null}
      </Field>
      <Field label={translate(language, "acceptedDateField")}><TextInput name="accepted_date" type="date" defaultValue={selected?.accepted_date ?? defaults.accepted_date ?? ""} /></Field>
      <Field label={translate(language, "firstWorkingDate")}><TextInput name="first_working_date" type="date" defaultValue={selected?.first_working_date ?? ""} /></Field>
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="remark" rows={3} defaultValue={selected?.remark ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function availableOfferDocOptions(data: DashboardData, candidateId: string, currentDocId = "", applicationId?: string) {
  if (!candidateId) return [];
  const journey = selectedApplication(data, candidateId, applicationId);
  const candidate = enrichCandidates(data).find(row => row.candidate_id === candidateId && (journey ? row.application_id === journey.application_id : !data.candidate_applications));
  if (!candidate) return [];
  const candidateGroupId = candidate.group_id ?? data.document_groups.find((row) => row.doc_group_id === candidate.doc_group_id)?.group_id;
  if (!candidateGroupId) return [];
  const matchedDocIds = new Set(
    data.document_groups
      .filter((row) => row.group_id === candidateGroupId)
      .map((row) => row.doc_id)
  );
  const existingOfferDocIds = new Set(data.offers.filter((offer) => offer.candidate_id === candidateId && (!applicationId || offer.application_id === applicationId)).map((offer) => offer.doc_id));
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
  onSelect,
  client,
  accessScope
}: {
  data: DashboardData;
  language: Language;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["position_groups"][number] | null;
  defaults: ModalDefaults;
  onSelect: (value: string) => void;
  client: SupabaseClient | null;
  accessScope: string;
}) {
  const groupPositionValue = mode === "new" ? defaults.group_position ?? "" : selected?.group_position ?? "";
  const destinationOptions = useApplicationDestinationOptions(client, accessScope, true);

  return (
    <div className="grid gap-4">
      <Field label={translate(language, "groupId")}><DestinationControls language={language} name="group_id" label={translate(language,"groupId")} emptyLabel={mode === "change" ? translate(language,"selectGroup") : translate(language,"autoInNewMode")} value={selectedId} onChange={onSelect} options={destinationOptions}/></Field>
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
  profiles,
  profilesLoading,
  profilesError,
  onRetryProfiles,
  language,
  mode,
  selectedId,
  selected,
  onSelect
}: {
  canManageUsers: boolean;
  data: DashboardData;
  profiles: Profile[];
  profilesLoading: boolean;
  profilesError: string | null;
  onRetryProfiles: () => void;
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
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{userOptionLabel(profile, language)}</option>
          ))}
        </SelectInput>
      </Field> : null}
      {profilesLoading ? <LoadingSkeleton variant="lookup" label={<>{translate(language, "loading")}</>} className="text-sm text-slate" /> : null}
      {profilesError ? <p role="alert" className="text-sm text-danger">{translate(language, "recordUnavailableOrLoadFailed")} <RetryIconButton type="button"   onClick={onRetryProfiles}>{translate(language, "retry")}</RetryIconButton></p> : null}
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

function PipelineRecordCorrectionFields({ canEditPendingDate, defaults, language, reasons }: { canEditPendingDate: boolean; defaults: ProcessDefaults; language: Language; reasons: DashboardData["rejection_reasons"] }) {
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
      {defaults.outcome_result === "fail" ? <FailureReasonFields reasons={reasons} language={language} defaults={{ actor: defaults.failure_actor, main: defaults.failure_main_reason_id, detail: defaults.failure_detail_reason_id }} /> : null}
      <Field label={translate(language, "remark")} className="md:col-span-2"><TextArea name="outcome_remark" rows={3} defaultValue={defaults.outcome_remark ?? ""} /></Field>
    </> : null}
  </div>;
}

function CreateAndMatchGroupFields({ client, accessScope, lookupScope, profile, defaults, language, onLookupState }: { client: SupabaseClient | null; accessScope: string; lookupScope: Record<string, unknown>; profile: DashboardData["profile"]; defaults: ModalDefaults; language: Language; onLookupState: (state: "none" | "loading" | "ready" | "missing" | "error") => void }) {
  const [selectedRequisitions, setSelectedRequisitions] = useState<EnrichedRequisition[]>([]);
  const [pendingRequisition, setPendingRequisition] = useState<EnrichedRequisition | null>(null);
  const [pendingDocId, setPendingDocId] = useState(defaults.doc_id ?? "");
  const [groupPosition, setGroupPosition] = useState(String(defaults.group_position ?? ""));
  const [preselectedState, setPreselectedState] = useState<{ id: string; scope: string; client: SupabaseClient | null; status: "loading" | "ready" | "missing" | "error"; row: EnrichedRequisition | null; error?: string } | null>(null);
  const [preselectedRetry, setPreselectedRetry] = useState(0);
  const seededPositionFor = useRef<{ key: string; client: SupabaseClient | null } | null>(null);
  const eligibilityScopeKey = JSON.stringify([accessScope, lookupScope]);
  useEffect(() => {
    setSelectedRequisitions([]);
    setPendingRequisition(null);
    setPendingDocId(defaults.doc_id ?? "");
    setGroupPosition(String(defaults.group_position ?? ""));
    seededPositionFor.current = null;
  }, [accessScope, defaults.doc_id, defaults.group_position, eligibilityScopeKey]);
  useEffect(() => {
    if (!defaults.doc_id) { setPreselectedState(null); return; }
    if (!client || !profile) { setPreselectedState({ id: defaults.doc_id, scope: eligibilityScopeKey, client, status: "error", row: null, error: "Database connection is unavailable." }); return; }
    let active = true;
    setPreselectedState({ id: defaults.doc_id, scope: eligibilityScopeKey, client, status: "loading", row: null });
    void (async () => {
      try {
        const result = await loadScopedRequisitionDetail(client, { docId: defaults.doc_id!, accessScope: { profileId: profile.id, key: eligibilityScopeKey } });
        if (!active) return;
        if (result.status !== "ready") { setPreselectedState({ id: defaults.doc_id!, scope: eligibilityScopeKey, client, status: "missing", row: null }); return; }
        const raw = result.requisition;
        const exactSite = typeof lookupScope.headerSite === "string" ? lookupScope.headerSite : "";
        const exactOwner = typeof lookupScope.headerPic === "string" ? lookupScope.headerPic.trim().toLocaleLowerCase() : "";
        const eligible = raw.doc_id === defaults.doc_id && raw.status === "ongoing" && result.metrics.openHeadcount > 0
          && result.documentGroups.length === 0 && canManageRequisitionPriority(profile, raw)
          && (!exactSite || raw.site === exactSite)
          && (!exactOwner || String(raw.person_in_charge ?? "").trim().toLocaleLowerCase() === exactOwner)
          && (lookupScope.priorityOnly !== true || raw.is_priority);
        if (!eligible) { setPreselectedState({ id: defaults.doc_id!, scope: eligibilityScopeKey, client, status: "missing", row: null }); return; }
        const row = enrichRequisitions({ ...emptyDashboardData, requisitions: [raw] })[0] ?? null;
        if (!row) { setPreselectedState({ id: defaults.doc_id!, scope: eligibilityScopeKey, client, status: "missing", row: null }); return; }
        setPreselectedState({ id: defaults.doc_id!, scope: eligibilityScopeKey, client, status: "ready", row });
      } catch (error) {
        if (active) setPreselectedState({ id: defaults.doc_id!, scope: eligibilityScopeKey, client, status: "error", row: null, error: error instanceof Error ? error.message : "Could not load the selected requisition." });
      }
    })();
    return () => { active = false; };
  }, [accessScope, client, defaults.doc_id, eligibilityScopeKey, lookupScope, preselectedRetry, profile]);
  useEffect(() => {
    onLookupState(preselectedState && preselectedState.id === defaults.doc_id && preselectedState.scope === eligibilityScopeKey && preselectedState.client === client ? preselectedState.status : defaults.doc_id ? "loading" : "none");
  }, [client, defaults.doc_id, eligibilityScopeKey, onLookupState, preselectedState]);
  useEffect(() => {
    const row = preselectedState?.scope === eligibilityScopeKey && preselectedState.client === client && preselectedState.status === "ready" ? preselectedState.row : null;
    const seedKey = JSON.stringify([eligibilityScopeKey, defaults.doc_id]);
    if (!row || row.doc_id !== defaults.doc_id || seededPositionFor.current?.key === seedKey && seededPositionFor.current.client === client) return;
    seededPositionFor.current = { key: seedKey, client };
    setSelectedRequisitions(current => current.some(item => item.doc_id === row.doc_id) ? current : [row]);
    setPendingDocId("");
    setPendingRequisition(null);
    setGroupPosition(current => current || row.position);
  }, [client, defaults.doc_id, eligibilityScopeKey, preselectedState]);
  const scopeKey = JSON.stringify([accessScope, lookupScope]);
  useEffect(() => { setSelectedRequisitions([]); setPendingRequisition(null); setPendingDocId(""); }, [scopeKey]);
  const selectedSite = selectedRequisitions[0]?.site;
  const addRequisition = () => {
    if (!pendingRequisition || pendingRequisition.doc_id !== pendingDocId || selectedRequisitions.some(row => row.doc_id === pendingDocId)) return;
    setSelectedRequisitions(rows => [...rows, pendingRequisition]);
    setPendingRequisition(null);
    setPendingDocId("");
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={translate(language, "groupId")}><TextInput value={translate(language, "autoInNewMode")} readOnly /></Field>
      {defaults.doc_id && preselectedState && preselectedState.scope === eligibilityScopeKey && preselectedState.client === client && preselectedState.status === "loading" ? <LoadingSkeleton variant="lookup" label={<>{translate(language, "loading")}</>} className="text-sm text-slate md:col-span-2" /> : null}
      {defaults.doc_id && preselectedState && preselectedState.scope === eligibilityScopeKey && preselectedState.client === client && (preselectedState.status === "error" || preselectedState.status === "missing") ? <div role="alert" className="flex items-center gap-2 text-sm text-danger md:col-span-2"><span>{preselectedState.error ?? translate(language, "recordUnavailable")}</span><RetryIconButton type="button"  onClick={() => setPreselectedRetry(value => value + 1)}>{translate(language, "retry")}</RetryIconButton></div> : null}
      <Field label={translate(language, "groupPosition")}><TextInput name="group_position" list="group-position-options" required value={groupPosition} onChange={event => setGroupPosition(event.target.value)} /></Field>
      <div className="grid gap-2 rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-navy md:col-span-2 md:grid-cols-4">
        {SOURCING_CHANNELS.map((channel) => <label key={channel.enabled} className="flex items-center gap-2"><input name={channel.enabled} type="checkbox" /> {channel.label}</label>)}
      </div>
      <section className="grid gap-3 rounded-md border border-[#C9D5E6] bg-[#F8FAFD] p-3 md:col-span-2">
        <div><h3 className="font-semibold text-navy">{translate(language, "linkRequisitions")}</h3><p className="mt-1 text-sm text-slate">{translate(language, "groupRequisitionSiteHint")}</p></div>
        <div className="flex flex-wrap items-end gap-2"><div className="min-w-[16rem] flex-1"><AuthorizedRequisitionLookup client={client} accessScope={accessScope} language={language} filters={{ ...lookupScope, ...(selectedSite ? { headerSite: selectedSite } : {}), status: "ongoing", homeTab: "open_headcount", managedOnly: true, unmatchedOnly: true }} value={pendingDocId} selectedRow={pendingRequisition} onSelect={row => { setPendingRequisition(row); setPendingDocId(row?.doc_id ?? ""); }} label={translate(language, "docId")} name="pending_doc_id" /></div><Button type="button" size="icon-sm" variant="secondary" icon={<Plus size={17} />} aria-label={translate(language, "addRequisition")} title={translate(language, "addRequisition")} onClick={addRequisition} disabled={!pendingDocId || !pendingRequisition || selectedRequisitions.some(row => row.doc_id === pendingDocId)} /></div>
        <div className="grid gap-2">{selectedRequisitions.map((row) => <div key={row.doc_id} className="flex min-w-0 items-center gap-2 rounded border border-[#D7DEE8] bg-white px-3 py-2"><input type="hidden" name="doc_ids" value={row.doc_id} /><p className="min-w-0 flex-1 truncate text-sm font-semibold text-navy" title={`${row.doc_id} · ${row.position} · ${row.site} · ${row.person_in_charge ?? translate(language, "unassigned")}`}>{row.doc_id} · {row.position} · {row.site} · {row.person_in_charge ?? translate(language, "unassigned")}</p><Button type="button" size="icon-sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" icon={<X size={16} />} onClick={() => setSelectedRequisitions(rows => rows.filter(item => item.doc_id !== row.doc_id))} aria-label={translate(language, "removeRequisition", { docId: row.doc_id })} /></div>)}</div>
        {selectedRequisitions.length === 0 ? <p className="text-sm font-medium text-danger">{translate(language, "selectAtLeastOneRequisition")}</p> : null}
      </section>
    </div>
  );
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
  reasons,
  action,
  busy,
  onClose,
  onConfirm
}: {
  language: Language;
  reasons: DashboardData["rejection_reasons"];
  action: PendingAction | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const outcome = (action?.payload.outcome ?? null) as { result?: string; date?: string | null; interviewer?: string | null; remark?: string | null; failure_actor?: "candidate" | "company"; failure_main_reason_id?: string; failure_detail_reason_id?: string } | null;
  const failure = action?.modal === "stage_outcome" && outcome?.result === "fail";
  const main = reasons.find((reason) => reason.reason_id === outcome?.failure_main_reason_id);
  const detail = reasons.find((reason) => reason.reason_id === outcome?.failure_detail_reason_id);
  return (
    <Modal open={Boolean(action)} title={action?.title ?? "Confirm Save"} closeDisabled={busy} onClose={() => { if (!busy) onClose(); }} width="max-w-lg">
      <div className="grid gap-4">
        <p className="text-sm font-bold text-slate">{action?.summary}</p>
        {failure ? <dl className="grid gap-2 rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm text-navy"><div><dt className="font-semibold">{translate(language, "outcomeDate")}</dt><dd>{formatDate(outcome?.date, language)}</dd></div><div><dt className="font-semibold">{translate(language, "interviewer")}</dt><dd>{outcome?.interviewer || "—"}</dd></div><div><dt className="font-semibold">{language === "th" ? "ผู้สิ้นสุดกระบวนการ" : "Who ended the process"}</dt><dd>{outcome?.failure_actor ? failureActorLabel(outcome.failure_actor, language) : "—"}</dd></div><div><dt className="font-semibold">{language === "th" ? "เหตุผลหลัก" : "Main reason"}</dt><dd>{main ? language === "th" ? main.label_th : main.label_en : "—"}</dd></div><div><dt className="font-semibold">{language === "th" ? "เหตุผลโดยละเอียด" : "Detailed reason"}</dt><dd>{detail ? language === "th" ? detail.label_th : detail.label_en : "—"}</dd></div><div><dt className="font-semibold">{language === "th" ? "หมายเหตุ" : "Remark"}</dt><dd>{outcome?.remark || "—"}</dd></div></dl> : <pre className="max-h-72 overflow-auto rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-xs text-navy">{JSON.stringify(action?.payload ?? {}, null, 2)}</pre>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>{translate(language, "cancel")}</Button>
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
  headerContent?: ReactNode;
  headerActions?: ReactNode;
  body: ReactNode;
};

function formatBangkokMeetingDateTime(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function CurrentStageEditModal({ candidate, stage, meeting, templates, profiles, language, recruiterName, busy, onClose, onSaveEstimate, onSaveTeams }: { candidate: EnrichedCandidate | null; stage: RecruitmentLog | null; meeting: InterviewMeeting | null; templates: InterviewInvitationTemplate[]; profiles: Profile[]; language: Language; recruiterName: string; busy: boolean; onClose: () => void; onSaveEstimate: (payload: Record<string, unknown>) => Promise<void>; onSaveTeams: (payload: Record<string, unknown>) => Promise<void> }) {
  const teamsAvailable = stage?.recruitment_process === "HR Interview" || stage?.recruitment_process === "Line Interview";
  const [mode, setMode] = useState<"estimate" | "teams">("estimate");
  const [estimate, setEstimate] = useState(""), [interviewer, setInterviewer] = useState(""), [remark, setRemark] = useState(""), [error, setError] = useState<string | null>(null);
  useEffect(() => { setMode("estimate"); setEstimate(stage?.estimated_action_date ?? ""); setInterviewer(stage?.interviewer ?? ""); setRemark(stage?.remark ?? ""); setError(null); }, [stage?.estimated_action_date, stage?.interviewer, stage?.remark, stage?.stage_instance_id]);
  async function saveEstimate() { if (!candidate || !stage?.stage_instance_id || !stage.updated_at) return; try { setError(null); await onSaveEstimate({ candidate_id: candidate.candidate_id, application_id: candidate.application_id, stage_instance_id: stage.stage_instance_id, expected_updated_at: stage.updated_at, pending: { opened_date: stage.log_date, estimated_action_date: estimate || null, interviewer: interviewer.trim() || null, remark: remark.trim() || null } }); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not update the estimated date."); } }
  return <Modal open={Boolean(candidate && stage)} title="Edit current stage" onClose={onClose} width="max-w-4xl"><div className="grid gap-4"><div className="inline-flex w-full rounded-lg border border-[#D7DEE8] bg-[#F8FAFD] p-1 sm:w-auto"><button type="button" className={`min-h-10 flex-1 rounded-md px-3 text-sm font-semibold transition ${mode === "estimate" ? "bg-white text-navy shadow-sm" : "text-slate"}`} onClick={() => setMode("estimate")}>Estimated action date</button>{teamsAvailable ? <button type="button" className={`min-h-10 flex-1 rounded-md px-3 text-sm font-semibold transition ${mode === "teams" ? "bg-white text-primary shadow-sm" : "text-slate"}`} onClick={() => setMode("teams")}>Teams meeting</button> : null}</div>{mode === "estimate" ? <div className="grid gap-4"><p className="text-sm text-slate">Update the pending-stage estimate without scheduling a meeting.</p><div className="grid gap-4 md:grid-cols-2"><Field label={translate(language, "estimatedActionDate")}><TextInput type="date" value={estimate} onChange={(event) => setEstimate(event.target.value)} /></Field><Field label={translate(language, "interviewer")}><TextInput value={interviewer} onChange={(event) => setInterviewer(event.target.value)} /></Field></div><Field label={translate(language, "remark")}><TextArea rows={3} value={remark} onChange={(event) => setRemark(event.target.value)} /></Field>{error ? <p role="alert" className="text-sm font-semibold text-scarlet">{error}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="button" disabled={busy} onClick={saveEstimate}>{busy ? "Saving..." : "Save estimated date"}</Button></div></div> : <TeamsInterviewComposer embedded candidate={candidate} stage={stage} meeting={meeting?.stage_instance_id === stage?.stage_instance_id ? meeting : null} templates={templates} profiles={profiles} language={language} recruiterName={recruiterName} busy={busy} onClose={onClose} onSave={onSaveTeams} />}</div></Modal>;
}

function buildDetailBodyV2(
  detail: { type: "requisition" | "candidate"; id: string } | null,
  data: DashboardData,
  language: Language,
  canWrite: boolean,
  canDeleteRecords: boolean,
  onUpdateCandidate: (candidateId: string) => void,
  onEditPending: (candidate: EnrichedCandidate, stage: ProcessStage) => void,
  onEditOffer: (offer: Offer) => void,
  onConfirmOfferStart: (offer: Offer, attendance?: "started" | "did_not_start") => void,
  navigationContext: { language: Language; site: string; owner: string; sourcingWeek: string },
  onChangeRequisition: (docId: string) => void,
  onChangeCandidate: (candidateId: string) => void,
  onEditReference: (candidateId: string, referenceId?: string) => void,
  onSetReferenceStatus: (candidateId: string, referenceId: string) => void,
  onSaveReferenceCheck: (candidateId: string, referenceId: string) => void,
  onDeleteRecord: (endpoint: string, payload: Record<string, unknown>, summary: string) => void,
  onCreateRejectionLetter: (candidate: EnrichedCandidate, retryDraftId?: string) => void,
  onTogglePriority: (requisition: Requisition) => Promise<void>
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
    const readiness = requisitionSourcingLinkReadiness(requisition);
    const readinessReason = sourcingLinkReadinessReason(language, readiness.groupIds);
    const sla = getRequisitionSlaState(requisition, { openOnly: true });
    const fillPercent = requisition.head_count > 0 ? Math.min(100, requisition.accepted_count / requisition.head_count * 100) : 0;
    const history = data.requisition_logs.filter(row => row.doc_id === requisition.doc_id).sort((a, b) => b.log_date.localeCompare(a.log_date) || b.log_id - a.log_id);
    const issues = deriveDataQualityIssues(data).filter((issue) =>
      issue.entityId === requisition.doc_id
      || candidates.some((candidate) => candidate.candidate_id === issue.entityId)
      || offers.some((offer) => String(offer.offer_id) === issue.entityId)
    );

    return {
      title: formatRequisitionTitle(requisition),
      headerContent: <RequisitionDetailHeader requisition={requisition} language={language} readiness={readiness} />,
      headerActions: (
        <div className="flex items-center gap-1">
        <RecordActionGroup
          label={formatRequisitionOptionLabel(requisition)}
          flat
          uniformUtilities
          primary={{ id: "workspace", label: translate(language, "workspaceOpen"), href: href(positionGroupIds.size === 1 ? `/workspace?type=group&id=${encodeURIComponent([...positionGroupIds][0])}&section=overview` : positionGroupIds.size > 1 ? `/workspace?groupChoices=${encodeURIComponent([...positionGroupIds].sort().join(","))}&section=overview` : "/workspace"), icon: <LampDesk size={18} aria-hidden="true" />, iconOnly: true, flat: true }}
          inlineAction={<RequisitionPriorityButton key={requisition.doc_id} requisition={requisition} language={language} canManage={canManageRequisitionPriority(data.profile, requisition)} onToggle={onTogglePriority} />}
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
        </div>
      ),
      body: (
        <div className="grid min-w-0 gap-4" data-requisition-detail>
          <section className="rounded-xl border border-[#D7DEE8] bg-white p-4 sm:p-5">
          <SectionHeading className="mb-3" icon={<BriefcaseBusiness size={19} />} title={translate(language, "requisitionOverview")} />
          <OperationalSummaryStrip density="compact" valueTone="navy" items={[
            { label: translate(language, "openHeadcountShort"), value: requisition.open_headcount, tone: requisition.open_headcount > 0 ? "warning" : "success", helper: translate(language, "remainingDemand") },
            { label: translate(language, "accepted"), value: `${requisition.accepted_count}/${requisition.head_count}`, tone: "muted", helper: translate(language, "headcount") },
            { label: translate(language, "actualAge"), value: getRequisitionAgeDays(requisition.pr_approved_date) === null ? "—" : `${getRequisitionAgeDays(requisition.pr_approved_date)} ${language === "th" ? "วัน" : "days"}`, tone: "muted", helper: translate(language, "prApprovedDate") },
            { label: translate(language, "currentSla"), value: sla?.label ?? "—", tone: sla?.isOverdue ? "danger" : "muted", helper: translate(language, "slaLabel") }
          ]} />
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#E9F2FF]" role="img" aria-label={`${translate(language, "accepted")}: ${requisition.accepted_count}/${requisition.head_count}; ${Math.round(fillPercent)}%`}><div className="h-full bg-primary" style={{ width: `${fillPercent}%` }} /></div>
          <p className="mt-2 text-xs leading-relaxed text-slate">{sourcingLinkReadinessLabel(language, readiness.linked)} · {readinessReason}</p>
          </section>
          <InlineDataQualityIssues issues={issues} language={language} />
          <section className="rounded-xl border border-[#D7DEE8] bg-white p-4 sm:p-5">
          <SectionHeading className="mb-3" icon={<Files size={19} />} title={translate(language, "requisitionProfile")} />
          <DetailGrid workspace language={language} rows={[
            { label: translate(language, "requisitionId"), value: requisition.doc_id, copyValue: requisition.doc_id, icon: <Hash size={18} /> },
            { label: translate(language, "prApprovedDate"), value: formatDate(requisition.pr_approved_date, language), icon: <CalendarDays size={18} /> },
            { label: translate(language, "position"), value: requisition.position, icon: <BriefcaseBusiness size={18} /> },
            {
              label: translate(language, "jobLevel"),
              value: requisition.level ? (/^(0|[1-9]|1[0-4])$/.test(requisition.level) ? `L${requisition.level}` : requisition.level) : "—",
              icon: <Layers3 size={18} />,
              action: canWrite && canManageRequisitionPriority(data.profile, requisition)
                ? <Button type="button" size="icon-sm" variant="ghost" className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9" icon={<Pencil size={16} aria-hidden="true" />} aria-label={translate(language, "editJobLevel")} title={translate(language, "editJobLevel")} onClick={() => onChangeRequisition(requisition.doc_id)} />
                : null
            },
            { label: translate(language, "site"), value: requisition.site || "—", icon: requisition.site === "HQ" ? <Building2 size={18} /> : <Factory size={18} /> },
            { label: translate(language, "department"), value: requisition.department || "—", icon: <Building2 size={18} /> },
            { label: translate(language, "section"), value: requisition.section ?? "—", icon: <Network size={18} /> },
            { label: translate(language, "status"), value: requisitionStatusLabel(language, requisition.status), icon: <CheckCircle2 size={18} /> },
            { label: translate(language, "requestType"), value: requestTypeLabel(language, requisition.request_type), icon: <RefreshCw size={18} /> },
            { label: translate(language, "replacementNames"), value: requisition.request_type === "Replacement" ? replacementNamesDisplay(requisition.replacement_names) : "—", icon: <UsersRound size={18} /> },
            { label: translate(language, "owner"), value: requisition.person_in_charge ?? "—", icon: <UserRound size={18} /> },
            { label: translate(language, "lineManager"), value: requisition.line_manager ?? "—", icon: <ContactRound size={18} /> },
            { label: translate(language, "headcount"), value: String(requisition.head_count), icon: <UsersRound size={18} /> },
            { label: translate(language, "accepted"), value: String(requisition.accepted_count), icon: <CheckCircle2 size={18} /> },
            { label: translate(language, "open"), value: String(requisition.open_headcount), icon: <BriefcaseBusiness size={18} /> },
            { label: translate(language, "createdAt"), value: formatDateTime(requisition.created_at, language), icon: <CalendarPlus size={18} /> },
            { label: translate(language, "updatedAt"), value: formatDateTime(requisition.updated_at, language), icon: <CalendarDays size={18} /> }
          ]} />
          </section>
          <DetailDisclosure title={<SectionHeading icon={<JourneyTrendIcon />} title={translate(language, "workspaceJourney")} />} summary={`${candidates.length} ${translate(language, "candidatesUnit")} / ${offers.length} ${translate(language, "offersDetail")}`}>
            <PipelineFunnel
              language={language}
              rows={funnelRows}
              subtitle={language === "th" ? "ประวัติการเข้าสู่ขั้นตอน นับผู้สมัครไม่ซ้ำในแต่ละขั้นตอน" : "Historical stage touches, de-duplicated per candidate per stage"}
              totalValue={applicantTotal}
            />
          </DetailDisclosure>
          <DetailDisclosure title={<SectionHeading icon={<UsersRound size={18} />} title={translate(language, "relatedRecords")} />} summary={`${candidates.length} ${translate(language, "candidatesUnit")} / ${offers.length} ${translate(language, "offersDetail")}`}>
            <div className="grid gap-4">
               <div><SectionHeading icon={<UserRound size={18} />} title={translate(language, "candidates")} /><div className="mt-2 divide-y divide-[#E7EDF5]">{candidates.length ? candidates.map(row => <a key={row.candidate_id} href={href(`/candidates?detailType=candidate&detailId=${encodeURIComponent(row.candidate_id)}`)} className="block min-w-0 rounded px-1 py-3 hover:bg-[#F1F6FC] focus:outline-none focus:ring-2 focus:ring-primary"><strong className="break-words text-sm font-semibold text-navy">{formatCandidateName(row)}</strong><span className="mt-1 block text-xs text-slate">{formatRecruitmentId(row.candidate_id)} · {processLabel(row.latest_process, language)}</span></a>) : <p className="py-3 text-sm text-slate">{language === "th" ? "ไม่มีผู้สมัครที่เกี่ยวข้อง" : "No related candidates"}</p>}</div></div>
               <div><SectionHeading icon={<Files size={18} />} title={translate(language, "offers")} /><div className="mt-2 divide-y divide-[#E7EDF5]">{offers.length ? offers.map(row => <a key={row.offer_id} href={href(`/offers?offerSearch=${encodeURIComponent(row.candidate_id)}`)} className="block rounded px-1 py-3 hover:bg-[#F1F6FC] focus:outline-none focus:ring-2 focus:ring-primary"><strong className="text-sm font-semibold text-navy">{formatRecruitmentId(row.candidate_id)}</strong><span className="mt-1 block text-xs text-slate">#{row.offer_id} · {translate(language, "accepted")}: {formatDate(row.accepted_date, language)}{row.start_confirmation === "did_not_start" ? ` · ${language === "th" ? "ไม่มาทำงาน" : "Did not start"}` : ""}</span></a>) : <p className="py-3 text-sm text-slate">{language === "th" ? "ไม่มีข้อเสนอที่เกี่ยวข้อง" : "No related offers"}</p>}</div></div>
            </div>
          </DetailDisclosure>
          <DetailDisclosure title={<SectionHeading icon={<Activity size={18} />} title={translate(language, "history")} />} summary={String(history.length)}>
            <div className="divide-y divide-[#E7EDF5]">{history.length ? history.map(row => <div key={row.log_id} className="py-3"><p className="text-sm font-semibold text-navy">{requisitionStatusLabel(language, row.status)}</p><p className="mt-1 text-xs text-slate">{formatDate(row.log_date, language)}</p>{row.remark ? <p className="mt-1 break-words text-sm text-slate">{row.remark}</p> : null}</div>) : <p className="text-sm text-slate">{language === "th" ? "ยังไม่มีประวัติการเปลี่ยนสถานะ" : "No status changes recorded"}</p>}</div>
          </DetailDisclosure>
        </div>
      )
    };
  }

  const candidate = enrichCandidates(data).find((row) => row.candidate_id === detail.id);
  if (!candidate) return { title: "Candidate", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
  const logs = applicationLogs(data, candidate);
  const stageRecords = pipelineStageRecords(logs, data.change_logs).sort((a, b) => {
    const stageOrder = ACTIVE_PIPELINE_STAGES.indexOf(a.stage) - ACTIVE_PIPELINE_STAGES.indexOf(b.stage);
    return stageOrder || a.round - b.round || a.logId - b.logId;
  });
  const completedStageRecords = stageRecords.filter((record) => Boolean(record.outcome));
  const recentCompletedStageRecords = completedStageRecords.slice(-3).reverse();
  const olderCompletedStageRecords = completedStageRecords.slice(0, -3).reverse();
  const canEditCurrentPending = candidatePipelineCapability(candidate, logs, data.profile).canWrite;
  const canEditOffers = canWrite && Boolean(candidate.group_id && canManageApplicationGroup(data,candidate.group_id));
  const offers = data.offers.filter((row) => belongsToApplication(row, candidate));
  const references = data.candidate_references.filter((row) => row.candidate_id === candidate.candidate_id);
  const referenceChecks = new Map(data.candidate_reference_checks.filter(row => !candidate.application_id || row.application_id === candidate.application_id).map((row) => [row.reference_id, row]));
  const availableReferenceCount = references.filter((row) => row.status === "available").length;
  const checkedReferenceCount = references.filter((row) => row.status === "available" && referenceChecks.has(row.reference_id)).length;
  const updateDisabledReason = candidateProcessDisabledReason(candidate, logs, data.profile);
  const issues = deriveDataQualityIssues(data).filter((issue) =>
    issue.entityId === candidate.candidate_id || offers.some((offer) => String(offer.offer_id) === issue.entityId)
  );
  const failedLog = logs.find((log) => log.result === 0 && !log.superseded_at);
  const pendingInterview = logs.find((log) => log.result === null && !log.superseded_at && (log.recruitment_process === "HR Interview" || log.recruitment_process === "Line Interview"));
  const interviewMeeting = pendingInterview ? data.interview_meetings.find((meeting) => meeting.stage_instance_id === pendingInterview.stage_instance_id && meeting.status !== "cancelled") : null;
  const rejectionLetterAlreadySent = Boolean(failedLog && data.rejection_letter_drafts.some((draft) => draft.candidate_id === candidate.candidate_id && draft.failed_stage_instance_id === failedLog.stage_instance_id && draft.status === "sent"));

  return {
    title: `${formatRecruitmentId(candidate.candidate_id)} / ${formatCandidateName(candidate)}`,
    headerContent: <CandidateDetailHeader candidate={candidate} language={language} />,
      headerActions: (
        <div className="flex items-center gap-1">
        {canWrite && failedLog ? <Button type="button" variant="ghost" size="icon-sm" disabled={rejectionLetterAlreadySent} className="text-scarlet hover:bg-[#FFF1F0] hover:text-scarlet disabled:text-cool" icon={<Mail size={17} aria-hidden="true" />} aria-label="Send rejection letter" title={rejectionLetterAlreadySent ? "Rejection letter already sent" : "Send rejection letter"} onClick={() => { if (!rejectionLetterAlreadySent) onCreateRejectionLetter(candidate); }} /> : null}
        <RecordActionGroup
          label={formatCandidateName(candidate)}
          flat
          primary={{ id: "workspace", label: "Open workspace", href: href(`/workspace?type=${candidate.group_id ? "group" : "requisition"}&id=${encodeURIComponent(candidate.group_id ?? candidate.doc_ids[0] ?? "")}&section=overview`), icon: <LampDesk size={17} aria-hidden="true" />, iconOnly: true, flat: true }}
          inlineAction={canWrite ? <Button type="button" variant="ghost" size="icon-sm" className="text-primary hover:bg-[#F1F6FC] hover:text-primary" icon={<Pencil size={17} aria-hidden="true" />} aria-label="Edit candidate" title="Edit candidate" onClick={() => onChangeCandidate(candidate.candidate_id)} /> : null}
          items={[
            ...(canWrite ? [{ id: "change-record", label: translate(language, "changeRecord"), onSelect: () => onChangeCandidate(candidate.candidate_id) }] : []),
            ...(canDeleteRecords ? [{
              id: "delete-record",
              label: translate(language, "deleteRecord"),
              tone: "danger" as const,
              onSelect: () => onDeleteRecord("app_delete_recruitment_record", { entity: "candidate", id: candidate.candidate_id }, translate(language, "deleteRecordSummary", { entity: translate(language, "candidate"), id: formatRecruitmentId(candidate.candidate_id) }))
            }] : []),
            ...(candidate.doc_ids[0] ? [{ id: "requisition", href: href(`/requisitions?detailType=requisition&detailId=${encodeURIComponent(candidate.doc_ids[0])}`), label: "View requisition" }] : []),
            { id: "same-group", href: href(`/candidates?candSearch=${encodeURIComponent(candidate.group_position ?? candidate.doc_group_id ?? "")}`), label: "Same group" },
            { id: "pipeline", href: href(`/pipeline?pipelineSearch=${encodeURIComponent(candidate.candidate_id)}&detailType=candidate&detailId=${encodeURIComponent(candidate.candidate_id)}`), label: "Open in pipeline" }
        ]}
        />
        </div>
    ),
    body: (
      <div className="candidate-detail-workspace grid min-w-0 gap-5">
        <InlineDataQualityIssues
          canResolve={(issue) => canEditOffers && issue.entity === "offer" && offers.some((offer) => String(offer.offer_id) === issue.entityId && offer.accepted_date && offer.first_working_date && offer.first_working_date <= today() && offer.start_confirmation === null)}
          issues={issues.filter(issue => issue.workspaceCode !== "duplicateCandidate")}
          language={language}
          onResolve={(issue) => {
            const offer = offers.find((row) => String(row.offer_id) === issue.entityId);
            if (offer) onConfirmOfferStart(offer);
          }}
        />
        <section className="min-w-0 rounded-xl border border-[#D7DEE8] bg-white p-4 shadow-[0_10px_28px_rgba(11,19,43,0.035)] sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeading icon={<JourneyTrendIcon />} title="Candidate Pipeline Journey" />
            {!updateDisabledReason.blocked ? <Button type="button" size="sm" variant="primary" icon={<BriefcaseBusiness size={17} />} disabled={!canWrite} onClick={() => onUpdateCandidate(candidate.candidate_id)}>Update</Button> : null}
          </div>
          {updateDisabledReason.blocked ? <div className="mt-3"><DisabledReasonHint language={language} reason={updateDisabledReason} /></div> : null}
          <div className="mt-4"><CandidateJourney language={language} logs={logs} /></div>
        </section>
        {pendingInterview ? <section className="min-w-0 rounded-xl border border-[#D7DEE8] bg-white p-4 shadow-[0_10px_28px_rgba(11,19,43,0.035)] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><SectionHeading icon={<CalendarPlus size={19} />} title="Teams interview" /><p className="mt-1 text-sm text-slate">{processLabel(pendingInterview.recruitment_process, language)} · {interviewMeeting ? interviewMeeting.status === "scheduled" ? "Scheduled" : interviewMeeting.status === "failed" ? "Scheduling failed — use Current Stage Edit to retry." : "Updating meeting…" : "No meeting scheduled"}</p></div></div>
          {interviewMeeting ? <div className="mt-3 grid gap-1 rounded-lg bg-[#F8FAFD] p-3 text-sm text-slate"><p><strong className="text-navy">Bangkok time:</strong> {formatBangkokMeetingDateTime(interviewMeeting.starts_at, language)}</p><p><strong className="text-navy">Organizer:</strong> {interviewMeeting.organizer_mailbox ?? "Shared HR mailbox"}</p><p><strong className="text-navy">Attendees:</strong> {interviewMeeting.interviewer_emails.join(", ")}</p>{interviewMeeting.join_url ? <a className="mt-1 w-fit font-semibold text-primary underline" href={interviewMeeting.join_url} target="_blank" rel="noreferrer">Join Teams meeting</a> : null}{interviewMeeting.failure_summary ? <p role="alert" className="mt-1 font-semibold text-scarlet">{interviewMeeting.failure_summary}</p> : null}</div> : null}
        </section> : null}
        <section className="min-w-0 rounded-xl border border-[#D7DEE8] bg-white p-4 shadow-[0_10px_28px_rgba(11,19,43,0.035)] sm:p-5">
          <SectionHeading className="mb-3" icon={<ContactRound size={19} />} title={language === "th" ? "รายละเอียดใบสมัคร" : "Application details"} />
        <DetailGrid workspace language={language} rows={[
          { label: "Group ID", value: candidate.group_id ?? candidate.doc_group_id ?? "-", copyValue: candidate.group_id ?? candidate.doc_group_id, icon: <UsersRound size={18} /> },
          { label: "Doc IDs", value: candidate.doc_ids.join(", ") || "-", copyValue: candidate.doc_ids.join(", ") || undefined, icon: <Files size={18} /> },
          { label: "Group Position", value: candidate.group_position ?? "-", copyValue: candidate.group_position, icon: <BriefcaseBusiness size={18} /> },
          { label: "Site", value: candidate.site ?? "-", copyValue: candidate.site, icon: <Building2 size={18} /> },
          { label: "Owner", value: candidate.person_in_charge ?? "-", copyValue: candidate.person_in_charge, icon: <UserRound size={18} /> },
        ]} />
          <CandidateApplicationDetailsExtras />
        </section>
        {failedLog ? <DetailDisclosure title="Rejection letters" summary={`${data.rejection_letter_drafts.filter((draft) => draft.candidate_id === candidate.candidate_id && logs.some(log=>log.stage_instance_id===draft.failed_stage_instance_id)).length} recorded`}>
          <div className="grid gap-2">
            {data.rejection_letter_drafts.filter((draft) => draft.candidate_id === candidate.candidate_id && logs.some(log=>log.stage_instance_id===draft.failed_stage_instance_id)).map((draft) => <div key={draft.draft_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 text-sm"><strong className="text-navy">{draft.status === "sent" ? "Email sent" : draft.status === "draft_created" ? "Outlook draft created" : draft.status === "creating" ? "Creating Outlook draft" : draft.status === "failed" ? "Email delivery failed" : "Sending email"}</strong><p className="mt-1 text-slate">{draft.recipient_email} · {formatDate(draft.created_at.slice(0, 10), language)}</p>{draft.shared_mailbox ? <p className="text-xs text-slate">Shared mailbox: {draft.shared_mailbox}</p> : null}{draft.failure_summary ? <p className="mt-1 text-xs text-scarlet">{draft.failure_summary}</p> : null}{draft.status === "failed" && canWrite ? <Button type="button"   className="mt-2" onClick={() => onCreateRejectionLetter(candidate, draft.draft_id)}>Retry email</Button> : null}</div>)}
            {data.rejection_letter_drafts.filter((draft) => draft.candidate_id === candidate.candidate_id && logs.some(log=>log.stage_instance_id===draft.failed_stage_instance_id)).length === 0 ? <p className="text-sm text-slate">No rejection letters have been sent.</p> : null}
          </div>
        </DetailDisclosure> : null}
        <DetailDisclosure title={<SectionHeading icon={<UsersRound size={18} />} title={translate(language, "contactReferences")} />} summary={translate(language, "referenceProgress", { checked: checkedReferenceCount, available: availableReferenceCount })} defaultOpen>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#C8D8FF] bg-[#F8FBFF] px-3 py-2">
              <div className="flex min-w-0 items-start gap-2 text-primary"><Info className="mt-0.5 shrink-0" size={15} aria-hidden="true" /><div className="grid gap-0"><p className="text-[11px] font-semibold leading-snug text-navy">{translate(language, "referencePassRequirement")}</p>{references.length === 0 ? <p className="text-[11px] leading-snug text-slate">{translate(language, "noContactReferences")}</p> : null}</div></div>
              {canWrite ? <Button type="button" size="icon-sm" variant="ghost" className="text-primary hover:bg-[#E8F0FF] hover:text-primary" icon={<Plus size={17} />} aria-label={translate(language, "addReference")} title={translate(language, "addReference")} onClick={() => onEditReference(candidate.candidate_id)} /> : null}
            </div>
            {references.length === 0 ? null : references.map((reference) => {
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
        <DetailDisclosure title={<SectionHeading icon={<Activity size={18} />} title="Activity" />} summary="Stage records and offers" defaultOpen>
          <div className="grid gap-4">
            <div>
              <h4 className="mb-1.5 text-sm font-semibold text-navy">{translate(language, "currentStage")}</h4>
              <div className="grid gap-1.5">
                {stageRecords.filter((record) => !record.outcome).map((record) => (
                  <div key={record.stageInstanceId} className="min-w-0 rounded-md border border-[#F3D3A2] border-l-4 border-l-[#FFB20F] bg-[#FFFCF6] px-2.5 py-2 shadow-none">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <strong className="min-w-0 break-words text-sm text-navy">{processLabel(record.stage, language)} / {translate(language, "round")} {record.round}</strong>
                      {canEditCurrentPending ? <Button type="button" size="icon-sm" variant="ghost" className="text-primary hover:bg-[#FFF4D8] hover:text-primary" icon={<Pencil size={16} aria-hidden="true" />} aria-label={translate(language, "edit")} title={translate(language, "edit")} onClick={() => onEditPending(candidate, record.stage as ProcessStage)} /> : null}
                    </div>
                    <p className="mt-0.5 break-words text-xs font-medium text-slate">{translate(language, "pendingDetails")}: {formatDate(record.pending.openedDate, language)} / {record.pending.interviewer ?? translate(language, "noInterviewer")}</p>
                    {record.pending.estimatedActionDate ? <p className="mt-0.5 break-words text-xs font-semibold text-primary">{translate(language, "estimatedDateValue", { date: formatDate(record.pending.estimatedActionDate, language) })}</p> : null}
                    {record.pending.remark ? <p className="mt-0.5 break-words text-xs text-slate">{record.pending.remark}</p> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {record.pending.editedAt ? <Tag tone="muted">{translate(language, "edited")}</Tag> : null}
                      {record.origin === "migration" ? <Tag tone="muted">{translate(language, "migrated")}</Tag> : null}
                    </div>
                    {record.migrationNote ? <p className="mt-1 break-words text-[11px] font-medium text-slate">{record.migrationNote}</p> : null}
                  </div>
                ))}
                {stageRecords.every((record) => record.outcome) ? <p className="text-sm font-medium text-slate">{translate(language, "noData")}</p> : null}
              </div>
              <h4 className="mb-2 mt-4 font-semibold text-navy">{translate(language, "completedStageHistory")}</h4>
              <div className="relative ml-2 grid gap-2 border-l border-[#D7DEE8] pl-5">
                {recentCompletedStageRecords.map((record) => (
                  <div key={record.stageInstanceId} className="relative min-w-0 rounded-md border border-[#D7DEE8] border-l-4 border-l-primary bg-white p-3">
                    <span className="absolute -left-[1.9rem] top-3 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-white ring-4 ring-white" aria-label={record.outcome?.result === "pass" ? translate(language, "passStage") : translate(language, "failStage")}>{record.outcome?.result === "pass" ? "✓" : "×"}</span>
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-navy">{processLabel(record.stage, language)} / {translate(language, "round")} {record.round}</strong>{record.outcome?.result === "pass" ? <span className="inline-flex min-h-5 items-center rounded-md bg-[#E9F9EF] px-2 text-[11px] font-semibold text-[#167A3D]">{resultText(1, language)}</span> : <Tag tone="danger">{resultText(0, language)}</Tag>}</div>
                    <p className="mt-1 text-xs font-medium text-slate">{translate(language, "pendingDetails")}: {formatDate(record.pending.openedDate, language)} / {record.pending.interviewer ?? translate(language, "noInterviewer")}</p>
                    {record.pending.estimatedActionDate ? <p className="mt-1 text-xs font-semibold text-primary">{translate(language, "estimatedDateValue", { date: formatDate(record.pending.estimatedActionDate, language) })}</p> : null}
                    <p className="mt-1 text-xs font-medium text-slate">{translate(language, "outcome")}: {formatDate(record.outcome?.date, language)} / {record.outcome?.interviewer ?? translate(language, "noInterviewer")}</p>
                    {record.outcome?.result === "fail" ? <p className="mt-1 break-words text-xs font-semibold text-navy">{failureReasonText(logs.find((log) => log.stage_instance_id === record.stageInstanceId), language)}</p> : null}
                    {record.outcome?.remark ? <p className="mt-1 break-words text-xs text-slate">{translate(language, "remark")}: {record.outcome.remark}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {record.origin === "migration" ? <Tag tone="muted">{translate(language, "migrated")}</Tag> : null}
                    </div>
                    {record.migrationNote ? <p className="mt-2 break-words text-xs font-medium text-slate">{record.migrationNote}</p> : null}
                  </div>
                ))}
                {olderCompletedStageRecords.length > 0 ? <details className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD]">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-primary">Show remaining history ({olderCompletedStageRecords.length})</summary>
                  <div className="grid gap-2 border-t border-[#D7DEE8] p-3">
                    {olderCompletedStageRecords.map((record) => <div key={record.stageInstanceId} className="min-w-0 rounded-md border border-[#D7DEE8] bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-navy">{processLabel(record.stage, language)} / {translate(language, "round")} {record.round}</strong>{record.outcome?.result === "pass" ? <span className="inline-flex min-h-5 items-center rounded-md bg-[#E9F9EF] px-2 text-[11px] font-semibold text-[#167A3D]">{resultText(1, language)}</span> : <Tag tone="danger">{resultText(0, language)}</Tag>}</div>
                      {record.outcome?.result === "fail" ? <p className="mt-1 break-words text-xs font-semibold text-navy">{failureReasonText(logs.find((log) => log.stage_instance_id === record.stageInstanceId), language)}</p> : null}
                      <p className="mt-1 text-xs font-medium text-slate">{translate(language, "pendingDetails")}: {formatDate(record.pending.openedDate, language)} / {record.pending.interviewer ?? translate(language, "noInterviewer")}</p>
                      <p className="mt-1 text-xs font-medium text-slate">{translate(language, "outcome")}: {formatDate(record.outcome?.date, language)} / {record.outcome?.interviewer ?? translate(language, "noInterviewer")}</p>
                      {record.outcome?.remark ? <p className="mt-1 break-words text-xs text-slate">{translate(language, "remark")}: {record.outcome.remark}</p> : null}
                      {record.origin === "migration" ? <div className="mt-2"><Tag tone="muted">{translate(language, "migrated")}</Tag></div> : null}
                    </div>)}
                  </div>
                </details> : null}
              </div>
            </div>
            <div>
              <h4 className="mb-2 font-semibold text-navy">{translate(language, "offers")}</h4>
              <div className="grid gap-2">
                {offers.length === 0 ? <p className="text-sm font-medium text-slate">{translate(language, "noData")}</p> : offers.map((offer) => (
                  <div key={offer.offer_id} className="grid gap-3 rounded-md border border-[#D7DEE8] bg-white p-3">
                    <section className="rounded-md border border-[#E4E9F2] bg-[#F8FAFD] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-navy">{offer.doc_id}</strong><div className="flex flex-wrap gap-2">{canEditOffers ? <Button type="button" size="icon-sm" variant="ghost" className="ats-compact-utility" aria-label={language === "th" ? "แก้ไขข้อเสนอ" : "Edit offer"} title={language === "th" ? "แก้ไขข้อเสนอ" : "Edit offer"} onClick={() => onEditOffer(offer)}><Pencil size={17}/></Button> : null}</div></div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-slate"><span>{translate(language, "acceptedLower")}: {formatDate(offer.accepted_date, language)}</span><span>{translate(language, "startLower")}: {formatDate(offer.first_working_date, language)}</span></div>
                    {offer.remark ? <p className="mt-1 break-words text-sm text-slate">{offer.remark}</p> : null}
                    </section>
                    <section className="rounded-md border border-[#E4E9F2] bg-white p-3">
                    <div className="flex items-start justify-between gap-2"><h5 className="pt-2 text-sm font-semibold text-navy">{language === "th" ? "ยืนยันการเริ่มงาน" : "Working Confirm"}</h5>{canEditOffers && offer.accepted_date && offer.first_working_date && offer.first_working_date <= today() && (!offer.start_confirmation || ["system_admin", "admin_recruiter"].includes(data.profile?.role ?? "")) ? <AttendanceDecisionActions language={language} onDecision={outcome => onConfirmOfferStart(offer, outcome)}/> : null}</div>
                    <p className="mt-1 text-sm font-medium text-slate">{language === "th" ? "การมาทำงานวันแรก:" : "First working date attendance:"} {offer.start_confirmation ? `${offer.start_confirmation === "started" ? (language === "th" ? "เริ่มงานแล้ว" : "Started work") : (language === "th" ? "ไม่ได้เริ่มงาน" : "Did not start")}${offer.start_confirmed_at ? ` / ${formatDate(offer.start_confirmed_at, language)}` : ""}${offer.start_confirmation_reason ? ` — ${offer.start_confirmation_reason}` : ""}` : offer.first_working_date && offer.first_working_date > today() ? (language === "th" ? "ยืนยันได้ในวันเริ่มงาน" : "Available on the first working date") : (language === "th" ? "ยังไม่ได้ยืนยัน" : "Not confirmed")}</p>
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
    const readiness = requisitionSourcingLinkReadiness(requisition);
    const issues = deriveDataQualityIssues(data).filter((issue) => issue.entityId === requisition.doc_id || candidates.some((candidate) => candidate.candidate_id === issue.entityId) || offers.some((offer) => String(offer.offer_id) === issue.entityId));

    return {
      title: formatRequisitionTitle(requisition),
      body: (
        <div className="grid gap-5">
          <div className="rounded-md border border-[#D7DEE8] bg-lightgray/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-slate">{translate(language, "sourcingLinkReadiness")}</p>
                <p className="mt-1 text-sm font-medium text-slate">{sourcingLinkReadinessReason(language, readiness.groupIds)}</p>
              </div>
              <Tag tone={readiness.tone}>{sourcingLinkReadinessLabel(language, readiness.linked)}</Tag>
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
          <DetailList title={translate(language, "offers")} rows={offers.map((row) => `${formatRecruitmentId(row.candidate_id)} - ${translate(language, "acceptedLower")} ${formatDate(row.accepted_date, language)}`)} />
        </div>
      )
    };
  }

  const candidate = enrichCandidates(data).find((row) => row.candidate_id === detail.id);
  if (!candidate) return { title: "Candidate", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
  const logs = applicationLogs(data, candidate);
  const offers = data.offers.filter((row) => belongsToApplication(row, candidate));
  const updateDisabledReason = candidateProcessDisabledReason(candidate, logs, data.profile);
  const issues = deriveDataQualityIssues(data).filter((issue) => issue.entityId === candidate.candidate_id || offers.some((offer) => String(offer.offer_id) === issue.entityId));

  return {
    title: `${formatRecruitmentId(candidate.candidate_id)} · ${formatCandidateName(candidate)}`,
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
                  <Tag appearance="soft" tone={statusTone(resultText(log.result).toLowerCase())}>{resultText(log.result, language)}</Tag>
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

function CandidateJourneyActions({
  candidate, language, logs, references, checks, profile, onClose, onStart, onPass, onFail, onTest, onReferences, onOffer, onEditPending, onMove
}: {
  candidate: EnrichedCandidate | null;
  language: Language;
  logs: RecruitmentLog[];
  references: CandidateReference[];
  checks: CandidateReferenceCheck[];
  profile: Profile | null;
  onClose: () => void;
  onStart: (candidate: EnrichedCandidate) => void;
  onPass: (candidate: EnrichedCandidate) => void;
  onFail: (candidate: EnrichedCandidate) => void;
  onTest: (candidate: EnrichedCandidate) => void;
  onReferences: (candidate: EnrichedCandidate) => void;
  onOffer: (candidate: EnrichedCandidate) => void;
  onEditPending: (candidate: EnrichedCandidate) => void;
  onMove: (candidate: EnrichedCandidate, stage: ProcessStage) => void;
}) {
  if (!candidate) return null;
  const capability = candidatePipelineCapability(candidate, logs, profile);
  const baseDisabledReason = candidateProcessDisabledReason(candidate, logs, profile);
  const canResolveCurrent = ACTIVE_PIPELINE_STAGES.includes(candidate.latest_process as ProcessStage) && candidate.latest_result === null;
  const unresolvedReferences = references.filter((reference) => reference.status === "available" && !checks.some((check) => check.reference_id === reference.reference_id)).length;
  const referencePassBlocked = candidate.latest_process === "Reference Check" && unresolvedReferences > 0;
  const currentIndex = ACTIVE_PIPELINE_STAGES.indexOf(candidate.latest_process as ProcessStage);
  const updateStages = candidate.latest_process === "No activity" ? [] : currentIndex === -1 ? ACTIVE_PIPELINE_STAGES : ACTIVE_PIPELINE_STAGES.slice(currentIndex + 2);
  const buttonClass = "w-full justify-start text-left";
  const actionName = formatCandidateName(candidate);

  return (
    <Modal open title={translate(language, "candidateActionsFor", { name: actionName })} closeLabel={translate(language, "close")} onClose={onClose} width="max-w-md">
      <div role="menu" aria-label={translate(language, "candidateActionsFor", { name: actionName })} className="grid gap-1">
        <DisabledReasonHint language={language} reason={capability.blocked ? capability : baseDisabledReason} />
        {referencePassBlocked ? <p className="rounded-md bg-[#FFF4D8] px-3 py-2 text-xs font-medium text-[#A96300]">{translate(language, "referencePassBlocked", { count: unresolvedReferences })}</p> : null}
        {candidate.latest_process === "No activity" ? <Button type="button" role="menuitem" variant="ghost" className={buttonClass} disabled={capability.blocked} onClick={() => onStart(candidate)}>{translate(language, "startPhoneScreen")}</Button> : null}
        {candidate.latest_process === "Offer" ? <Button type="button" role="menuitem" variant="ghost" className={buttonClass} disabled={capability.blocked} onClick={() => onOffer(candidate)}>{translate(language, "updateOffer")}</Button> : null}
        {canResolveCurrent ? <Button type="button" role="menuitem" variant="ghost" className={buttonClass} disabled={capability.blocked || referencePassBlocked} title={referencePassBlocked ? translate(language, "referencePassBlockedShort", { count: unresolvedReferences }) : undefined} onClick={() => onPass(candidate)}>{translate(language, "passStage")}</Button> : null}
        {canResolveCurrent ? <Button type="button" role="menuitem" variant="ghost" className={`${buttonClass} text-scarlet hover:bg-[#FFF1F0] hover:text-scarlet`} disabled={capability.blocked} onClick={() => onFail(candidate)}>{translate(language, "failStage")}</Button> : null}
        {candidate.latest_process === "Reference Check" && candidate.latest_result === null ? <Button type="button" role="menuitem" variant="ghost" className={buttonClass} disabled={capability.blocked} onClick={() => onReferences(candidate)}>{translate(language, "manageReferenceChecks")}</Button> : null}
        {isRepeatableStage(candidate.latest_process as ProcessStage) ? <Button type="button" role="menuitem" variant="ghost" className={buttonClass} disabled={capability.blocked} onClick={() => onTest(candidate)}>{translate(language, candidate.latest_process === "Line Interview" ? "addAnotherLineInterviewRound" : "addAnotherTestRound")}</Button> : null}
        {updateStages.map((stage) => {
          const disabledReason = capability.blocked ? capability : pipelineMoveDisabledReason(candidate, stage, logs, profile);
          return <Button key={stage} type="button" role="menuitem" variant="ghost" className={buttonClass} disabled={disabledReason.blocked} title={disabledReason.detail} onClick={() => onMove(candidate, stage)}>{processLabel(stage, language)}</Button>;
        })}
        {canResolveCurrent ? <Button type="button" role="menuitem" variant="ghost" className={buttonClass} disabled={capability.blocked} onClick={() => onEditPending(candidate)}>{translate(language, "editPendingDetails")}</Button> : null}
      </div>
    </Modal>
  );
}

function CandidateJourney({ language, logs }: { language: Language; logs: RecruitmentLog[] }) {
  return <StageRail language={language} logs={logs} variant="candidate-workspace" />;
}

/** Four-node rise–fall–rise mark used by the candidate Journey heading. */
function JourneyTrendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 17.5 8.5 11l5 4.2L20.5 6.5" />
      <circle cx="3.5" cy="17.5" r="2" fill="white" />
      <circle cx="8.5" cy="11" r="2" fill="white" />
      <circle cx="13.5" cy="15.2" r="2" fill="white" />
      <circle cx="20.5" cy="6.5" r="2" fill="white" />
    </svg>
  );
}

function RequisitionDetailHeader({ requisition, language, readiness }: { requisition: EnrichedRequisition; language: Language; readiness: SourcingLinkReadiness }) {
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#F1F6FC] text-primary sm:size-16" aria-hidden="true"><BriefcaseBusiness size={27} strokeWidth={1.8} /></span>
      <div className="min-w-0">
        <p className="text-base font-semibold leading-tight text-navy sm:text-xl"><span className="block break-words sm:inline">{formatRequisitionTitle(requisition)}</span><span className="hidden sm:inline"> / </span><span className="block whitespace-nowrap sm:inline">{requisition.doc_id}</span></p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <Tag appearance="soft" tone={statusTone(requisition.status)}>{requisitionStatusLabel(language, requisition.status)}</Tag>
          <span title={sourcingLinkReadinessReason(language, readiness.groupIds)}><Tag appearance="soft" tone={readiness.tone}>{sourcingLinkReadinessLabel(language, readiness.linked)}</Tag></span>
        </div>
      </div>
    </div>
  );
}

function CandidateDetailHeader({ candidate, language }: { candidate: EnrichedCandidate; language: Language }) {
  const stageTone = candidate.latest_result === 0 ? "danger" : candidate.accepted_date ? "success" : "primary";
  const resultTone = candidate.latest_result === 0 ? "danger" : candidate.latest_result === 1 ? "success" : "warning";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-16 shrink-0 place-items-center rounded-full bg-[#F1F6FC] text-primary" aria-hidden="true"><UserRound size={31} strokeWidth={1.8} /></span>
      <div className="min-w-0">
        <p className="break-words text-xl font-semibold leading-tight text-navy">{formatCandidateName(candidate)} / {formatRecruitmentId(candidate.candidate_id)}</p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <Tag appearance="soft" tone={stageTone}>{processLabel(candidate.latest_process, language)}</Tag>
          <Tag appearance="soft" tone={resultTone}>{resultText(candidate.latest_result, language)}</Tag>
        </div>
      </div>
    </div>
  );
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

function DetailDisclosure({ children, defaultOpen = false, summary, title }: { children: ReactNode; defaultOpen?: boolean; summary: string; title: ReactNode }) {
  return (
    <details className="group min-w-0 rounded-md border border-[#D7DEE8] bg-white" open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/25 [&::-webkit-details-marker]:hidden">
        {typeof title === "string" ? <span className="font-semibold text-navy">{title}</span> : title}
        <span className="text-right text-xs font-medium text-slate group-open:hidden">{summary}</span>
        <span className="hidden text-primary group-open:inline" title="Hide"><EyeOff size={16} aria-hidden="true" /><span className="sr-only">Hide</span></span>
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
  return currentLocalSourcingCycleSaturday();
}

function offerPassHandoffFromResult(result: RpcResult, data: DashboardData): OfferPassHandoff | null {
  const handoff = result.offer_handoff;
  if (!handoff?.candidate_id || !handoff.passed_date) return null;
  const candidate = data.candidates.find((row) => row.candidate_id === handoff.candidate_id);
  const docId = handoff.requisitions?.[0]?.doc_id
    ?? data.document_groups.find((row) => row.doc_group_id === candidate?.doc_group_id)?.doc_id;
  return docId ? { candidateId: handoff.candidate_id, applicationId: handoff.application_id, docId, passedDate: handoff.passed_date } : null;
}

function parseWorkspaceUrlState(): ParsedWorkspaceUrlState {
  if (typeof window === "undefined") {
    return { language: null, site: null, owner: null, priorityOnly: false, sourcingWeek: null, detailType: null, detailId: null, workspaceType: null, workspaceId: null, hasFilterParams: false };
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
    priorityOnly: params.get("priority") === "only",
    sourcingWeek: params.get("sourcingWeek"),
    detailType: detailType === "candidate" || detailType === "requisition" ? detailType : null,
    detailId: params.get("detailId"),
    workspaceType: workspaceType === "requisition" || workspaceType === "group" ? workspaceType : null,
    workspaceId: params.get("id"),
    hasFilterParams: params.has("site") || params.has("pic") || params.has("priority") || params.has("sourcingSite") || params.has("sourcingOwner")
  };
}

function WorkspaceStatusScreen({
  language = "en",
  busy,
  loginHref,
  message,
  onRetry,
  title
}: {
  language?: Language;
  busy: boolean;
  loginHref?: string;
  message: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-offwhite p-6">
      <Panel className="w-full max-w-md">
        <div role={busy ? undefined : "status"} aria-live={busy ? undefined : "polite"} aria-busy={busy} className="grid gap-3 text-center">
          {busy ? <LoadingSkeleton variant="detail" language={language} /> : null}
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
              <RetryIconButton type="button"  onClick={onRetry}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</RetryIconButton>
            </div>
          ) : null}
        </div>
      </Panel>
    </main>
  );
}

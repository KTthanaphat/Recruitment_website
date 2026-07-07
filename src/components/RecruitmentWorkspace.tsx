"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AdminView } from "@/components/admin/AdminView";
import { AuditView } from "@/components/audit/AuditView";
import { CandidatesView } from "@/components/candidates/CandidatesView";
import { HomeView } from "@/components/dashboard/HomeView";
import { VacancyWaterfallView } from "@/components/dashboard/VacancyWaterfallView";
import { AppShell } from "@/components/layout/AppShell";
import { OffersView } from "@/components/offers/OffersView";
import { PipelineBoardView } from "@/components/pipeline/PipelineBoardView";
import { RequisitionsView } from "@/components/requisitions/RequisitionsView";
import { SourcingView } from "@/components/sourcing/SourcingView";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { PipelineFunnel, type PipelineFunnelRow } from "@/components/ui/PipelineFunnel";
import { StageRail } from "@/components/ui/StageRail";
import { Tag } from "@/components/ui/Tag";
import { ACTIVE_PIPELINE_STAGES, canManageSetup as canManageSetupRole, canManageUsers as canManageUsersRole, canWrite as canWriteRole, PROCESS_UPDATE_STAGES, processLabel, recruiterNicknameOptions, ROLE_LABELS, ROLES, SITE_OPTIONS, SOURCING_CHANNELS, WRITABLE_REQUISITION_STATUSES } from "@/lib/constants";
import {
  emptyDashboardData,
  enrichCandidates,
  enrichOffers,
  enrichRequisitions,
  filterChangeLogsByText,
  filterByText,
  latestLogsForCandidate,
  loadDashboardData,
  sourcingChannelsForDocGroup,
  staleOpenSourcingGroups,
  uniqueValues
} from "@/lib/data";
import { boolFromForm, emptyToNull, formatDate, formatNumber, resultText, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { hasSupabaseConfig, supabase } from "@/lib/supabase/client";
import { asNumber, requireFields } from "@/lib/validation/forms";
import type {
  DashboardData,
  EnrichedCandidate,
  EnrichedRequisition,
  Language,
  ProcessStage,
  RecruitmentLog,
  RequisitionRequestType,
  RequisitionStatus,
  RpcResult,
  ViewId
} from "@/types/recruitment";

type ModalName =
  | "requisition"
  | "status"
  | "candidate"
  | "process"
  | "pipeline_pass"
  | "test_maintenance"
  | "offer"
  | "group"
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
};

type ModalDefaults = {
  group_position?: string;
  doc_id?: string;
  group_id?: string;
  doc_group_id?: string;
  first_contact_date?: string;
};

type GuideStep = "source_candidates" | "create_group" | "add_match" | "ask_candidate" | "create_candidate" | null;

type GuideContext = {
  doc_id?: string;
  position?: string;
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
};

const rpcByModal: Record<Exclude<ModalName, null | "user">, string> = {
  requisition: "app_upsert_requisition",
  status: "app_insert_requisition_log",
  candidate: "app_upsert_candidate",
  process: "app_insert_recruitment_log",
  pipeline_pass: "app_insert_pipeline_passes",
  test_maintenance: "app_insert_test_maintenance",
  offer: "app_upsert_offer",
  group: "app_upsert_position_group",
  match: "app_create_group_match",
  snapshot: "app_upsert_vacancy_weekly_snapshot"
};

export function RecruitmentWorkspace({ initialView }: { initialView: ViewId }) {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("en");
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading recruitment records...");
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ site: "", owner: "" });
  const [sourcingWeek, setSourcingWeek] = useState(currentWeekStart());
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [processDefaults, setProcessDefaults] = useState<ProcessDefaults>({});
  const [modalDefaults, setModalDefaults] = useState<ModalDefaults>({});
  const [guideStep, setGuideStep] = useState<GuideStep>(null);
  const [guideContext, setGuideContext] = useState<GuideContext>({});
  const [detail, setDetail] = useState<{ type: "requisition" | "candidate"; id: string } | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [urlStateReady, setUrlStateReady] = useState(false);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError("Supabase environment variables are not configured. Add .env.local or Vercel environment variables.");
      return;
    }

    setLoading(true);
    setError(null);
    const session = await supabase.auth.getSession();
    if (!session.data.session) {
      setLoading(false);
      setStatus("No active session. Redirecting to login...");
      router.replace("/login");
      return;
    }

    try {
      const loaded = await loadDashboardData(supabase);
      setData(loaded);
      setStatus("Recruitment records loaded.");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load recruitment data.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const urlState = readWorkspaceUrlState();
    const savedLanguage = localStorage.getItem("recruitment_lang") as Language | null;
    const savedFilters = localStorage.getItem("recruitment_filters");
    setLanguage(urlState.language ?? savedLanguage ?? "en");
    if (urlState.hasFilterParams) {
      setFilters({ site: urlState.site ?? "", owner: urlState.owner ?? "" });
    } else if (savedFilters) {
      setFilters(JSON.parse(savedFilters) as { site: string; owner: string });
    }
    setUrlStateReady(true);
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!urlStateReady) return;
    localStorage.setItem("recruitment_lang", language);
    localStorage.setItem("recruitment_filters", JSON.stringify(filters));
    replaceQueryParams({
      lang: language,
      site: filters.site,
      pic: filters.owner
    });
  }, [filters, language, urlStateReady]);

  const role = data.profile?.role ?? "viewer";
  const canWrite = canWriteRole(role);
  const canManageSetup = canManageSetupRole(role);
  const canManageUsers = canManageUsersRole(role);

  const enrichedRequisitions = useMemo(() => enrichRequisitions(data), [data]);
  const enrichedCandidates = useMemo(() => enrichCandidates(data), [data]);
  const enrichedOffers = useMemo(() => enrichOffers(data), [data]);
  const staleSourcingGroups = useMemo(() => staleOpenSourcingGroups(data), [data]);
  const welcomeSummary = useMemo(
    () => buildWelcomeSummary(enrichedRequisitions, enrichedCandidates, data.offers, data.profile),
    [data.offers, data.profile, enrichedCandidates, enrichedRequisitions]
  );

  const filteredRequisitions = useMemo(() => filterByText(enrichedRequisitions, filters), [enrichedRequisitions, filters]);
  const filteredCandidates = useMemo(() => filterByText(enrichedCandidates, filters), [enrichedCandidates, filters]);
  const filteredOffers = useMemo(() => filterByText(enrichedOffers, filters), [enrichedOffers, filters]);
  const filteredChangeLogs = useMemo(() => filterChangeLogsByText(data, filters), [data, filters]);

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
    setModalDefaults({ group_position: guideContext.position ?? "" });
    setActiveModal("group");
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
      setStatus(blockedReason);
      return;
    }
    const currentIndex = ACTIVE_PIPELINE_STAGES.indexOf(candidate.latest_process as ProcessStage);
    const targetIndex = ACTIVE_PIPELINE_STAGES.indexOf(nextStage);
    if (currentIndex === -1 || targetIndex <= currentIndex) return;
    const passedStages = ACTIVE_PIPELINE_STAGES.slice(currentIndex, targetIndex);
    const currentRound = latestRoundForStage(logs, candidate.latest_process as ProcessStage);
    setProcessDefaults({
      candidate_id: candidate.candidate_id,
      target_stage: nextStage,
      source: "pipeline",
      passed_stages: passedStages,
      current_round: currentRound,
      remark: `Progressed from ${processLabel(candidate.latest_process)} to ${processLabel(nextStage)} by pipeline drag and drop`
    });
    setActiveModal("pipeline_pass");
  }

  function openMaintainTest(candidate: EnrichedCandidate) {
    const logs = latestLogsForCandidate(data, candidate.candidate_id);
    const blockedReason = processUpdateBlockReason(logs);
    if (blockedReason) {
      setStatus(blockedReason);
      return;
    }
    if (candidate.latest_process !== "Test") return;
    setProcessDefaults({
      candidate_id: candidate.candidate_id,
      recruitment_process: "Test",
      round: latestRoundForStage(logs, "Test"),
      result: "",
      source: "manual",
      current_round: latestRoundForStage(logs, "Test"),
      remark: "Maintained in Test from pipeline"
    });
    setActiveModal("test_maintenance");
  }

  function openOfferUpdate(candidate: EnrichedCandidate) {
    const logs = latestLogsForCandidate(data, candidate.candidate_id);
    const blockedReason = processUpdateBlockReason(logs);
    if (blockedReason) {
      setStatus(blockedReason);
      return;
    }
    if (candidate.latest_process !== "Offer") return;
    setProcessDefaults({
      candidate_id: candidate.candidate_id,
      recruitment_process: "Offer",
      round: latestRoundForStage(logs, "Offer") || 1,
      result: "",
      source: "manual",
      remark: "Updated Offer from pipeline"
    });
    setActiveModal("process");
  }

  function openProcessFromDetail(candidateId: string) {
    const latest = latestLogsForCandidate(data, candidateId)[0];
    setProcessDefaults({
      candidate_id: candidateId,
      recruitment_process: latest?.recruitment_process,
      source: "manual"
    });
    setActiveModal("process");
  }

  function prepareAction(modal: Exclude<ModalName, null>, form: HTMLFormElement) {
    const formData = new FormData(form);
    const payload = buildPayload(modal, formData);
    const actionPayload = payload as Record<string, unknown>;
    if (modal === "process") validateProcessUpdatePayload(data, payload);
    const summary = buildSummary(modal, payload);
    const isPipelineTestExit = modal === "pipeline_pass"
      && actionPayload.target_stage === "Reference Check"
      && Array.isArray(actionPayload.stages)
      && actionPayload.stages.some((stage) => typeof stage === "object" && stage !== null && "stage" in stage && stage.stage === "Test");
    const endpoint = modal === "user"
      ? "/api/admin/users"
      : isPipelineTestExit
        ? "app_insert_pipeline_test_exit"
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
      await loadData();
      const guideContinued = continueGuideAfterSave(savedAction, result);
      if (!guideContinued) setStatus("Saved successfully.");
    } catch (saveError) {
      setStatus(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  function continueGuideAfterSave(action: PendingAction, result: RpcResult) {
    const modal = action.modal;
    const payload = action.payload;
    const resultId = typeof result.id === "string" ? result.id : undefined;

    if (modal === "requisition" && payload.mode === "new") {
      setGuideContext({
        doc_id: resultId ?? valueAsString(payload.doc_id),
        position: valueAsString(payload.position),
        department: valueAsString(payload.department),
        site: valueAsString(payload.site),
        person_in_charge: valueAsString(payload.person_in_charge)
      });
      setGuideStep("source_candidates");
      setStatus("Requisition saved. Continue with sourcing setup.");
      return true;
    }

    if (modal === "group" && guideStep === "create_group") {
      const nextContext = {
        ...guideContext,
        group_id: resultId ?? valueAsString(payload.group_id),
        group_position: valueAsString(payload.group_position) || guideContext.position
      };
      setGuideContext(nextContext);
      setGuideStep("add_match");
      setModalDefaults({
        doc_id: nextContext.doc_id ?? "",
        group_id: nextContext.group_id ?? ""
      });
      setActiveModal("match");
      setStatus("Group saved. Match it to the requisition.");
      return true;
    }

    if (modal === "match" && guideStep === "add_match") {
      setGuideContext((current) => ({
        ...current,
        doc_group_id: resultId ?? valueAsString(payload.doc_group_id)
      }));
      setGuideStep("ask_candidate");
      setStatus("Match saved. Add a candidate if you already have one.");
      return true;
    }

    if (modal === "candidate" && guideStep === "create_candidate") {
      clearGuide();
      setStatus("Candidate created and linked to the requisition group.");
      return true;
    }

    return false;
  }

  const detailBody = useMemo(() => buildDetailBody(detail, data, language, openProcessFromDetail), [detail, data, language, openProcessFromDetail]);

  if (!hasSupabaseConfig) {
    return (
      <main className="grid min-h-screen place-items-center bg-offwhite p-6">
        <Panel className="max-w-xl">
          <h1 className="mb-2 text-2xl font-extrabold text-navy">Supabase configuration required</h1>
          <p className="text-sm font-bold text-slate">Create `.env.local` from `.env.example`, then set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.</p>
        </Panel>
      </main>
    );
  }

  return (
    <AppShell
      activeView={initialView}
      language={language}
      profile={data.profile}
      onLanguageChange={() => setLanguage((current) => (current === "en" ? "th" : "en"))}
      onRefresh={loadData}
      onSignOut={signOut}
    >
      <div className="mb-4 grid gap-3 rounded-lg border border-[#D7DEE8] bg-white p-4 shadow-panel md:grid-cols-[1fr_1fr_auto]">
        <Field label="Site">
          <SelectInput value={filters.site} onChange={(event) => setFilters((old) => ({ ...old, site: event.target.value }))}>
            <option value="">All sites</option>
            {siteOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </SelectInput>
        </Field>
        <Field label="Person in Charge">
          <SelectInput value={filters.owner} onChange={(event) => setFilters((old) => ({ ...old, owner: event.target.value }))}>
            <option value="">All owners</option>
            {ownerOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </SelectInput>
        </Field>
        <div className="flex items-end">
          <Button type="button" variant="secondary" onClick={() => setFilters({ site: "", owner: "" })}>Clear</Button>
        </div>
      </div>

      <p role="status" aria-live="polite" aria-busy={loading || busy} className={`mb-4 min-h-6 text-sm font-bold ${error ? "text-orange" : "text-slate"}`}>{loading ? "Loading recruitment records..." : error ?? status}</p>

      {initialView === "home" ? (
        <HomeView language={language} profile={data.profile} requisitions={filteredRequisitions} candidates={filteredCandidates} offers={data.offers} staleSourcingGroups={staleSourcingGroups} changeLogs={filteredChangeLogs} canViewRecentActivity={role === "system_admin" || role === "admin_recruiter"} onOpenRequisition={(id) => setDetail({ type: "requisition", id })} onOpenCandidate={(id) => setDetail({ type: "candidate", id })} />
      ) : null}

      {initialView === "dashboard" ? (
        <VacancyWaterfallView language={language} data={data} requisitions={filteredRequisitions} offers={filteredOffers} />
      ) : null}

      {initialView === "requisitions" ? (
        <RequisitionsView language={language} rows={filteredRequisitions} canWrite={canWrite} onNew={() => setActiveModal("requisition")} onStatus={() => setActiveModal("status")} onOpen={(id) => setDetail({ type: "requisition", id })} />
      ) : null}

      {initialView === "candidates" ? (
        <CandidatesView language={language} rows={filteredCandidates} canWrite={canWrite} onNew={() => setActiveModal("candidate")} onProcess={() => setActiveModal("process")} onOpen={(id) => setDetail({ type: "candidate", id })} />
      ) : null}

      {initialView === "pipeline" ? (
        <PipelineBoardView language={language} rows={filteredCandidates} canWrite={canWrite} onNewCandidate={() => setActiveModal("candidate")} onAddUpdate={() => setActiveModal("process")} onOpen={(id) => setDetail({ type: "candidate", id })} onMove={openProcessForMove} onMaintainTest={openMaintainTest} onUpdateOffer={openOfferUpdate} />
      ) : null}

      {initialView === "offers" ? <OffersView language={language} rows={filteredOffers} canWrite={canWrite} onNew={() => setActiveModal("offer")} /> : null}

      {initialView === "sourcing" ? (
        <SourcingView
          language={language}
          data={data}
          profile={data.profile}
          canWrite={canWrite}
          canManageSetup={canManageSetup}
          weekStart={sourcingWeek}
          onWeekChange={setSourcingWeek}
          onSaveSourcing={(payload, summary) => prepareRpcAction("app_upsert_sourcing_weekly_update", payload, summary)}
          onGroup={() => setActiveModal("group")}
          onMatch={() => setActiveModal("match")}
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
        onValidationError={setStatus}
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

      <Drawer
        open={Boolean(detail)}
        eyebrow={detail?.type === "candidate" ? "Candidate Detail" : "Requisition Detail"}
        title={detailBody.title}
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
    const payload = {
      mode: String(formData.get("mode") ?? "new"),
      candidate_id: emptyToNull(formData.get("candidate_id")),
      name: emptyToNull(formData.get("name")),
      phone_no: emptyToNull(formData.get("phone_no")),
      doc_group_id: emptyToNull(formData.get("doc_group_id")),
      channel: emptyToNull(formData.get("channel")),
      ref_name: emptyToNull(formData.get("ref_name")),
      first_contact_date: emptyToNull(formData.get("first_contact_date")),
      candidate_folder_url: emptyToNull(formData.get("candidate_folder_url"))
    };
    requireFields(payload, ["name", "doc_group_id"]);
    return payload;
  }

  if (modal === "process") {
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      log_date: emptyToNull(formData.get("log_date")),
      recruitment_process: emptyToNull(formData.get("recruitment_process")),
      round: asNumber(formData.get("round"), 1),
      interviewer: emptyToNull(formData.get("interviewer")),
      result: emptyToNull(formData.get("result")),
      remark: emptyToNull(formData.get("remark")),
      source: emptyToNull(formData.get("source")) ?? "manual"
    };
    requireFields(payload, ["candidate_id", "log_date", "recruitment_process", "round"]);
    return payload;
  }

  if (modal === "pipeline_pass") {
    const stageCount = asNumber(formData.get("stage_count"), 0);
    const extraTestRoundCount = asNumber(formData.get("extra_test_round_count"), 0);
    const candidateId = emptyToNull(formData.get("candidate_id"));
    const stages = Array.from({ length: stageCount }, (_, index) => ({
      index,
      stage: emptyToNull(formData.get(`stage_${index}`)),
      log_date: emptyToNull(formData.get(`log_date_${index}`)),
      round: asNumber(formData.get(`round_${index}`), 1),
      interviewer: emptyToNull(formData.get(`interviewer_${index}`)),
      remark: emptyToNull(formData.get(`remark_${index}`))
    }));
    const extraTestRounds = Array.from({ length: extraTestRoundCount }, (_, index) => ({
      candidate_id: candidateId,
      log_date: emptyToNull(formData.get(`extra_test_log_date_${index}`)),
      recruitment_process: "Test",
      round: asNumber(formData.get(`extra_test_round_${index}`), 1),
      interviewer: emptyToNull(formData.get(`extra_test_interviewer_${index}`)),
      result: null,
      remark: emptyToNull(formData.get(`extra_test_remark_${index}`)),
      source: "manual"
    }));
    const payload = {
      candidate_id: candidateId,
      target_stage: emptyToNull(formData.get("target_stage")),
      stages,
      extra_test_rounds: extraTestRounds
    };
    requireFields(payload, ["candidate_id", "target_stage"]);
    if (stages.length === 0 || stages.some((stage) => !stage.stage || !stage.log_date)) {
      throw new Error("Every passed stage needs a stage and date.");
    }
    if (extraTestRounds.some((round) => !round.log_date)) {
      throw new Error("Every additional Test round needs a date.");
    }
    return payload;
  }

  if (modal === "test_maintenance") {
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      current_test: {
        log_date: emptyToNull(formData.get("current_log_date")),
        round: asNumber(formData.get("current_round"), 1),
        interviewer: emptyToNull(formData.get("current_interviewer")),
        remark: emptyToNull(formData.get("current_remark"))
      },
      next_test: {
        log_date: emptyToNull(formData.get("next_log_date")),
        round: asNumber(formData.get("next_round"), 1),
        interviewer: emptyToNull(formData.get("next_interviewer")),
        remark: emptyToNull(formData.get("next_remark"))
      }
    };
    requireFields(payload, ["candidate_id"]);
    if (!payload.current_test.log_date || !payload.next_test.log_date) {
      throw new Error("Current and next Test rounds both need a date.");
    }
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

function validateProcessUpdatePayload(data: DashboardData, payload: Record<string, unknown>) {
  const candidateId = valueAsString(payload.candidate_id);
  const selectedStage = valueAsString(payload.recruitment_process) as ProcessStage;
  const logs = latestLogsForCandidate(data, candidateId);
  const blockedReason = processUpdateBlockReason(logs);
  if (blockedReason) throw new Error(blockedReason);

  const allowedStages = availableProcessUpdateStages(logs);
  if (!allowedStages.includes(selectedStage)) {
    throw new Error("Cannot update to a previous pipeline stage.");
  }
}

function processUpdateBlockReason(logs: RecruitmentLog[]) {
  if (candidateHasHistoricalFail(logs)) return "Pipeline update unavailable because this candidate has a failed stage.";
  if (candidatePassedAllPipelineStages(logs)) return "Pipeline update unavailable because this candidate completed all stages.";
  return "";
}

function availableProcessUpdateStages(logs: RecruitmentLog[]) {
  const blockedReason = processUpdateBlockReason(logs);
  if (blockedReason) return [];
  const latest = logs[0];
  const latestIndex = PROCESS_UPDATE_STAGES.indexOf(latest?.recruitment_process as ProcessStage);
  return PROCESS_UPDATE_STAGES.filter((stage) => latestIndex === -1 || PROCESS_UPDATE_STAGES.indexOf(stage) >= latestIndex);
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
    setMode("new");
    setSelectedId(processDefaults.candidate_id ?? "");
  }, [modal, processDefaults.candidate_id]);

  if (!modal) return null;
  const selectedRecords = selectedModalRecords(data, selectedId);
  const processSubmitBlocked = modal === "process"
    && Boolean(selectedRecords.candidate)
    && Boolean(processUpdateBlockReason(latestLogsForCandidate(data, selectedRecords.candidate!.candidate_id)));

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
    <Modal open={Boolean(modal)} title={modalDialogTitle(language, modal, mode)} onClose={onClose}>
      <form key={`${modal}-${mode}-${selectedId}`} className="grid gap-4" onSubmit={handleSubmit}>
        {["requisition", "candidate", "offer", "group", "user"].includes(modal) ? <ModeRow mode={mode} onModeChange={handleModeChange} /> : null}
        {modal === "requisition" ? <RequisitionFields data={data} profile={profile} mode={mode} selectedId={selectedId} selected={selectedRecords.requisition} onSelect={setSelectedId} /> : null}
        {modal === "status" ? <StatusFields data={data} selectedId={selectedId} selected={selectedRecords.requisition} onSelect={setSelectedId} /> : null}
        {modal === "candidate" ? <CandidatePrefillFields data={data} mode={mode} selectedId={selectedId} selected={selectedRecords.candidate} defaults={modalDefaults} onSelect={setSelectedId} /> : null}
        {modal === "process" ? <ProcessPrefillFields data={data} defaults={processDefaults} selectedId={selectedId} selected={selectedRecords.candidate} onSelect={setSelectedId} /> : null}
        {modal === "pipeline_pass" ? <PipelinePassFields data={data} defaults={processDefaults} /> : null}
        {modal === "test_maintenance" ? <TestMaintenanceFields data={data} defaults={processDefaults} /> : null}
        {modal === "offer" ? <OfferPrefillFields data={data} mode={mode} selectedId={selectedId} selected={selectedRecords.offer} onSelect={setSelectedId} /> : null}
        {modal === "group" ? <GroupPrefillFields data={data} mode={mode} selectedId={selectedId} selected={selectedRecords.group} defaults={modalDefaults} onSelect={setSelectedId} /> : null}
        {modal === "match" ? <MatchFields data={data} defaults={modalDefaults} /> : null}
        {modal === "snapshot" ? <SnapshotFields data={data} /> : null}
        {modal === "user" ? <UserPrefillFields canManageUsers={canManageUsers} data={data} mode={mode} selectedId={selectedId} selected={selectedRecords.profile} onSelect={setSelectedId} /> : null}
        <div className="flex justify-end gap-2 border-t border-[#D7DEE8] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{translate(language, "cancel")}</Button>
          <Button type="submit" disabled={processSubmitBlocked}>{translate(language, "reviewChanges")}</Button>
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
  return optionLabel([row.doc_id, row.position]);
}

function candidateOptionLabel(row: DashboardData["candidates"][number]) {
  return optionLabel([row.candidate_id, row.name]);
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

function userOptionLabel(profile: DashboardData["profiles"][number]) {
  return optionLabel([profile.nickname ?? profile.full_name ?? profile.email ?? profile.id, ROLE_LABELS[profile.role]]);
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
  profile,
  mode,
  selectedId,
  selected,
  onSelect
}: {
  data: DashboardData;
  profile: DashboardData["profile"];
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["requisitions"][number] | null;
  onSelect: (value: string) => void;
}) {
  const isSiteRecruiter = profile?.role === "site_recruiter";
  const nickname = profile?.nickname ?? profile?.full_name ?? "";
  const assignedSite = profile?.site ?? "";
  const personOptions = recruiterNicknameOptions(data.profiles);
  const siteValue = isSiteRecruiter ? assignedSite : selected?.site;
  const ownerValue = isSiteRecruiter ? nickname : selected?.person_in_charge;
  const [requestType, setRequestType] = useState<RequisitionRequestType>(selected?.request_type ?? "New");
  const [replacementNames, setReplacementNames] = useState(splitReplacementNames(selected?.replacement_names));

  useEffect(() => {
    setRequestType(selected?.request_type ?? "New");
    setReplacementNames(splitReplacementNames(selected?.replacement_names));
  }, [selected?.doc_id, selected?.replacement_names, selected?.request_type]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Doc ID">
        {mode === "change" ? (
          <SelectInput name="doc_id" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">Select requisition</option>
            {data.requisitions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}
          </SelectInput>
        ) : (
          <TextInput name="doc_id" list="doc-id-options" required />
        )}
      </Field>
      <Field label="PR Approved Date"><TextInput name="pr_approved_date" type="date" defaultValue={selected?.pr_approved_date ?? ""} /></Field>
      <Field label="Request Type">
        <SelectInput name="request_type" value={requestType} onChange={(event) => setRequestType(event.target.value as RequisitionRequestType)}>
          <option value="New">New Position</option>
          <option value="Replacement">Replacement Position</option>
        </SelectInput>
      </Field>
      <Field label="Site">
        {isSiteRecruiter ? <input type="hidden" name="site" value={assignedSite} /> : null}
        <SelectInput name={isSiteRecruiter ? undefined : "site"} required defaultValue={siteValue ?? ""} disabled={isSiteRecruiter}>
          <option value="">Select site</option>
          {SITE_OPTIONS.map((site) => <option key={site} value={site}>{site}</option>)}
        </SelectInput>
      </Field>
      <Field label="Department"><TextInput name="department" list="department-options" required defaultValue={selected?.department ?? ""} /></Field>
      <Field label="Section"><TextInput name="section" list="section-options" defaultValue={selected?.section ?? ""} /></Field>
      <Field label="Position"><TextInput name="position" list="position-options" required defaultValue={selected?.position ?? ""} /></Field>
      <Field label="Level (L)">
        <SelectInput name="level" defaultValue={selected?.level ?? ""}>
          <option value="">Select level</option>
          {Array.from({ length: 15 }, (_, level) => <option key={level} value={String(level)}>{level}</option>)}
        </SelectInput>
      </Field>
      <Field label="Head Count"><TextInput name="head_count" type="number" min={1} defaultValue={selected?.head_count ?? 1} required /></Field>
      <Field label="Person in Charge">
        {isSiteRecruiter ? <input type="hidden" name="person_in_charge" value={nickname} /> : null}
        <SelectInput name={isSiteRecruiter ? undefined : "person_in_charge"} defaultValue={ownerValue ?? ""} disabled={isSiteRecruiter}>
          <option value="">Unassigned</option>
          {personOptions.map((person) => <option key={person} value={person}>{person}</option>)}
        </SelectInput>
      </Field>
      <Field label="Line Manager"><TextInput name="line_manager" list="manager-options" defaultValue={selected?.line_manager ?? ""} /></Field>
      <Field label="Status">
        <SelectInput name="status" defaultValue={selected?.status === "filled" ? "ongoing" : selected?.status ?? "ongoing"}>{WRITABLE_REQUISITION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</SelectInput>
      </Field>
      {requestType === "Replacement" ? (
        <div className="grid gap-2 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-navy">Replacement Names</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => setReplacementNames((names) => [...names, ""])}>Add replacement</Button>
          </div>
          <div className="grid gap-2">
            {replacementNames.map((name, index) => (
              <TextInput
                key={index}
                name="replacement_names"
                required={index === 0}
                placeholder={`Replacement name ${index + 1}`}
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
  selectedId,
  selected,
  onSelect
}: {
  data: DashboardData;
  selectedId: string;
  selected: DashboardData["requisitions"][number] | null;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Doc ID"><SelectInput name="doc_id" required value={selectedId} onChange={(event) => onSelect(event.target.value)}><option value="">Select requisition</option>{data.requisitions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label="Date"><TextInput name="log_date" type="date" required defaultValue={today()} /></Field>
      <Field label="Status"><SelectInput name="status" defaultValue={selected?.status ?? "ongoing"}>{["ongoing", "filled", "cancel"].map((status) => <option key={status}>{status}</option>)}</SelectInput></Field>
      <Field label="Remark" className="md:col-span-2"><TextArea name="remark" rows={3} /></Field>
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

function CandidatePrefillFields({
  data,
  mode,
  selectedId,
  selected,
  defaults,
  onSelect
}: {
  data: DashboardData;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["candidates"][number] | null;
  defaults: ModalDefaults;
  onSelect: (value: string) => void;
}) {
  const docGroupValue = mode === "new" ? defaults.doc_group_id ?? "" : selected?.doc_group_id ?? "";
  const firstContactDate = mode === "new" ? defaults.first_contact_date ?? "" : selected?.first_contact_date ?? "";
  const [selectedDocGroupId, setSelectedDocGroupId] = useState(docGroupValue);
  const [selectedChannel, setSelectedChannel] = useState(selected?.channel ?? "");
  const availableChannels = useMemo(() => sourcingChannelsForDocGroup(data, selectedDocGroupId), [data, selectedDocGroupId]);

  useEffect(() => {
    setSelectedDocGroupId(docGroupValue);
    setSelectedChannel(selected?.channel ?? "");
  }, [docGroupValue, selected?.channel]);

  useEffect(() => {
    if (selectedChannel && !availableChannels.some((channel) => channel.label === selectedChannel)) {
      setSelectedChannel("");
    }
  }, [availableChannels, selectedChannel]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Candidate ID">
        {mode === "change" ? (
          <SelectInput name="candidate_id" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">Select candidate</option>
            {data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}
          </SelectInput>
        ) : (
          <SelectInput name="candidate_id"><option value="">Auto in New mode</option>{data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}</SelectInput>
        )}
      </Field>
      <Field label="Name"><TextInput name="name" required defaultValue={selected?.name ?? ""} /></Field>
      <Field label="Phone No."><TextInput name="phone_no" defaultValue={selected?.phone_no ?? ""} /></Field>
      <Field label="Group ID">
        <SelectInput name="doc_group_id" required value={selectedDocGroupId} onChange={(event) => setSelectedDocGroupId(event.target.value)}>
          <option value="">Select group</option>
          {data.document_groups.map((row) => <option key={row.doc_group_id} value={row.doc_group_id}>{documentGroupOptionLabel(row)}</option>)}
        </SelectInput>
      </Field>
      <Field label="Channel">
        <SelectInput name="channel" value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value)} disabled={!selectedDocGroupId || availableChannels.length === 0}>
          <option value="">{availableChannels.length === 0 ? "No sourcing channels marked for this group" : "Select channel"}</option>
          {availableChannels.map((channel) => <option key={channel.enabled} value={channel.label}>{channel.label}</option>)}
        </SelectInput>
      </Field>
      <Field label="Reference Name"><TextInput name="ref_name" list="ref-options" defaultValue={selected?.ref_name ?? ""} /></Field>
      <Field label="First Contact Date"><TextInput name="first_contact_date" type="date" defaultValue={firstContactDate} /></Field>
      <Field label="Candidate Folder Link" className="md:col-span-2"><TextInput name="candidate_folder_url" type="url" defaultValue={selected?.candidate_folder_url ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function ProcessPrefillFields({
  data,
  defaults,
  selectedId,
  selected,
  onSelect
}: {
  data: DashboardData;
  defaults: ProcessDefaults;
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
      <Field label="Candidate">
        <SelectInput name="candidate_id" required value={candidateId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Select candidate</option>
          {data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}
        </SelectInput>
      </Field>
      <Field label="Date"><TextInput name="log_date" type="date" defaultValue={today()} required /></Field>
      {blockedReason ? <p className="rounded-md bg-lightgray p-3 text-sm font-bold text-orange md:col-span-2">{blockedReason}</p> : null}
      <Field label="Process">
        <SelectInput name="recruitment_process" required defaultValue={processValue} disabled={availableStages.length === 0}>
          {availableStages.length === 0 ? <option value="">No process update available</option> : null}
          {availableStages.map((stage) => <option key={stage} value={stage}>{processLabel(stage)}</option>)}
        </SelectInput>
      </Field>
      <Field label="Round"><TextInput name="round" type="number" min={1} defaultValue={defaults.round ?? latest?.round ?? 1} required /></Field>
      <Field label="Interviewer"><TextInput name="interviewer" list="interviewer-options" defaultValue={latest?.interviewer ?? ""} /></Field>
      <Field label="Result"><SelectInput name="result" defaultValue={defaults.result ?? ""}><option value="">Pending</option><option value="1">Pass</option><option value="0">Fail</option></SelectInput></Field>
      <Field label="Remark" className="md:col-span-2"><TextArea name="remark" rows={3} defaultValue={defaults.remark ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function PipelinePassFields({ data, defaults }: { data: DashboardData; defaults: ProcessDefaults }) {
  const stages = defaults.passed_stages ?? [];
  const isTestExit = stages.length === 1 && stages[0] === "Test" && defaults.target_stage === "Reference Check";
  const currentRound = defaults.current_round ?? 1;
  const [extraTestRoundCount, setExtraTestRoundCount] = useState(0);

  useEffect(() => {
    setExtraTestRoundCount(0);
  }, [defaults.candidate_id, defaults.target_stage, defaults.current_round]);

  return (
    <div className="grid gap-4">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="target_stage" value={defaults.target_stage ?? ""} />
      <input type="hidden" name="stage_count" value={stages.length} />
      <input type="hidden" name="extra_test_round_count" value={isTestExit ? extraTestRoundCount : 0} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-slate">
        Confirm each passed stage. After save, {processLabel(defaults.target_stage as ProcessStage)} will be created as Pending automatically.
      </div>
      {isTestExit ? (
        <div className="grid gap-3 rounded-md border border-[#D7DEE8] bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong className="text-sm text-navy">Additional Test Rounds</strong>
              <p className="mt-1 text-xs font-medium text-slate">Added rounds are saved as Pending before the candidate leaves Test.</p>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => setExtraTestRoundCount((count) => count + 1)}>Add Test Round</Button>
          </div>
          {Array.from({ length: extraTestRoundCount }, (_, index) => {
            const round = currentRound + index + 1;
            return (
              <div key={index} className="grid gap-4 rounded-md border border-[#D7DEE8] bg-lightgray/70 p-3 md:grid-cols-2">
                <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                  <Tag tone="teal">Test</Tag>
                  <Tag tone="muted">Round {round}</Tag>
                  <Tag tone="warning">Pending</Tag>
                </div>
                <Field label="Date"><TextInput name={`extra_test_log_date_${index}`} type="date" defaultValue={today()} required /></Field>
                <Field label="Round"><TextInput name={`extra_test_round_${index}`} type="number" min={1} defaultValue={round} required /></Field>
                <Field label="Interviewer"><TextInput name={`extra_test_interviewer_${index}`} list="interviewer-options" /></Field>
                <Field label="Remark"><TextArea name={`extra_test_remark_${index}`} rows={2} defaultValue="Additional Test round before moving forward" /></Field>
              </div>
            );
          })}
        </div>
      ) : null}
      {stages.map((stage, index) => (
        <div key={stage} className="grid gap-4 rounded-md border border-[#D7DEE8] bg-white p-3 md:grid-cols-2">
          <input type="hidden" name={`stage_${index}`} value={stage} />
          <div className="md:col-span-2">
            <Tag tone="teal">{processLabel(stage)}</Tag>
          </div>
          <Field label="Date"><TextInput name={`log_date_${index}`} type="date" defaultValue={today()} required /></Field>
          <Field label="Round"><TextInput name={`round_${index}`} type="number" min={1} value={isTestExit && stage === "Test" ? currentRound : undefined} defaultValue={isTestExit && stage === "Test" ? undefined : 1} readOnly={isTestExit && stage === "Test"} required /></Field>
          <Field label="Interviewer"><TextInput name={`interviewer_${index}`} list="interviewer-options" /></Field>
          <Field label="Remark"><TextArea name={`remark_${index}`} rows={2} defaultValue={index === stages.length - 1 ? defaults.remark ?? "" : ""} /></Field>
        </div>
      ))}
      <DataLists data={data} />
    </div>
  );
}

function TestMaintenanceFields({ data, defaults }: { data: DashboardData; defaults: ProcessDefaults }) {
  const currentRound = defaults.current_round ?? defaults.round ?? 1;
  const nextRound = currentRound + 1;

  return (
    <div className="grid gap-4">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-medium text-slate">
        Save the current Test round as Pass, then create the next Test round as Pending.
      </div>
      <div className="grid gap-4 rounded-md border border-[#D7DEE8] bg-white p-3 md:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Tag tone="teal">Current Test</Tag>
          <Tag tone="muted">Round {currentRound}</Tag>
          <Tag tone="success">Pass</Tag>
        </div>
        <Field label="Date"><TextInput name="current_log_date" type="date" defaultValue={today()} required /></Field>
        <Field label="Round"><TextInput name="current_round" type="number" min={1} value={currentRound} readOnly required /></Field>
        <Field label="Interviewer"><TextInput name="current_interviewer" list="interviewer-options" /></Field>
        <Field label="Remark"><TextArea name="current_remark" rows={2} defaultValue="Current Test round passed; maintaining candidate in Test." /></Field>
      </div>
      <div className="grid gap-4 rounded-md border border-[#D7DEE8] bg-lightgray/70 p-3 md:grid-cols-2">
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Tag tone="teal">Next Test</Tag>
          <Tag tone="muted">Round {nextRound}</Tag>
          <Tag tone="warning">Pending</Tag>
        </div>
        <Field label="Date"><TextInput name="next_log_date" type="date" defaultValue={today()} required /></Field>
        <Field label="Round"><TextInput name="next_round" type="number" min={1} value={nextRound} readOnly required /></Field>
        <Field label="Interviewer"><TextInput name="next_interviewer" list="interviewer-options" /></Field>
        <Field label="Remark"><TextArea name="next_remark" rows={2} defaultValue="Next Test round pending." /></Field>
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

function MatchFields({ data, defaults }: { data: DashboardData; defaults: ModalDefaults }) {
  const matchedDocIds = new Set(data.document_groups.map((group) => group.doc_id));
  const docOptions = data.requisitions.filter((row) => !matchedDocIds.has(row.doc_id) || row.doc_id === defaults.doc_id);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Doc ID"><SelectInput name="doc_id" required defaultValue={defaults.doc_id ?? ""}>{docOptions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}</SelectInput></Field>
      <Field label="Group ID"><SelectInput name="group_id" required defaultValue={defaults.group_id ?? ""}>{data.position_groups.map((row) => <option key={row.group_id} value={row.group_id}>{positionGroupOptionLabel(row)}</option>)}</SelectInput></Field>
    </div>
  );
}

function SnapshotFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Week Start"><TextInput name="week_start" type="date" defaultValue={currentWeekStart()} required /></Field>
      <Field label="Category">
        <SelectInput name="waterfall_category">
          {["Week Start", "Open", "Filled", "Total"].map((category) => <option key={category} value={category}>{category}</option>)}
        </SelectInput>
      </Field>
      <Field label="Site">
        <SelectInput name="site" required>
          <option value="">Select site</option>
          {SITE_OPTIONS.map((site) => <option key={site} value={site}>{site}</option>)}
        </SelectInput>
      </Field>
      <Field label="Request Type">
        <SelectInput name="request_type">
          <option value="New">New</option>
          <option value="Replacement">Replacement</option>
        </SelectInput>
      </Field>
      <Field label="Vacancy Count"><TextInput name="vacancy_count" type="number" defaultValue={0} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function UserFields({ canManageUsers, data }: { canManageUsers: boolean; data: DashboardData }) {
  if (!canManageUsers) return <p className="text-sm font-bold text-orange">Only system admins can manage app accounts.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Existing User">
        <SelectInput name="user_id">
          <option value="">Required in Change mode</option>
          {data.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{userOptionLabel(profile)}</option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Email"><TextInput name="email" type="email" /></Field>
      <Field label="Temporary Password"><TextInput name="password" type="password" minLength={8} /></Field>
      <Field label="Nickname / Account Name"><TextInput name="nickname" list="pic-options-form" required /></Field>
      <Field label="Full Name"><TextInput name="full_name" /></Field>
      <Field label="Assigned Site"><TextInput name="site" list="site-options-form" /></Field>
      <Field label="Role"><SelectInput name="role">{ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</SelectInput></Field>
      <DataLists data={data} />
    </div>
  );
}

function OfferPrefillFields({
  data,
  mode,
  selectedId,
  selected,
  onSelect
}: {
  data: DashboardData;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["offers"][number] | null;
  onSelect: (value: string) => void;
}) {
  const offeredCandidateIds = new Set(data.offers.map((offer) => offer.candidate_id));
  const eligibleCandidates = data.candidates.filter((candidate) => hasLatestOfferPass(data, candidate.candidate_id) && !offeredCandidateIds.has(candidate.candidate_id));
  const selectedCandidate = selected ? data.candidates.find((candidate) => candidate.candidate_id === selected.candidate_id) : null;
  const candidateOptions = selectedCandidate && !eligibleCandidates.some((candidate) => candidate.candidate_id === selectedCandidate.candidate_id)
    ? [...eligibleCandidates, selectedCandidate]
    : eligibleCandidates;
  const [selectedCandidateId, setSelectedCandidateId] = useState(selected?.candidate_id ?? "");
  const [selectedDocId, setSelectedDocId] = useState(selected?.doc_id ?? "");
  const docOptions = mode === "change" && selected?.doc_id
    ? data.requisitions.filter((row) => row.doc_id === selected.doc_id)
    : availableOfferDocOptions(data, selectedCandidateId, selectedDocId);

  useEffect(() => {
    setSelectedCandidateId(selected?.candidate_id ?? "");
    setSelectedDocId(selected?.doc_id ?? "");
  }, [selected?.candidate_id, selected?.doc_id]);

  useEffect(() => {
    if (mode === "change") return;
    if (selectedDocId && !docOptions.some((row) => row.doc_id === selectedDocId)) {
      setSelectedDocId("");
    }
  }, [docOptions, mode, selectedDocId]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {mode === "change" ? (
        <Field label="Existing Offer">
          <SelectInput name="offer_selector" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">Select offer</option>
            {data.offers.map((offer) => <option key={offer.offer_id} value={offer.offer_id}>{offerOptionLabel(data, offer)}</option>)}
          </SelectInput>
        </Field>
      ) : null}
      {mode === "change" ? <input type="hidden" name="candidate_id" value={selected?.candidate_id ?? ""} /> : null}
      <Field label="Candidate">
        <SelectInput name={mode === "change" ? undefined : "candidate_id"} required value={selectedCandidateId} disabled={mode === "change"} onChange={(event) => {
          setSelectedCandidateId(event.target.value);
          setSelectedDocId("");
        }}>
          <option value="">Select Offer Pass candidate</option>
          {candidateOptions.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{candidateOptionLabel(row)}</option>)}
        </SelectInput>
      </Field>
      {mode === "change" ? <input type="hidden" name="doc_id" value={selected?.doc_id ?? ""} /> : null}
      <Field label="Doc ID">
        <SelectInput name={mode === "change" ? undefined : "doc_id"} required value={selectedDocId} disabled={mode === "change" || !selectedCandidateId} onChange={(event) => setSelectedDocId(event.target.value)}>
          <option value="">{selectedCandidateId ? "Select requisition" : "Select candidate first"}</option>
          {docOptions.map((row) => <option key={row.doc_id} value={row.doc_id}>{requisitionOptionLabel(row)}</option>)}
        </SelectInput>
      </Field>
      <Field label="Accepted Date"><TextInput name="accepted_date" type="date" defaultValue={selected?.accepted_date ?? ""} /></Field>
      <Field label="First Working Date"><TextInput name="first_working_date" type="date" defaultValue={selected?.first_working_date ?? ""} /></Field>
      <Field label="Remark" className="md:col-span-2"><TextArea name="remark" rows={3} defaultValue={selected?.remark ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function availableOfferDocOptions(data: DashboardData, candidateId: string, currentDocId = "") {
  if (!candidateId) return [];
  const candidate = data.candidates.find((row) => row.candidate_id === candidateId);
  if (!candidate) return [];
  const candidateMatch = data.document_groups.find((row) => row.doc_group_id === candidate.doc_group_id);
  if (!candidateMatch) return [];
  const matchedDocIds = new Set(
    data.document_groups
      .filter((row) => candidateMatch.group_id ? row.group_id === candidateMatch.group_id : row.doc_group_id === candidateMatch.doc_group_id)
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
  mode,
  selectedId,
  selected,
  defaults,
  onSelect
}: {
  data: DashboardData;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["position_groups"][number] | null;
  defaults: ModalDefaults;
  onSelect: (value: string) => void;
}) {
  const groupPositionValue = mode === "new" ? defaults.group_position ?? "" : selected?.group_position ?? "";

  return (
    <div className="grid gap-4">
      <Field label="Group ID">
        {mode === "change" ? (
          <SelectInput name="group_id" required value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">Select group</option>
            {data.position_groups.map((row) => <option key={row.group_id} value={row.group_id}>{positionGroupOptionLabel(row)}</option>)}
          </SelectInput>
        ) : (
          <SelectInput name="group_id"><option value="">Auto in New mode</option>{data.position_groups.map((row) => <option key={row.group_id} value={row.group_id}>{positionGroupOptionLabel(row)}</option>)}</SelectInput>
        )}
      </Field>
      <Field label="Group Position"><TextInput name="group_position" list="group-position-options" required defaultValue={groupPositionValue} /></Field>
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
  mode,
  selectedId,
  selected,
  onSelect
}: {
  canManageUsers: boolean;
  data: DashboardData;
  mode: "new" | "change";
  selectedId: string;
  selected: DashboardData["profiles"][number] | null;
  onSelect: (value: string) => void;
}) {
  if (!canManageUsers) return <p className="text-sm font-bold text-orange">Only system admins can manage app accounts.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {mode === "change" ? <Field label="Existing User">
        <SelectInput name="user_id" required={mode === "change"} value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Select user</option>
          {data.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{userOptionLabel(profile)}</option>
          ))}
        </SelectInput>
      </Field> : null}
      <Field label="Email"><TextInput name="email" type="email" defaultValue={selected?.email ?? ""} /></Field>
      <Field label="Temporary Password"><TextInput name="password" type="password" minLength={8} /></Field>
      <Field label="Nickname / Account Name"><TextInput name="nickname" list="pic-options-form" required defaultValue={selected?.nickname ?? ""} /></Field>
      <Field label="Full Name"><TextInput name="full_name" defaultValue={selected?.full_name ?? ""} /></Field>
      <Field label="Assigned Site">
        <SelectInput name="site" defaultValue={selected?.site ?? ""}>
          <option value="">No assigned site</option>
          {SITE_OPTIONS.map((site) => <option key={site} value={site}>{site}</option>)}
        </SelectInput>
      </Field>
      <Field label="Role"><SelectInput name="role" defaultValue={selected?.role ?? "viewer"}>{ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</SelectInput></Field>
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

  return (
    <Modal open={open} title={translate(language, "welcomeBack")} onClose={onClose} width="max-w-xl">
      <div className="grid gap-4">
        <p className="text-sm font-bold text-slate">{translate(language, "welcomeBackMessage").replace("{name}", name)}</p>
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
      <span className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <p className="text-xs font-extrabold uppercase tracking-normal text-slate">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-primary">{formatNumber(value, language)}</p>
    </div>
  );
}

function buildWelcomeSummary(
  requisitions: EnrichedRequisition[],
  candidates: EnrichedCandidate[],
  offers: DashboardData["offers"],
  profile: DashboardData["profile"]
): WelcomeSummary {
  const responsibleRequisitions = responsibleRows(requisitions, profile);
  const responsibleCandidates = responsibleRows(candidates, profile);
  const offerCandidateIds = new Set(offers.map((offer) => offer.candidate_id));
  const actionableRequisitions = responsibleRequisitions.filter((row) => row.status !== "filled" && row.status !== "cancel" && row.open_headcount > 0);
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
    offerFinalizationNeeded
  };
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
            <p className="text-navy">{context.doc_id} - {context.position}</p>
            <p className="mt-1">{translate(language, "guideSourceCandidatesMessage")}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onLater}>{translate(language, "later")}</Button>
            <Button type="button" className="ring-4 ring-primary/20" onClick={onCreateGroup}>{translate(language, "newGroup")}</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title={translate(language, "guideHaveCandidateQuestion")} onClose={onLater} width="max-w-lg">
      <div className="grid gap-4">
        <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3 text-sm font-bold text-slate">
          <p className="text-navy">{context.doc_id} - {context.group_position ?? context.position}</p>
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

function buildDetailBody(detail: { type: "requisition" | "candidate"; id: string } | null, data: DashboardData, language: Language, onUpdateCandidate: (candidateId: string) => void) {
  if (!detail) return { title: "Detail", body: null };

  if (detail.type === "requisition") {
    const requisition = enrichRequisitions(data).find((row) => row.doc_id === detail.id);
    if (!requisition) return { title: "Requisition", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
    const groups = data.document_groups.filter((row) => row.doc_id === requisition.doc_id);
    const positionGroupIds = new Set(groups.map((row) => row.group_id).filter(Boolean) as string[]);
    const relatedDocGroupIds = positionGroupIds.size > 0
      ? new Set(data.document_groups.filter((row) => row.group_id && positionGroupIds.has(row.group_id)).map((row) => row.doc_group_id))
      : new Set(groups.map((row) => row.doc_group_id));
    const candidates = enrichCandidates(data).filter((row) => relatedDocGroupIds.has(row.doc_group_id));
    const offers = data.offers.filter((row) => row.doc_id === requisition.doc_id);
    const applicantTotal = applicantCountForPositionGroups(data, positionGroupIds);
    const funnelRows = buildPipelineFunnelRows(applicantTotal, historicalPipelineCountsForCandidates(data, candidates.map((row) => row.candidate_id)));

    return {
      title: `${requisition.doc_id} · ${requisition.position}`,
      body: (
        <div className="grid gap-5">
          <DetailGrid rows={[
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
          <DetailList title="Candidates" rows={candidates.map((row) => optionLabel([row.candidate_id, row.name, processLabel(row.latest_process)]))} />
          <DetailList title="Offers" rows={offers.map((row) => `${row.candidate_id} · accepted ${formatDate(row.accepted_date)}`)} />
        </div>
      )
    };
  }

  const candidate = enrichCandidates(data).find((row) => row.candidate_id === detail.id);
  if (!candidate) return { title: "Candidate", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
  const logs = latestLogsForCandidate(data, candidate.candidate_id);
  const offers = data.offers.filter((row) => row.candidate_id === candidate.candidate_id);
  const updateBlockedReason = processUpdateBlockReason(logs);

  return {
    title: `${candidate.candidate_id} · ${candidate.name}`,
    body: (
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-normal text-slate">Pipeline Action</p>
            {updateBlockedReason ? <p className="mt-1 text-sm font-bold text-orange">{updateBlockedReason}</p> : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={Boolean(updateBlockedReason)}
            onClick={() => onUpdateCandidate(candidate.candidate_id)}
          >
            Update
          </Button>
        </div>
        <DetailGrid rows={[
          ["Phone", candidate.phone_no ?? "-"],
          ["Group ID", candidate.group_id ?? candidate.doc_group_id],
          ["Doc IDs", candidate.doc_id ?? "-"],
          ["Group Position", candidate.group_position ?? "-"],
          ["Site", candidate.site ?? "-"],
          ["Owner", candidate.person_in_charge ?? "-"],
          ["Channel", candidate.channel ?? "-"],
          ["Reference", candidate.ref_name ?? "-"],
          ["Folder", candidate.candidate_folder_url ? "Open candidate folder" : "-"],
          ["Latest Result", resultText(candidate.latest_result)]
        ]} />
        {candidate.candidate_folder_url ? (
          <a className="text-sm font-extrabold text-primary underline" href={candidate.candidate_folder_url} target="_blank" rel="noreferrer">Open candidate folder</a>
        ) : null}
        <CandidateJourney logs={logs} />
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-extrabold text-navy">Timeline</h4>
          </div>
          <div className="grid gap-2">
            {logs.length === 0 ? <p className="text-sm font-bold text-slate">No process logs yet.</p> : logs.map((log) => (
              <div key={log.log_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-navy">{processLabel(log.recruitment_process)}</strong>
                  <Tag tone={statusTone(resultText(log.result).toLowerCase())}>{resultText(log.result)}</Tag>
                </div>
                <p className="mt-1 text-sm font-bold text-slate">{formatDate(log.log_date)} · Round {log.round} · {log.interviewer ?? "No interviewer"}</p>
                {log.remark ? <p className="mt-1 text-sm text-slate">{log.remark}</p> : null}
              </div>
            ))}
          </div>
        </div>
        <DetailList title="Offers" rows={offers.map((row) => `${row.doc_id} · accepted ${formatDate(row.accepted_date)} · start ${formatDate(row.first_working_date)}`)} />
      </div>
    )
  };
}

function replacementNamesDisplay(value: string | null | undefined) {
  const names = splitReplacementNames(value).filter(Boolean);
  return names.length > 0 ? names.join(", ") : "-";
}

function CandidateJourney({ logs }: { logs: RecruitmentLog[] }) {
  return <StageRail logs={logs} label="Candidate Pipeline Journey" />;
}

type PipelineFunnelCount = {
  stage: ProcessStage;
  count: number;
};

function historicalPipelineCountsForCandidates(data: DashboardData, candidateIds: string[]): PipelineFunnelCount[] {
  const relatedCandidateIds = new Set(candidateIds);
  return ACTIVE_PIPELINE_STAGES.map((stage) => {
    const stageCandidateIds = new Set(
      data.recruitment_logs
        .filter((log) => relatedCandidateIds.has(log.candidate_id) && log.recruitment_process === stage)
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

function buildPipelineFunnelRows(applicantTotal: number, stageCounts: PipelineFunnelCount[]): PipelineFunnelRow[] {
  const baseRows = [
    { key: "applicants", label: "Applicants", count: applicantTotal },
    ...stageCounts.map((row) => ({ key: row.stage, label: processLabel(row.stage), count: row.count }))
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
    <dl className="grid gap-3 rounded-lg border border-[#D7DEE8] bg-lightgray p-4 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-extrabold uppercase tracking-normal text-slate">{label}</dt>
          <dd className="mt-1 font-bold text-navy">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <h4 className="mb-2 font-extrabold text-navy">{title}</h4>
      <div className="grid gap-2">
        {rows.length === 0 ? (
          <p className="text-sm font-bold text-slate">No records.</p>
        ) : (
          rows.map((row) => <div key={row} className="rounded-md border border-[#D7DEE8] bg-white p-3 text-sm font-bold text-slate shadow-sm">{row}</div>)
        )}
      </div>
    </div>
  );
}

function hasLatestOfferPass(data: DashboardData, candidateId: string) {
  const latest = latestLogsForCandidate(data, candidateId)[0];
  return latest?.recruitment_process === "Offer" && latest.result === 1;
}

function modalTitle(modal: ModalName) {
  const titles: Record<Exclude<ModalName, null>, string> = {
    requisition: "Requisition",
    status: "Requisition Status",
    candidate: "Candidate",
    process: "Process Update",
    pipeline_pass: "Confirm Passed Stages",
    test_maintenance: "Maintain Test Round",
    offer: "Offer",
    group: "Position Group",
    match: "Match Requisition and Group",
    snapshot: "Vacancy Snapshot",
    user: "Manage User"
  };
  return modal ? titles[modal] : "";
}

function modalDialogTitle(language: Language, modal: ModalName, mode: "new" | "change") {
  if (!modal) return "";
  const editableLabels: Partial<Record<Exclude<ModalName, null>, string>> = {
    requisition: "Requisition",
    candidate: "Candidate",
    offer: "Offer",
    group: "Position Group",
    user: "User"
  };
  const label = editableLabels[modal];
  if (!label) return modalTitle(modal);
  const action = mode === "change" ? translate(language, "edit") : translate(language, "create");
  return `${action} ${label}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentWeekStart() {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function readWorkspaceUrlState() {
  if (typeof window === "undefined") {
    return { language: null, site: null, owner: null, hasFilterParams: false } as const;
  }
  const params = new URLSearchParams(window.location.search);
  const language = params.get("lang");
  const parsedLanguage: Language | null = language === "en" || language === "th" ? language : null;
  return {
    language: parsedLanguage,
    site: params.get("site"),
    owner: params.get("pic"),
    hasFilterParams: params.has("site") || params.has("pic")
  };
}

function replaceQueryParams(values: Record<string, string | null | undefined>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

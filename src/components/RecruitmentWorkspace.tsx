"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AuditView } from "@/components/audit/AuditView";
import { CandidatesView } from "@/components/candidates/CandidatesView";
import { DashboardOverviewView } from "@/components/dashboard/DashboardOverviewView";
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
import { Tag } from "@/components/ui/Tag";
import { ACTIVE_PIPELINE_STAGES, canManageSetup as canManageSetupRole, canManageUsers as canManageUsersRole, canWrite as canWriteRole, PROCESS_UPDATE_STAGES, processLabel, ROLE_LABELS, ROLES, WRITABLE_REQUISITION_STATUSES } from "@/lib/constants";
import {
  emptyDashboardData,
  enrichCandidates,
  enrichOffers,
  enrichRequisitions,
  filterByText,
  latestLogsForCandidate,
  loadDashboardData,
  uniqueValues
} from "@/lib/data";
import { boolFromForm, emptyToNull, formatDate, resultText, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { hasSupabaseConfig, supabase } from "@/lib/supabase/client";
import { asNumber, requireFields } from "@/lib/validation/forms";
import type {
  DashboardData,
  EnrichedCandidate,
  Language,
  ProcessStage,
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
  route?: "rpc" | "api";
};

type ProcessDefaults = {
  candidate_id?: string;
  recruitment_process?: string;
  target_stage?: string;
  source?: string;
  remark?: string;
  passed_stages?: ProcessStage[];
};

const rpcByModal: Record<Exclude<ModalName, null | "user">, string> = {
  requisition: "app_upsert_requisition",
  status: "app_insert_requisition_log",
  candidate: "app_upsert_candidate",
  process: "app_insert_recruitment_log",
  pipeline_pass: "app_insert_pipeline_passes",
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
  const [detail, setDetail] = useState<{ type: "requisition" | "candidate"; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
    setLanguage((localStorage.getItem("recruitment_lang") as Language | null) ?? "en");
    const savedFilters = localStorage.getItem("recruitment_filters");
    if (savedFilters) setFilters(JSON.parse(savedFilters) as { site: string; owner: string });
    loadData();
  }, [loadData]);

  useEffect(() => {
    localStorage.setItem("recruitment_lang", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("recruitment_filters", JSON.stringify(filters));
  }, [filters]);

  const role = data.profile?.role ?? "viewer";
  const canWrite = canWriteRole(role);
  const canManageSetup = canManageSetupRole(role);
  const canManageUsers = canManageUsersRole(role);
  const canManageSnapshots = role === "system_admin" || role === "admin_recruiter";

  const enrichedRequisitions = useMemo(() => enrichRequisitions(data), [data]);
  const enrichedCandidates = useMemo(() => enrichCandidates(data), [data]);
  const enrichedOffers = useMemo(() => enrichOffers(data), [data]);

  const filteredRequisitions = useMemo(() => filterByText(enrichedRequisitions, filters), [enrichedRequisitions, filters]);
  const filteredCandidates = useMemo(() => filterByText(enrichedCandidates, filters), [enrichedCandidates, filters]);
  const filteredOffers = useMemo(() => filterByText(enrichedOffers, filters), [enrichedOffers, filters]);

  const siteOptions = uniqueValues(enrichedRequisitions.map((row) => row.site));
  const ownerOptions = uniqueValues(enrichedRequisitions.map((row) => row.person_in_charge));

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  function openProcessForMove(candidate: EnrichedCandidate, nextStage: ProcessStage) {
    const currentIndex = ACTIVE_PIPELINE_STAGES.indexOf(candidate.latest_process as ProcessStage);
    const targetIndex = ACTIVE_PIPELINE_STAGES.indexOf(nextStage);
    if (currentIndex === -1 || targetIndex <= currentIndex) return;
    const passedStages = ACTIVE_PIPELINE_STAGES.slice(currentIndex, targetIndex);
    setProcessDefaults({
      candidate_id: candidate.candidate_id,
      target_stage: nextStage,
      source: "pipeline",
      passed_stages: passedStages,
      remark: `Progressed from ${processLabel(candidate.latest_process)} to ${processLabel(nextStage)} by pipeline drag and drop`
    });
    setActiveModal("pipeline_pass");
  }

  function prepareAction(modal: Exclude<ModalName, null>, form: HTMLFormElement) {
    const formData = new FormData(form);
    const payload = buildPayload(modal, formData);
    const summary = buildSummary(modal, payload);

    setPendingAction({
      title: "Confirm Save",
      summary,
      endpoint: modal === "user" ? "/api/admin/users" : rpcByModal[modal],
      payload,
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

    setBusy(true);
    setStatus("Saving...");
    try {
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
        const result = (await response.json()) as RpcResult;
        if (!response.ok || result.error) throw new Error(result.error ?? "User creation failed.");
      } else {
        const { error: rpcError } = await supabase.rpc(pendingAction.endpoint, { payload: pendingAction.payload });
        if (rpcError) throw new Error(rpcError.message);
      }

      setPendingAction(null);
      setActiveModal(null);
      setProcessDefaults({});
      setStatus("Saved successfully.");
      await loadData();
    } catch (saveError) {
      setStatus(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  const detailBody = useMemo(() => buildDetailBody(detail, data), [detail, data]);

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
          <TextInput list="site-options" value={filters.site} placeholder="All sites" onChange={(event) => setFilters((old) => ({ ...old, site: event.target.value }))} />
        </Field>
        <Field label="Person in Charge">
          <TextInput list="owner-options" value={filters.owner} placeholder="All owners" onChange={(event) => setFilters((old) => ({ ...old, owner: event.target.value }))} />
        </Field>
        <div className="flex items-end">
          <Button type="button" variant="secondary" onClick={() => setFilters({ site: "", owner: "" })}>Clear</Button>
        </div>
        <datalist id="site-options">{siteOptions.map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id="owner-options">{ownerOptions.map((value) => <option key={value} value={value} />)}</datalist>
      </div>

      <p className={`mb-4 min-h-6 text-sm font-bold ${error ? "text-orange" : "text-slate"}`}>{loading ? "Loading recruitment records..." : error ?? status}</p>

      {initialView === "dashboard" ? (
        <DashboardOverviewView language={language} profile={data.profile} requisitions={filteredRequisitions} candidates={filteredCandidates} vacancySnapshots={data.vacancy_weekly_snapshots} changeLogs={data.change_logs} onOpenRequisition={(id) => setDetail({ type: "requisition", id })} onOpenCandidate={(id) => setDetail({ type: "candidate", id })} />
      ) : null}

      {initialView === "requisitions" ? (
        <RequisitionsView language={language} rows={filteredRequisitions} canWrite={canWrite} onNew={() => setActiveModal("requisition")} onStatus={() => setActiveModal("status")} onOpen={(id) => setDetail({ type: "requisition", id })} />
      ) : null}

      {initialView === "candidates" ? (
        <CandidatesView language={language} rows={filteredCandidates} canWrite={canWrite} onNew={() => setActiveModal("candidate")} onProcess={() => setActiveModal("process")} onOpen={(id) => setDetail({ type: "candidate", id })} />
      ) : null}

      {initialView === "pipeline" ? (
        <PipelineBoardView language={language} rows={filteredCandidates} canWrite={canWrite} onNewCandidate={() => setActiveModal("candidate")} onAddUpdate={() => setActiveModal("process")} onOpen={(id) => setDetail({ type: "candidate", id })} onMove={openProcessForMove} />
      ) : null}

      {initialView === "offers" ? <OffersView language={language} rows={filteredOffers} canWrite={canWrite} onNew={() => setActiveModal("offer")} /> : null}

      {initialView === "sourcing" ? (
        <SourcingView
          language={language}
          data={data}
          profile={data.profile}
          canWrite={canWrite}
          canManageSetup={canManageSetup}
          canManageUsers={canManageUsers}
          canManageSnapshots={canManageSnapshots}
          weekStart={sourcingWeek}
          onWeekChange={setSourcingWeek}
          onSaveSourcing={(payload, summary) => prepareRpcAction("app_upsert_sourcing_weekly_update", payload, summary)}
          onGroup={() => setActiveModal("group")}
          onMatch={() => setActiveModal("match")}
          onInvite={() => setActiveModal("user")}
          onSnapshot={() => setActiveModal("snapshot")}
        />
      ) : null}

      {initialView === "audit" ? <AuditView language={language} rows={data.change_logs} /> : null}

      <RecordModal
        modal={activeModal}
        data={data}
        profile={data.profile}
        canManageUsers={canManageUsers}
        processDefaults={processDefaults}
        onClose={() => {
          setActiveModal(null);
          setProcessDefaults({});
        }}
        onSubmit={prepareAction}
        onValidationError={setStatus}
      />

      <ConfirmModal
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
      status: String(formData.get("status") ?? "ongoing") as RequisitionStatus
    };
    requireFields(payload, ["doc_id", "site", "position", "department", "head_count"]);
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
      first_contact_date: emptyToNull(formData.get("first_contact_date"))
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
    const stages = Array.from({ length: stageCount }, (_, index) => ({
      index,
      stage: emptyToNull(formData.get(`stage_${index}`)),
      log_date: emptyToNull(formData.get(`log_date_${index}`)),
      round: asNumber(formData.get(`round_${index}`), 1),
      interviewer: emptyToNull(formData.get(`interviewer_${index}`)),
      remark: emptyToNull(formData.get(`remark_${index}`))
    }));
    const payload = {
      candidate_id: emptyToNull(formData.get("candidate_id")),
      target_stage: emptyToNull(formData.get("target_stage")),
      stages
    };
    requireFields(payload, ["candidate_id", "target_stage"]);
    if (stages.length === 0 || stages.some((stage) => !stage.stage || !stage.log_date)) {
      throw new Error("Every passed stage needs a stage and date.");
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
      offered_type: emptyToNull(formData.get("offered_type")),
      replaced: emptyToNull(formData.get("replaced")),
      remark: emptyToNull(formData.get("remark"))
    };
    requireFields(payload, ["candidate_id", "doc_id"]);
    return payload;
  }

  if (modal === "group") {
    const payload = {
      mode: String(formData.get("mode") ?? "new"),
      group_id: emptyToNull(formData.get("group_id")),
      group_position: emptyToNull(formData.get("group_position")),
      channel_fb: boolFromForm(formData.get("channel_fb")),
      channel_jobthai: boolFromForm(formData.get("channel_jobthai")),
      channel_jobtopgun: boolFromForm(formData.get("channel_jobtopgun")),
      channel_jobdb: boolFromForm(formData.get("channel_jobdb"))
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

function buildSummary(modal: Exclude<ModalName, null>, payload: Record<string, unknown>) {
  const key = String(payload.doc_id ?? payload.candidate_id ?? payload.group_id ?? payload.target_stage ?? payload.email ?? payload.user_id ?? "record");
  return `${modal} · ${key}`;
}

function RecordModal({
  modal,
  data,
  profile,
  canManageUsers,
  processDefaults,
  onClose,
  onSubmit,
  onValidationError
}: {
  modal: ModalName;
  data: DashboardData;
  profile: DashboardData["profile"];
  canManageUsers: boolean;
  processDefaults: ProcessDefaults;
  onClose: () => void;
  onSubmit: (modal: Exclude<ModalName, null>, form: HTMLFormElement) => void;
  onValidationError: (message: string) => void;
}) {
  if (!modal) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onSubmit(modal as Exclude<ModalName, null>, event.currentTarget);
    } catch (error) {
      onValidationError(error instanceof Error ? error.message : "Form validation failed.");
    }
  }

  return (
    <Modal open={Boolean(modal)} title={modalTitle(modal)} onClose={onClose}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        {["requisition", "candidate", "offer", "group", "user"].includes(modal) ? <ModeRow /> : null}
        {modal === "requisition" ? <RequisitionFields data={data} profile={profile} /> : null}
        {modal === "status" ? <StatusFields data={data} /> : null}
        {modal === "candidate" ? <CandidateFields data={data} /> : null}
        {modal === "process" ? <ProcessFields data={data} defaults={processDefaults} /> : null}
        {modal === "pipeline_pass" ? <PipelinePassFields data={data} defaults={processDefaults} /> : null}
        {modal === "offer" ? <OfferFields data={data} /> : null}
        {modal === "group" ? <GroupFields data={data} /> : null}
        {modal === "match" ? <MatchFields data={data} /> : null}
        {modal === "snapshot" ? <SnapshotFields data={data} /> : null}
        {modal === "user" ? <UserFields canManageUsers={canManageUsers} data={data} /> : null}
        <div className="flex justify-end gap-2 border-t border-[#D7DEE8] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Review Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ModeRow() {
  return (
    <div className="flex flex-wrap gap-3 rounded-md bg-lightgray p-3 text-sm font-bold text-navy">
      <label className="flex items-center gap-2"><input type="radio" name="mode" value="new" defaultChecked /> New</label>
      <label className="flex items-center gap-2"><input type="radio" name="mode" value="change" /> Change</label>
    </div>
  );
}

function RequisitionFields({ data, profile }: { data: DashboardData; profile: DashboardData["profile"] }) {
  const isSiteRecruiter = profile?.role === "site_recruiter";
  const nickname = profile?.nickname ?? profile?.full_name ?? "";
  const assignedSite = profile?.site ?? "";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Doc ID"><TextInput name="doc_id" list="doc-id-options" required /></Field>
      <Field label="PR Approved Date"><TextInput name="pr_approved_date" type="date" /></Field>
      <Field label="Site"><TextInput name="site" list="site-options-form" required defaultValue={isSiteRecruiter ? assignedSite : undefined} readOnly={isSiteRecruiter} /></Field>
      <Field label="Position"><TextInput name="position" list="position-options" required /></Field>
      <Field label="Department"><TextInput name="department" list="department-options" required /></Field>
      <Field label="Section"><TextInput name="section" list="section-options" /></Field>
      <Field label="Level"><TextInput name="level" list="level-options" /></Field>
      <Field label="Head Count"><TextInput name="head_count" type="number" min={1} defaultValue={1} required /></Field>
      <Field label="Person in Charge"><TextInput name="person_in_charge" list="pic-options-form" defaultValue={isSiteRecruiter ? nickname : undefined} readOnly={isSiteRecruiter} /></Field>
      <Field label="Line Manager"><TextInput name="line_manager" list="manager-options" /></Field>
      <Field label="Status">
        <SelectInput name="status">{WRITABLE_REQUISITION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</SelectInput>
      </Field>
      <DataLists data={data} />
    </div>
  );
}

function StatusFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Doc ID"><SelectInput name="doc_id" required>{data.requisitions.map((row) => <option key={row.doc_id}>{row.doc_id}</option>)}</SelectInput></Field>
      <Field label="Date"><TextInput name="log_date" type="date" required defaultValue={today()} /></Field>
      <Field label="Status"><SelectInput name="status">{["ongoing", "filled", "cancel"].map((status) => <option key={status}>{status}</option>)}</SelectInput></Field>
      <Field label="Remark" className="md:col-span-2"><TextArea name="remark" rows={3} /></Field>
    </div>
  );
}

function CandidateFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Candidate ID"><SelectInput name="candidate_id"><option value="">Auto in New mode</option>{data.candidates.map((row) => <option key={row.candidate_id}>{row.candidate_id}</option>)}</SelectInput></Field>
      <Field label="Name"><TextInput name="name" required /></Field>
      <Field label="Phone No."><TextInput name="phone_no" /></Field>
      <Field label="Group ID"><SelectInput name="doc_group_id" required>{data.document_groups.map((row) => <option key={row.doc_group_id} value={row.doc_group_id}>{row.doc_group_id} · {row.group_position}</option>)}</SelectInput></Field>
      <Field label="Channel"><TextInput name="channel" list="channel-options" /></Field>
      <Field label="Reference Name"><TextInput name="ref_name" list="ref-options" /></Field>
      <Field label="First Contact Date"><TextInput name="first_contact_date" type="date" /></Field>
      <DataLists data={data} />
    </div>
  );
}

function ProcessFields({ data, defaults }: { data: DashboardData; defaults: ProcessDefaults }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="source" value={defaults.source ?? "manual"} />
      <Field label="Candidate"><SelectInput name="candidate_id" required defaultValue={defaults.candidate_id}>{data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{row.candidate_id} · {row.name}</option>)}</SelectInput></Field>
      <Field label="Date"><TextInput name="log_date" type="date" defaultValue={today()} required /></Field>
      <Field label="Process"><SelectInput name="recruitment_process" required defaultValue={defaults.recruitment_process}>{PROCESS_UPDATE_STAGES.map((stage) => <option key={stage} value={stage}>{processLabel(stage)}</option>)}</SelectInput></Field>
      <Field label="Round"><TextInput name="round" type="number" min={1} defaultValue={1} required /></Field>
      <Field label="Interviewer"><TextInput name="interviewer" list="interviewer-options" /></Field>
      <Field label="Result"><SelectInput name="result"><option value="">Pending</option><option value="1">Pass</option><option value="0">Fail</option></SelectInput></Field>
      <Field label="Remark" className="md:col-span-2"><TextArea name="remark" rows={3} defaultValue={defaults.remark ?? ""} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function PipelinePassFields({ data, defaults }: { data: DashboardData; defaults: ProcessDefaults }) {
  const stages = defaults.passed_stages ?? [];

  return (
    <div className="grid gap-4">
      <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />
      <input type="hidden" name="target_stage" value={defaults.target_stage ?? ""} />
      <input type="hidden" name="stage_count" value={stages.length} />
      <div className="rounded-md bg-lightgray p-3 text-sm font-bold text-slate">
        Confirm each passed stage. After save, {processLabel(defaults.target_stage as ProcessStage)} will be created as Pending automatically.
      </div>
      {stages.map((stage, index) => (
        <div key={stage} className="grid gap-4 rounded-md border border-[#D7DEE8] p-3 md:grid-cols-2">
          <input type="hidden" name={`stage_${index}`} value={stage} />
          <div className="md:col-span-2">
            <Tag tone="teal">{processLabel(stage)}</Tag>
          </div>
          <Field label="Date"><TextInput name={`log_date_${index}`} type="date" defaultValue={today()} required /></Field>
          <Field label="Round"><TextInput name={`round_${index}`} type="number" min={1} defaultValue={1} required /></Field>
          <Field label="Interviewer"><TextInput name={`interviewer_${index}`} list="interviewer-options" /></Field>
          <Field label="Remark"><TextArea name={`remark_${index}`} rows={2} defaultValue={index === stages.length - 1 ? defaults.remark ?? "" : ""} /></Field>
        </div>
      ))}
      <DataLists data={data} />
    </div>
  );
}

function OfferFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Candidate"><SelectInput name="candidate_id" required>{data.candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{row.candidate_id} · {row.name}</option>)}</SelectInput></Field>
      <Field label="Doc ID"><SelectInput name="doc_id" required>{data.requisitions.map((row) => <option key={row.doc_id}>{row.doc_id}</option>)}</SelectInput></Field>
      <Field label="Accepted Date"><TextInput name="accepted_date" type="date" /></Field>
      <Field label="First Working Date"><TextInput name="first_working_date" type="date" /></Field>
      <Field label="Offer Type"><TextInput name="offered_type" list="offer-type-options" /></Field>
      <Field label="Replaced"><TextInput name="replaced" list="replaced-options" /></Field>
      <Field label="Remark" className="md:col-span-2"><TextArea name="remark" rows={3} /></Field>
      <DataLists data={data} />
    </div>
  );
}

function GroupFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4">
      <Field label="Group ID"><SelectInput name="group_id"><option value="">Auto in New mode</option>{data.position_groups.map((row) => <option key={row.group_id}>{row.group_id}</option>)}</SelectInput></Field>
      <Field label="Group Position"><TextInput name="group_position" list="group-position-options" required /></Field>
      <div className="grid gap-2 rounded-md bg-lightgray p-3 text-sm font-bold text-navy md:grid-cols-4">
        <label className="flex items-center gap-2"><input name="channel_fb" type="checkbox" /> Facebook</label>
        <label className="flex items-center gap-2"><input name="channel_jobthai" type="checkbox" /> JobThai</label>
        <label className="flex items-center gap-2"><input name="channel_jobtopgun" type="checkbox" /> JobTopGun</label>
        <label className="flex items-center gap-2"><input name="channel_jobdb" type="checkbox" /> JobDB</label>
      </div>
      <DataLists data={data} />
    </div>
  );
}

function MatchFields({ data }: { data: DashboardData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Doc ID"><SelectInput name="doc_id" required>{data.requisitions.map((row) => <option key={row.doc_id} value={row.doc_id}>{row.doc_id}</option>)}</SelectInput></Field>
      <Field label="Group ID"><SelectInput name="group_id" required>{data.position_groups.map((row) => <option key={row.group_id} value={row.group_id}>{row.group_id} · {row.group_position}</option>)}</SelectInput></Field>
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
      <Field label="Site"><TextInput name="site" list="site-options-form" required /></Field>
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
            <option key={profile.id} value={profile.id}>{profile.nickname ?? profile.full_name ?? profile.email ?? profile.id}</option>
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
      <datalist id="offer-type-options">{uniqueValues(data.offers.map((row) => row.offered_type)).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="replaced-options">{uniqueValues(data.offers.map((row) => row.replaced)).map((value) => <option key={value} value={value} />)}</datalist>
    </>
  );
}

function ConfirmModal({
  action,
  busy,
  onClose,
  onConfirm
}: {
  action: PendingAction | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={Boolean(action)} title={action?.title ?? "Confirm Save"} onClose={onClose} width="max-w-lg">
      <div className="grid gap-4">
        <p className="text-sm font-bold text-slate">{action?.summary}</p>
        <pre className="max-h-72 overflow-auto rounded-md bg-lightgray p-3 text-xs text-navy">{JSON.stringify(action?.payload ?? {}, null, 2)}</pre>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>Confirm</Button>
        </div>
      </div>
    </Modal>
  );
}

function buildDetailBody(detail: { type: "requisition" | "candidate"; id: string } | null, data: DashboardData) {
  if (!detail) return { title: "Detail", body: null };

  if (detail.type === "requisition") {
    const requisition = enrichRequisitions(data).find((row) => row.doc_id === detail.id);
    if (!requisition) return { title: "Requisition", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
    const groups = data.document_groups.filter((row) => row.doc_id === requisition.doc_id);
    const groupIds = new Set(groups.map((row) => row.doc_group_id));
    const candidates = enrichCandidates(data).filter((row) => groupIds.has(row.doc_group_id));
    const offers = data.offers.filter((row) => row.doc_id === requisition.doc_id);

    return {
      title: `${requisition.doc_id} · ${requisition.position}`,
      body: (
        <div className="grid gap-5">
          <DetailGrid rows={[
            ["Site", requisition.site],
            ["Department", requisition.department],
            ["Section", requisition.section ?? "-"],
            ["Owner", requisition.person_in_charge ?? "-"],
            ["Line Manager", requisition.line_manager ?? "-"],
            ["Headcount", String(requisition.head_count)],
            ["Accepted", String(requisition.accepted_count)],
            ["Open", String(requisition.open_headcount)]
          ]} />
          <DetailList title="Candidates" rows={candidates.map((row) => `${row.candidate_id} · ${row.name} · ${row.latest_process}`)} />
          <DetailList title="Offers" rows={offers.map((row) => `${row.candidate_id} · accepted ${formatDate(row.accepted_date)}`)} />
        </div>
      )
    };
  }

  const candidate = enrichCandidates(data).find((row) => row.candidate_id === detail.id);
  if (!candidate) return { title: "Candidate", body: <p className="text-sm font-bold text-slate">Record not found.</p> };
  const logs = latestLogsForCandidate(data, candidate.candidate_id);
  const offers = data.offers.filter((row) => row.candidate_id === candidate.candidate_id);

  return {
    title: `${candidate.candidate_id} · ${candidate.name}`,
    body: (
      <div className="grid gap-5">
        <DetailGrid rows={[
          ["Phone", candidate.phone_no ?? "-"],
          ["Doc ID", candidate.doc_id ?? "-"],
          ["Group", candidate.group_position ?? "-"],
          ["Site", candidate.site ?? "-"],
          ["Owner", candidate.person_in_charge ?? "-"],
          ["Channel", candidate.channel ?? "-"],
          ["Reference", candidate.ref_name ?? "-"],
          ["Latest Result", resultText(candidate.latest_result)]
        ]} />
        <div>
          <h4 className="mb-2 font-extrabold text-navy">Timeline</h4>
          <div className="grid gap-2">
            {logs.length === 0 ? <p className="text-sm font-bold text-slate">No process logs yet.</p> : logs.map((log) => (
              <div key={log.log_id} className="rounded-md border border-[#D7DEE8] p-3">
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

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-3 rounded-lg bg-lightgray p-4 sm:grid-cols-2">
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
          rows.map((row) => <div key={row} className="rounded-md border border-[#D7DEE8] p-3 text-sm font-bold text-slate">{row}</div>)
        )}
      </div>
    </div>
  );
}

function modalTitle(modal: ModalName) {
  const titles: Record<Exclude<ModalName, null>, string> = {
    requisition: "Requisition",
    status: "Requisition Status",
    candidate: "Candidate",
    process: "Process Update",
    pipeline_pass: "Confirm Passed Stages",
    offer: "Offer",
    group: "Position Group",
    match: "Match Requisition and Group",
    snapshot: "Vacancy Snapshot",
    user: "Manage User"
  };
  return modal ? titles[modal] : "";
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

import { expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import type { DashboardData, Language, Role } from "../../../src/types/recruitment";

type MockUserRole = Role;

type MockSupabaseOptions = {
  language?: Language | null;
  role?: MockUserRole;
};

export type MockRpcCall = {
  endpoint: string;
  payload: Record<string, unknown>;
};

export type MockSupabaseContext = {
  data: DashboardData;
  rpcCalls: MockRpcCall[];
};

const roleUserIds: Record<MockUserRole, string> = {
  system_admin: "qa-system",
  admin_recruiter: "qa-admin",
  site_recruiter: "qa-site",
  viewer: "qa-viewer"
};

export async function installMockSupabase(page: Page, options: MockSupabaseOptions = {}): Promise<MockSupabaseContext> {
  const role = options.role ?? "admin_recruiter";
  const language = options.language === undefined ? "en" : options.language;
  const data = createRecruitmentDataset(role);
  const rpcCalls: MockRpcCall[] = [];
  const supabaseUrl = readPublicSupabaseUrl();
  const storageKey = supabaseStorageKey(supabaseUrl);
  const userId = roleUserIds[role];
  const userEmail = `${role.replace("_", ".")}@qa.example.com`;

  await page.addInitScript(
    ({ key, id, email, language: savedLanguage }) => {
      window.localStorage.setItem(key, JSON.stringify({
        access_token: "qa-access-token",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        refresh_token: "qa-refresh-token",
        user: {
          id,
          aud: "authenticated",
          role: "authenticated",
          email,
          app_metadata: {},
          user_metadata: {}
        }
      }));
      if (savedLanguage) window.localStorage.setItem("recruitment_lang", savedLanguage);
    },
    { key: storageKey, id: userId, email: userEmail, language }
  );

  await page.route("**/auth/v1/user", async (route) => {
    await json(route, {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: userEmail,
      app_metadata: {},
      user_metadata: {}
    });
  });

  await page.route("**/rest/v1/rpc/**", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const body = route.request().postDataJSON() as { payload?: Record<string, unknown> } | undefined;
    const payload = body?.payload ?? {};
    rpcCalls.push({ endpoint, payload });
    applyRpcMutation(data, endpoint, payload);
    await json(route, { ok: true, id: generatedIdForEndpoint(endpoint) });
  });

  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/rpc/")) return route.fallback();
    const table = url.pathname.split("/").at(-1) ?? "";
    const rows = tableRows(data, table);
    await json(route, applyRestQuery(rows, url));
  });

  return { data, rpcCalls };
}

export async function expectWorkspaceReady(page: Page) {
  const header = page.locator("[data-app-header-actions]");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  await expect(header.getByLabel("Site", { exact: true })).toBeVisible();
  await expect(header.getByLabel("Person in Charge", { exact: true })).toBeVisible();
  await expect(page.getByText("Loading recruitment records...")).toHaveCount(0);
}

function createRecruitmentDataset(activeRole: MockUserRole): DashboardData {
  const profiles = [
    profile("qa-system", "system@example.com", "System Admin", "System", null, "system_admin"),
    profile("qa-admin", "admin@example.com", "Alice Admin", "Alice", null, "admin_recruiter"),
    profile("qa-site", "site@example.com", "Bob Site", "Bob", "KT1", "site_recruiter"),
    profile("qa-viewer", "viewer@example.com", "Victor Viewer", "Victor", null, "viewer")
  ];

  return {
    profile: profiles.find((item) => item.id === roleUserIds[activeRole]) ?? profiles[1],
    profiles,
    requisitions: [
      requisition("REQ-HQ-1", "HQ", "Engineer", "Operations", "Alice", 5, "2026-06-01"),
      requisition("REQ-HQ-2", "HQ", "Engineer", "Operations", "Alice", 1, "2026-06-10"),
      requisition("REQ-KT1-1", "KT1", "Technician", "Production", "Bob", 3, "2026-06-03"),
      requisition("REQ-KT2-1", "KT2", "Analyst", "Planning", "Alice", 2, "2026-06-05"),
      requisition("REQ-CLOSED-1", "HQ", "Closed Role", "Operations", "Alice", 1, "2026-06-07", "filled")
    ],
    requisition_logs: [],
    position_groups: [
      positionGroup("GRP-ENG", "Engineer"),
      positionGroup("GRP-TECH", "Technician"),
      positionGroup("GRP-ANL", "Analyst")
    ],
    document_groups: [
      documentGroup("DG-HQ-ENG", "REQ-HQ-1", "GRP-ENG", "Engineer"),
      documentGroup("DG-HQ2-ENG", "REQ-HQ-2", "GRP-ENG", "Engineer"),
      documentGroup("DG-KT1-TECH", "REQ-KT1-1", "GRP-TECH", "Technician"),
      documentGroup("DG-KT2-ANL", "REQ-KT2-1", "GRP-ANL", "Analyst"),
      documentGroup("DG-CLOSED", "REQ-CLOSED-1", "GRP-CLOSED", "Closed Role")
    ],
    candidates: [
      candidate("C-PHONE", "Pat Phone", "DG-HQ-ENG", "Facebook", "2026-06-20"),
      candidate("C-AGING", "Avery Aging", "DG-HQ-ENG", "JobThai", "2026-06-01"),
      candidate("C-HR", "Hana HR", "DG-HQ-ENG", "Referral", "2026-06-21"),
      candidate("C-LINE", "Liam Line", "DG-KT1-TECH", "Walk-in", "2026-06-22"),
      candidate("C-TEST", "Tina Test", "DG-KT1-TECH", "JobDB", "2026-06-23"),
      candidate("C-REF", "Rae Reference", "DG-KT2-ANL", "LinkedIn", "2026-06-24"),
      candidate("C-OFFER", "Owen Offer", "DG-KT2-ANL", "LinkedIn", "2026-06-25"),
      candidate("C-OFFER-READY", "Nina Offer Ready", "DG-HQ-ENG", "Referral", "2026-07-01"),
      candidate("C-FAILED", "Finn Failed", "DG-HQ-ENG", "Facebook", "2026-06-26"),
      candidate("C-OFFER-PASS", "Olivia Offer Pass", "DG-KT1-TECH", "Referral", "2026-06-27"),
      candidate("C-NO-ACTIVITY", "Nora No Activity", "DG-KT2-ANL", "Others", "2026-06-28")
    ],
    recruitment_logs: [
      log(1, "C-PHONE", "Phone Screen", null, 1, "2026-07-09"),
      log(2, "C-AGING", "Phone Screen", null, 1, "2026-06-25"),
      log(3, "C-HR", "Phone Screen", 1, 1, "2026-07-01"),
      log(4, "C-HR", "HR Interview", null, 1, "2026-07-09"),
      log(5, "C-LINE", "HR Interview", 1, 1, "2026-07-02"),
      log(6, "C-LINE", "Line Interview", null, 1, "2026-07-09"),
      log(7, "C-TEST", "Line Interview", 1, 1, "2026-07-03"),
      log(8, "C-TEST", "Test", null, 1, "2026-07-09"),
      log(9, "C-REF", "Test", 1, 1, "2026-07-04"),
      log(10, "C-REF", "Reference Check", null, 1, "2026-07-09"),
      log(11, "C-OFFER", "Reference Check", 1, 1, "2026-07-05"),
      log(12, "C-OFFER", "Offer", null, 1, "2026-07-09"),
      log(13, "C-FAILED", "Phone Screen", 1, 1, "2026-07-04"),
      log(14, "C-FAILED", "HR Interview", 0, 1, "2026-07-17"),
      log(15, "C-OFFER-PASS", "Phone Screen", 1, 1, "2026-07-01"),
      log(16, "C-OFFER-PASS", "HR Interview", 1, 1, "2026-07-02"),
      log(17, "C-OFFER-PASS", "Line Interview", 1, 1, "2026-07-03"),
      log(18, "C-OFFER-PASS", "Test", 1, 1, "2026-07-04"),
      log(19, "C-OFFER-PASS", "Reference Check", 1, 1, "2026-07-05"),
      log(20, "C-OFFER-PASS", "Offer", 1, 1, "2026-07-17"),
      log(21, "C-OFFER-READY", "Offer", null, 1, "2026-07-11")
    ],
    offers: [
      offer(1, "C-OFFER", "REQ-KT2-1", null, null),
      offer(2, "C-OFFER-PASS", "REQ-KT1-1", "2026-07-17", "2026-07-20")
    ],
    sourcing_weekly_updates: [
      sourcingUpdate("GRP-ENG", "2026-06-29", 8),
      sourcingUpdate("GRP-TECH", "2026-06-29", 4),
      sourcingUpdate("GRP-ENG", "2026-07-06", 12),
      sourcingUpdate("GRP-TECH", "2026-07-06", 7),
      sourcingUpdate("GRP-ANL", "2026-07-06", 5)
    ],
    vacancy_weekly_snapshots: [],
    change_logs: [
      {
        log_id: 1,
        entity: "recruitment_logs",
        entity_id: "16",
        action: "insert",
        changed_at: "2026-07-10T09:00:00",
        changed_by: "qa-admin",
        changed_by_email: "admin@example.com",
        old_data: null,
        new_data: { candidate_id: "C-OFFER-PASS" }
      }
    ]
  };
}

function applyRpcMutation(data: DashboardData, endpoint: string, payload: Record<string, unknown>) {
  if (endpoint === "app_insert_pipeline_passes" || endpoint === "app_insert_pipeline_test_exit") {
    const candidateId = String(payload.candidate_id ?? "");
    const stages = Array.isArray(payload.stages) ? payload.stages as Array<Record<string, unknown>> : [];
    for (const stage of stages) {
      data.recruitment_logs.push(log(
        nextLogId(data),
        candidateId,
        String(stage.stage) as never,
        1,
        Number(stage.round ?? 1),
        String(stage.log_date ?? "2026-07-11")
      ));
    }
  }
  if (endpoint === "app_insert_test_maintenance") {
    const candidateId = String(payload.candidate_id ?? "");
    const nextTest = payload.next_test as Record<string, unknown> | undefined;
    data.recruitment_logs.push(log(nextLogId(data), candidateId, "Test", null, Number(nextTest?.round ?? 2), String(nextTest?.log_date ?? "2026-07-11")));
  }
  if (endpoint === "app_insert_recruitment_log") {
    data.recruitment_logs.push(log(
      nextLogId(data),
      String(payload.candidate_id ?? ""),
      String(payload.recruitment_process ?? "Phone Screen") as never,
      payload.result === "1" || payload.result === 1 ? 1 : payload.result === "0" || payload.result === 0 ? 0 : null,
      Number(payload.round ?? 1),
      String(payload.log_date ?? "2026-07-11")
    ));
  }
}

function tableRows(data: DashboardData, table: string) {
  const tables: Record<string, unknown[]> = {
    profiles: data.profiles,
    requisitions: data.requisitions,
    requisition_logs: data.requisition_logs,
    position_groups: data.position_groups,
    document_groups: data.document_groups,
    candidates: data.candidates,
    recruitment_logs: data.recruitment_logs,
    offers: data.offers,
    sourcing_weekly_updates: data.sourcing_weekly_updates,
    vacancy_weekly_snapshots: data.vacancy_weekly_snapshots,
    change_logs: data.change_logs
  };
  return tables[table] ?? [];
}

function applyRestQuery(rows: unknown[], url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? rows.length);
  return rows.slice(0, Number.isFinite(limit) ? limit : rows.length);
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*"
    },
    body: JSON.stringify(body),
    status: 200
  });
}

function readPublicSupabaseUrl() {
  const envPath = path.join(process.cwd(), ".env.local");
  const file = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  return process.env.NEXT_PUBLIC_SUPABASE_URL
    ?? file.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "")
    ?? "https://qa.supabase.co";
}

function supabaseStorageKey(url: string) {
  const host = new URL(url).hostname;
  const projectRef = host.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

function generatedIdForEndpoint(endpoint: string) {
  if (endpoint.includes("candidate")) return "C-GENERATED";
  if (endpoint.includes("requisition")) return "REQ-GENERATED";
  if (endpoint.includes("group")) return "GRP-GENERATED";
  return "QA-GENERATED";
}

function nextLogId(data: DashboardData) {
  return Math.max(0, ...data.recruitment_logs.map((item) => item.log_id)) + 1;
}

function profile(id: string, email: string, fullName: string, nickname: string, site: string | null, role: Role) {
  return { id, email, full_name: fullName, nickname, site, role, created_at: "2026-06-01T00:00:00", updated_at: "2026-07-01T00:00:00" };
}

function requisition(docId: string, site: string, position: string, department: string, owner: string, headCount: number, date: string, status: "ongoing" | "filled" | "cancel" = "ongoing") {
  return {
    doc_id: docId,
    pr_approved_date: date,
    site,
    position,
    department,
    section: "QA",
    level: "L4",
    head_count: headCount,
    person_in_charge: owner,
    line_manager: "QA Manager",
    request_type: "New" as const,
    replacement_names: null,
    status,
    created_at: `${date}T00:00:00`,
    updated_at: `${date}T00:00:00`
  };
}

function positionGroup(groupId: string, groupPosition: string) {
  return {
    group_id: groupId,
    group_position: groupPosition,
    channel_fb: true,
    channel_jobthai: true,
    channel_jobtopgun: false,
    channel_jobdb: true,
    channel_linkedin: true,
    channel_walkin: true,
    channel_referral: true,
    channel_others: true,
    created_at: "2026-06-01T00:00:00",
    updated_at: "2026-07-01T00:00:00"
  };
}

function documentGroup(docGroupId: string, docId: string, groupId: string, groupPosition: string) {
  return {
    doc_group_id: docGroupId,
    doc_id: docId,
    group_id: groupId,
    group_position: groupPosition,
    channel_fb: true,
    channel_jobthai: true,
    channel_jobtopgun: false,
    channel_jobdb: true,
    channel_linkedin: true,
    channel_walkin: true,
    channel_referral: true,
    channel_others: true,
    created_at: "2026-06-01T00:00:00",
    updated_at: "2026-07-01T00:00:00"
  };
}

function candidate(candidateId: string, name: string, docGroupId: string, channel: string, date: string) {
  return {
    candidate_id: candidateId,
    name,
    phone_no: "0800000000",
    doc_group_id: docGroupId,
    channel,
    ref_name: null,
    first_contact_date: date,
    candidate_folder_url: `https://example.com/${candidateId}`,
    created_at: `${date}T00:00:00`,
    updated_at: `${date}T00:00:00`
  };
}

function log(logId: number, candidateId: string, stage: DashboardData["recruitment_logs"][number]["recruitment_process"], result: 0 | 1 | null, round: number, date: string) {
  return {
    log_id: logId,
    candidate_id: candidateId,
    log_date: date,
    recruitment_process: stage,
    round,
    interviewer: "QA Interviewer",
    result,
    remark: `QA ${stage}`,
    created_at: `${date}T09:00:00`
  };
}

function offer(offerId: number, candidateId: string, docId: string, acceptedDate: string | null, firstWorkingDate: string | null) {
  return {
    offer_id: offerId,
    candidate_id: candidateId,
    doc_id: docId,
    accepted_date: acceptedDate,
    first_working_date: firstWorkingDate,
    remark: null,
    created_at: "2026-07-01T00:00:00",
    updated_at: "2026-07-01T00:00:00"
  };
}

function sourcingUpdate(groupId: string, weekStart: string, applicants: number) {
  return {
    group_id: groupId,
    week_start: weekStart,
    channel_fb: true,
    channel_jobthai: true,
    channel_jobtopgun: false,
    channel_jobdb: false,
    channel_linkedin: false,
    channel_walkin: false,
    channel_referral: false,
    channel_others: false,
    applicants_fb: applicants,
    applicants_jobthai: 0,
    applicants_jobtopgun: 0,
    applicants_jobdb: 0,
    applicants_linkedin: 0,
    applicants_walkin: 0,
    applicants_referral: 0,
    applicants_others: 0,
    updated_by: "qa-admin",
    created_at: "2026-07-06T00:00:00",
    updated_at: "2026-07-06T00:00:00"
  };
}

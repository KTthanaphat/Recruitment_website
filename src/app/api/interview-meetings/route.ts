import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const editableStatuses = ["creating", "scheduled", "rescheduling", "failed"];

function normalizedEmails(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((email): email is string => typeof email === "string").map((email) => email.trim().toLowerCase()).filter((email) => emailPattern.test(email)))] : [];
}

export async function POST(request: NextRequest) {
  let meetingId: string | null = null;
  try {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = await request.json() as Record<string, unknown>;
    const operation = payload.operation === "reschedule" || payload.operation === "cancel" ? payload.operation : "create";
    const interviewerEmails = normalizedEmails(payload.interviewer_emails);
    if (!token || typeof payload.candidate_id !== "string" || typeof payload.stage_instance_id !== "string") return NextResponse.json({ ok: false, error: "Invalid Teams meeting request." }, { status: 400 });

    const service = createServiceClient();
    const { data: auth } = await service.auth.getUser(token);
    if (!auth.user) return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401 });
    const [{ data: profile }, { data: candidate }, { data: stage }] = await Promise.all([
      service.from("profiles").select("role,site,nickname,full_name").eq("id", auth.user.id).single(),
      service.from("candidates").select("candidate_id,name,email,group_id,doc_group_id").eq("candidate_id", payload.candidate_id).single(),
      service.from("recruitment_logs").select("candidate_id,stage_instance_id,recruitment_process,result,superseded_at").eq("stage_instance_id", payload.stage_instance_id).single()
    ]);
    if (!profile || profile.role === "viewer" || !candidate || !stage || stage.candidate_id !== candidate.candidate_id || stage.result !== null || stage.superseded_at || !["HR Interview", "Line Interview"].includes(stage.recruitment_process)) return NextResponse.json({ ok: false, error: "Only pending HR or Line interviews can be scheduled." }, { status: 403 });
    if (!candidate.email || !emailPattern.test(candidate.email)) return NextResponse.json({ ok: false, error: "A valid candidate email is required before scheduling." }, { status: 400 });

    if (profile.role === "site_recruiter") {
      const { data: matches } = candidate.group_id ? await service.from("document_groups").select("doc_id").eq("group_id", candidate.group_id) : await service.from("document_groups").select("doc_id").eq("doc_group_id", candidate.doc_group_id);
      const docIds = (matches ?? []).map((match) => match.doc_id);
      const { data: requisitions } = docIds.length ? await service.from("requisitions").select("site,person_in_charge").in("doc_id", docIds) : { data: [] as Array<{ site: string; person_in_charge: string | null }> };
      const names = [profile.nickname, profile.full_name].filter((name): name is string => Boolean(name?.trim())).map((name) => name.trim().toLowerCase());
      if (!(requisitions ?? []).some((row) => row.site === profile.site && !!row.person_in_charge && names.includes(row.person_in_charge.trim().toLowerCase()))) return NextResponse.json({ ok: false, error: "You can schedule interviews only for candidates you manage." }, { status: 403 });
    }

    const startsAt = typeof payload.starts_at === "string" ? Date.parse(payload.starts_at) : NaN;
    const endsAt = typeof payload.ends_at === "string" ? Date.parse(payload.ends_at) : NaN;
    if (operation !== "cancel" && (interviewerEmails.length === 0 || Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt)) return NextResponse.json({ ok: false, error: "Enter a valid Bangkok schedule and at least one interviewer email." }, { status: 400 });

    const existingId = typeof payload.meeting_id === "string" ? payload.meeting_id : null;
    let meeting: { meeting_id: string; teams_event_id: string | null } | null = null;
    if (operation === "create") {
      const { data: activeMeeting, error: activeError } = await service.from("interview_meetings").select("meeting_id").eq("stage_instance_id", stage.stage_instance_id).in("status", editableStatuses).maybeSingle();
      if (activeError) throw new Error(activeError.message);
      if (activeMeeting) return NextResponse.json({ ok: false, error: "This interview already has a meeting. Use reschedule instead." }, { status: 409 });
      const { data, error } = await service.from("interview_meetings").insert({ candidate_id: candidate.candidate_id, stage_instance_id: stage.stage_instance_id, stage: stage.recruitment_process, starts_at: payload.starts_at, ends_at: payload.ends_at, interviewer_emails: interviewerEmails, note: typeof payload.note === "string" ? payload.note.trim() || null : null, status: "creating", created_by: auth.user.id }).select("meeting_id,teams_event_id").single();
      if (error || !data) throw new Error(error?.message ?? "Could not create the meeting record.");
      meeting = data;
    } else {
      if (!existingId) return NextResponse.json({ ok: false, error: "Meeting ID is required." }, { status: 400 });
      const { data, error } = await service.from("interview_meetings").select("meeting_id,teams_event_id,status,stage_instance_id").eq("meeting_id", existingId).eq("candidate_id", candidate.candidate_id).single();
      if (error || !data || data.stage_instance_id !== stage.stage_instance_id || data.status === "cancelled") return NextResponse.json({ ok: false, error: "Meeting was not found." }, { status: 404 });
      meeting = data;
      const update = operation === "cancel" ? { status: "cancelling", failure_summary: null } : { status: "rescheduling", starts_at: payload.starts_at, ends_at: payload.ends_at, interviewer_emails: interviewerEmails, note: typeof payload.note === "string" ? payload.note.trim() || null : null, failure_summary: null };
      const { error: updateError } = await service.from("interview_meetings").update(update).eq("meeting_id", meeting.meeting_id);
      if (updateError) throw new Error(updateError.message);
    }

    meetingId = meeting.meeting_id;
    const url = process.env.POWER_AUTOMATE_TEAMS_MEETING_WEBHOOK_URL;
    const secret = process.env.POWER_AUTOMATE_TEAMS_MEETING_WEBHOOK_SECRET;
    const mailbox = process.env.POWER_AUTOMATE_TEAMS_MEETING_SHARED_MAILBOX;
    if (!url || !secret || !mailbox) throw new Error("Teams meeting automation is not configured.");
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-teams-meeting-secret": secret }, body: JSON.stringify({ operation, meeting_id: meeting.meeting_id, teams_event_id: meeting.teams_event_id, shared_mailbox: mailbox, candidate_id: candidate.candidate_id, stage_instance_id: stage.stage_instance_id, candidate_email: candidate.email, interviewer_emails: interviewerEmails, starts_at: payload.starts_at, ends_at: payload.ends_at, stage: stage.recruitment_process, subject: `${stage.recruitment_process}: ${candidate.name}`, note: typeof payload.note === "string" ? payload.note.trim() : "" }), signal: AbortSignal.timeout(15000) });
    const flow = await response.json().catch(() => ({})) as { ok?: boolean; teams_event_id?: string; join_url?: string; flow_run_id?: string; error?: string };
    if (!response.ok || !flow.ok || (operation !== "cancel" && (!flow.teams_event_id || !flow.join_url))) throw new Error(flow.error ?? "Power Automate could not update the Teams meeting.");
    const finalUpdate = operation === "cancel" ? { status: "cancelled", join_url: null, flow_run_id: flow.flow_run_id ?? null, failure_summary: null } : { status: "scheduled", organizer_mailbox: mailbox, teams_event_id: flow.teams_event_id, join_url: flow.join_url, flow_run_id: flow.flow_run_id ?? null, failure_summary: null };
    const { error: finalError } = await service.from("interview_meetings").update(finalUpdate).eq("meeting_id", meeting.meeting_id);
    if (finalError) throw new Error(finalError.message);
    return NextResponse.json({ ok: true, meeting_id: meeting.meeting_id, join_url: flow.join_url ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Could not update Teams meeting.";
    if (meetingId) { try { await createServiceClient().from("interview_meetings").update({ status: "failed", failure_summary: message }).eq("meeting_id", meetingId); } catch {} }
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

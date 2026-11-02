import { NextRequest, NextResponse } from "next/server";
import { escapeLetterHtml } from "@/lib/rejection-letter";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let draftId: string | null = null;
  try {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Missing authorization token." }, { status: 401 });
    const payload = await request.json() as Record<string, string>;
    if (!payload.candidate_id || !payload.failed_stage_instance_id || !payload.template_id || !emailPattern.test(payload.recipient_email ?? "") || !payload.subject?.trim() || !payload.body?.trim()) return NextResponse.json({ ok: false, error: "Invalid rejection-letter email payload." }, { status: 400 });
    const service = createServiceClient();
    const { data: userData, error: userError } = await service.auth.getUser(token);
    if (userError || !userData.user) return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401 });
    const userId = userData.user.id;
    const [{ data: profile }, { data: candidate }, { data: failure }, { data: template }] = await Promise.all([
      service.from("profiles").select("role,site,nickname,full_name").eq("id", userId).single(),
      service.from("candidates").select("candidate_id,group_id,doc_group_id").eq("candidate_id", payload.candidate_id).single(),
      service.from("recruitment_logs").select("candidate_id,application_id,stage_instance_id,result,superseded_at").eq("stage_instance_id", payload.failed_stage_instance_id).single(),
      service.from("rejection_letter_templates").select("template_id,version,language,active").eq("template_id", payload.template_id).single()
    ]);
    if (!profile || profile.role === "viewer" || !candidate || !failure || failure.candidate_id !== candidate.candidate_id || failure.result !== 0 || failure.superseded_at || !template?.active || template.language !== payload.language) return NextResponse.json({ ok: false, error: "You cannot send an email for this candidate or template." }, { status: 403 });
    const { data: application } = await service.from("candidate_applications").select("application_id,group_id,candidate_id").eq("application_id", failure.application_id).single();
    if (!application || application.candidate_id !== candidate.candidate_id) return NextResponse.json({ ok: false, error: "Application is unavailable." }, { status: 403 });
    const permission=await createUserClient(token).rpc("app_can_manage_application_v1",{p_application_id:application.application_id});
    if(permission.error||permission.data!==true) return NextResponse.json({ok:false,error:"Only this application group PICs or administrators may perform this action."},{status:403});
    const { data: existingDelivery, error: deliveryError } = await service.from("rejection_letter_drafts").select("draft_id").eq("candidate_id", payload.candidate_id).eq("failed_stage_instance_id", payload.failed_stage_instance_id).in("status", ["sending", "sent"]).maybeSingle();
    if (deliveryError) throw new Error(deliveryError.message);
    if (existingDelivery) return NextResponse.json({ ok: false, error: "A rejection letter has already been sent or is sending for this failed stage." }, { status: 409 });
    const { data: draft, error: insertError } = await service.from("rejection_letter_drafts").insert({ candidate_id: payload.candidate_id, failed_stage_instance_id: payload.failed_stage_instance_id, template_id: template.template_id, template_version: template.version, language: payload.language, recipient_email: payload.recipient_email, subject: payload.subject, body: payload.body, status: "sending", created_by: userId, retry_of_draft_id: payload.retry_of_draft_id || null }).select("draft_id").single();
    if (insertError || !draft) throw new Error(insertError?.message ?? "Could not create the email record.");
    draftId = draft.draft_id;
    const url = process.env.POWER_AUTOMATE_REJECTION_LETTER_WEBHOOK_URL;
    const secret = process.env.POWER_AUTOMATE_REJECTION_LETTER_WEBHOOK_SECRET;
    const sharedMailbox = process.env.POWER_AUTOMATE_REJECTION_LETTER_SHARED_MAILBOX;
    if (!url || !secret || !sharedMailbox) throw new Error("Power Automate email configuration is incomplete.");
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-rejection-letter-secret": secret }, body: JSON.stringify({ draft_id: draftId, shared_mailbox: sharedMailbox, recipient_email: payload.recipient_email, subject: payload.subject, html_body: escapeLetterHtml(payload.body), language: payload.language, candidate_id: payload.candidate_id, failed_stage: payload.failed_stage_instance_id }), signal: AbortSignal.timeout(15000) });
    const flow = await response.json().catch(() => ({})) as { ok?: boolean; outlook_message_id?: string; outlook_draft_id?: string; flow_run_id?: string; error?: unknown; message?: unknown };
    const deliveryId = flow.outlook_message_id ?? flow.outlook_draft_id;
    if (!response.ok || !flow.ok || !deliveryId) {
      const flowError = typeof flow.error === "string"
        ? flow.error
        : typeof flow.message === "string"
          ? flow.message
          : flow.error && typeof flow.error === "object"
            ? JSON.stringify(flow.error)
            : `Power Automate did not send the rejection letter (HTTP ${response.status}).`;
      throw new Error(flowError);
    }
    await service.from("rejection_letter_drafts").update({ status: "sent", shared_mailbox: sharedMailbox, outlook_draft_id: deliveryId, flow_run_id: flow.flow_run_id ?? null, response_metadata: { ok: true }, finalized_at: new Date().toISOString() }).eq("draft_id", draftId);
    return NextResponse.json({ ok: true, draft_id: draftId, shared_mailbox: sharedMailbox, delivery_id: deliveryId });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Could not send rejection letter.";
    if (draftId) { try { await createServiceClient().from("rejection_letter_drafts").update({ status: "failed", failure_summary: message, finalized_at: new Date().toISOString() }).eq("draft_id", draftId); } catch {} }
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

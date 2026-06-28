import { NextRequest, NextResponse } from "next/server";
import { ROLES } from "@/lib/constants";
import { createServiceClient } from "@/lib/supabase/server";
import type { Role } from "@/types/recruitment";

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing authorization token." }, { status: 401 });
    }

    const payload = (await request.json()) as {
      mode?: string;
      user_id?: string | null;
      email?: string;
      password?: string;
      full_name?: string | null;
      nickname?: string | null;
      site?: string | null;
      role?: Role;
    };

    const mode = payload.mode ?? "new";
    if (!["new", "change"].includes(mode)) {
      return NextResponse.json({ ok: false, error: "Mode must be new or change." }, { status: 400 });
    }

    if (!payload.role || !payload.nickname) {
      return NextResponse.json({ ok: false, error: "Nickname and role are required." }, { status: 400 });
    }

    if (mode === "new" && (!payload.email || !payload.password)) {
      return NextResponse.json({ ok: false, error: "Email and password are required for new accounts." }, { status: 400 });
    }

    if (mode === "change" && !payload.user_id) {
      return NextResponse.json({ ok: false, error: "Existing user is required in Change mode." }, { status: 400 });
    }

    if (payload.role === "site_recruiter" && !payload.site) {
      return NextResponse.json({ ok: false, error: "Site is required for site recruiter accounts." }, { status: 400 });
    }

    if (!ROLES.includes(payload.role)) {
      return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });
    }

    const service = createServiceClient();
    const { data: userData, error: userError } = await service.auth.getUser(token);
    if (userError || !userData.user) {
      return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (profileError || profile?.role !== "system_admin") {
      return NextResponse.json({ ok: false, error: "System admin role is required." }, { status: 403 });
    }

    if (mode === "change") {
      const { error: updateAuthError } = await service.auth.admin.updateUserById(payload.user_id!, {
        user_metadata: {
          full_name: payload.full_name ?? payload.nickname,
          nickname: payload.nickname,
          site: payload.site ?? null,
          role: payload.role
        }
      });

      if (updateAuthError) {
        return NextResponse.json({ ok: false, error: updateAuthError.message }, { status: 400 });
      }

      const { error: updateProfileError } = await service
        .from("profiles")
        .update({
          full_name: payload.full_name ?? payload.nickname,
          nickname: payload.nickname,
          site: payload.site ?? null,
          role: payload.role
        })
        .eq("id", payload.user_id);

      if (updateProfileError) {
        return NextResponse.json({ ok: false, error: updateProfileError.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true, id: payload.user_id });
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: payload.email!,
      password: payload.password!,
      email_confirm: true,
      user_metadata: {
        full_name: payload.full_name ?? payload.nickname,
        nickname: payload.nickname,
        site: payload.site ?? null,
        role: payload.role
      }
    });

    if (createError || !created.user) {
      return NextResponse.json({ ok: false, error: createError?.message ?? "User creation failed." }, { status: 400 });
    }

    const { error: upsertError } = await service.from("profiles").upsert({
      id: created.user.id,
      email: payload.email!,
      full_name: payload.full_name ?? payload.nickname,
      nickname: payload.nickname,
      site: payload.site ?? null,
      role: payload.role
    });

    if (upsertError) {
      return NextResponse.json({ ok: false, error: upsertError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, id: created.user.id });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}

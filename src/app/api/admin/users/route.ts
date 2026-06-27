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
      email?: string;
      password?: string;
      full_name?: string | null;
      role?: Role;
    };

    if (!payload.email || !payload.password || !payload.role) {
      return NextResponse.json({ ok: false, error: "Email, password, and role are required." }, { status: 400 });
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

    if (profileError || profile?.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Admin role is required." }, { status: 403 });
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        full_name: payload.full_name ?? null
      }
    });

    if (createError || !created.user) {
      return NextResponse.json({ ok: false, error: createError?.message ?? "User creation failed." }, { status: 400 });
    }

    const { error: upsertError } = await service.from("profiles").upsert({
      id: created.user.id,
      email: payload.email,
      full_name: payload.full_name ?? null,
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

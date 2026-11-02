import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/types/recruitment";
import { loadCachedScopedDetail } from "@/lib/scoped-detail-cache";
import { readCompleteScopedPages, type ScopedAccessIdentity } from "@/lib/scoped-detail-read";

/** RLS-backed assignment options; admins see authorized profiles, site recruiters see only their own profile. */
export async function loadAuthorizedRecruiterOptions(client: SupabaseClient, accessScope: ScopedAccessIdentity): Promise<Profile[]> {
  const key = `recruiter-options:${accessScope.key}\u001f`;
  return loadCachedScopedDetail(client, accessScope, key, async () => {
    return readCompleteScopedPages<Profile>(
      (from, to) => client.from("profiles").select("id,email,full_name,nickname,site,role,created_at,updated_at", { count: "exact" }).order("id", { ascending: true }).range(from, to),
      row => row.id,
      "authorized recruiter options",
    );
  });
}

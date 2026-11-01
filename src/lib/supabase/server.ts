import { createClient } from "@supabase/supabase-js";

/** Preserve caller claims for database capability checks before service-role side effects. */
export function createUserClient(accessToken: string) {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key) throw new Error("Supabase public configuration is missing.");
  return createClient(url,key,{global:{headers:{Authorization:`Bearer ${accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}});
}

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Supabase server environment variables are not configured.");
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

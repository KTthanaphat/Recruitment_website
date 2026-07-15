"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseProjectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : null;
const supabaseStorageKey = supabaseProjectRef ? `sb-${supabaseProjectRef}-auth-token` : null;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function withAuthTimeout<T>(operation: Promise<T>, message: string, timeoutMs = 8000) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  }) as Promise<T>;
}

export function clearStoredSupabaseSession() {
  if (typeof window === "undefined" || !supabaseStorageKey) return;
  window.localStorage.removeItem(supabaseStorageKey);
}

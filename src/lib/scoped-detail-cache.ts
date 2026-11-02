import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyScopedIdentity, type ScopedAccessIdentity } from "./scoped-detail-read";

const TTL_MS = 30_000;
const MAX_ENTRIES = 100;
type Entry<T> = { expiresAt: number; value: Promise<T> };
const clientCaches = new WeakMap<object, Map<string, Entry<unknown>>>();

/** Bounded, client-isolated warm cache for selected workspace detail only. */
export async function loadCachedScopedDetail<T>(client: SupabaseClient, accessScope: ScopedAccessIdentity, key: string, load: () => Promise<T>): Promise<T> {
  await verifyScopedIdentity(client, accessScope);
  const cacheKey = `${accessScope.profileId}\u001f${accessScope.key}\u001f${key}`;
  const now = Date.now();
  let cache = clientCaches.get(client);
  if (!cache) { cache = new Map(); clientCaches.set(client, cache); }
  for (const [entryKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(entryKey);
  const existing = cache.get(cacheKey) as Entry<T> | undefined;
  if (existing && existing.expiresAt > now) return existing.value;
  const value = load().then(result => {
    if (result && typeof result === "object" && "status" in result && result.status === "unavailable" && cache?.get(cacheKey)?.value === value) cache.delete(cacheKey);
    return result;
  }, error => { if (cache?.get(cacheKey)?.value === value) cache.delete(cacheKey); throw error; });
  cache.set(cacheKey, { expiresAt: now + TTL_MS, value });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

/** Clear selected-detail warm data after mutations, sign-out, or access-scope changes. */
export function clearScopedDetailCache(client: SupabaseClient, accessScopeKey?: string) {
  const cache = clientCaches.get(client);
  if (!cache) return;
  if (!accessScopeKey) { cache.clear(); return; }
  for (const key of cache.keys()) if (key.includes(`${accessScopeKey}\u001f`)) cache.delete(key);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyScopedIdentity, type ScopedAccessIdentity } from "./scoped-detail-read";

const TTL_MS = 30_000;
const MAX_ENTRIES = 100;
type Entry<T> = { expiresAt: number; value: Promise<T>; controller: AbortController; readers: number; settled: boolean };
const clientCaches = new WeakMap<object, Map<string, Entry<unknown>>>();

/** Bounded, client-isolated warm cache for selected workspace detail only. */
export async function loadCachedScopedDetail<T>(client: SupabaseClient, accessScope: ScopedAccessIdentity, key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  await verifyScopedIdentity(client, accessScope);
  const cacheKey = `${accessScope.profileId}\u001f${accessScope.key}\u001f${key}`;
  const now = Date.now();
  let cache = clientCaches.get(client);
  if (!cache) { cache = new Map(); clientCaches.set(client, cache); }
  for (const [entryKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(entryKey);
  const existing = cache.get(cacheKey) as Entry<T> | undefined;
  if (existing && existing.expiresAt > now && !existing.controller.signal.aborted) return leaseDetail(existing, signal);
  const controller = new AbortController();
  const value = load(controller.signal).then(result => {
    if (result && typeof result === "object" && "status" in result && result.status === "unavailable" && cache?.get(cacheKey)?.value === value) cache.delete(cacheKey);
    return result;
  }, error => { if (cache?.get(cacheKey)?.value === value) cache.delete(cacheKey); throw error; });
  const entry: Entry<T> = { expiresAt: now + TTL_MS, value, controller, readers: 0, settled: false };
  void value.then(() => { entry.settled = true; }, () => { entry.settled = true; });
  cache.set(cacheKey, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return leaseDetail(entry, signal);
}

async function leaseDetail<T>(entry: Entry<T>, signal?: AbortSignal): Promise<T> {
 entry.readers++; let cancel: (() => void) | undefined;
 try {
  if (signal?.aborted) throw Object.assign(new Error("Detail read canceled"), {name:"AbortError"});
  const cancellation = new Promise<never>((_,reject) => { cancel = () => reject(Object.assign(new Error("Detail read canceled"), {name:"AbortError"})); signal?.addEventListener("abort",cancel,{once:true}); });
  return await (signal ? Promise.race([entry.value,cancellation]) : entry.value);
 } finally { if(cancel)signal?.removeEventListener("abort",cancel); entry.readers--; if(!entry.readers&&!entry.settled)entry.controller.abort(); }
}

/** Clear selected-detail warm data after mutations, sign-out, or access-scope changes. */
export function clearScopedDetailCache(client: SupabaseClient, accessScopeKey?: string) {
  const cache = clientCaches.get(client);
  if (!cache) return;
  if (!accessScopeKey) { cache.clear(); return; }
  for (const key of cache.keys()) if (key.includes(`${accessScopeKey}\u001f`)) cache.delete(key);
}

/** Patch warm and pending exact candidate detail entries without touching other records. */
export function patchScopedCandidateDetail<T>(client: object, scope: string, candidateId: string, patch: (value: T) => T) {
 const cache = clientCaches.get(client); if (!cache) return;
 for (const [key, entry] of cache) {
  const parts = key.split("\u001f"); if (parts[1] !== scope) continue;
  let identity: unknown; try { identity = JSON.parse(parts[2]); } catch { continue; }
  if (!Array.isArray(identity) || identity[1] !== candidateId) continue;
  if (identity[0] === "candidate-shell") { cache.delete(key); continue; }
  if (identity[0] !== "candidate") continue;
  entry.expiresAt = Date.now()+TTL_MS; entry.value = entry.value.then(value => patch(value as T));
 }
}

export function invalidateScopedCandidateDetail(client: object, scope: string, candidateIds: ReadonlySet<string>) {
 const cache = clientCaches.get(client); if (!cache) return;
 for (const key of cache.keys()) { const parts = key.split("\u001f"); if (parts[1] !== scope) continue; try { const identity = JSON.parse(parts[2]); if ((identity[0] === "candidate" || identity[0] === "candidate-shell") && candidateIds.has(identity[1])) cache.delete(key); } catch { /* Other detail namespaces stay cached. */ } }
}

/** Candidate actions invalidate only their authorized source/destination workspace caches. */
export function invalidateScopedCandidateWorkspaces(client: object, scope: string, groups: ReadonlySet<string>, documents: ReadonlySet<string>) {
 const cache=clientCaches.get(client); if(!cache)return;
 for(const key of cache.keys()) {
  const parts=key.split("\u001f"); if(parts[1]!==scope)continue;
  try { const identity=parts[3]?JSON.parse(parts[3]):null;
   if(parts[2].startsWith("group-workspace:")&&identity&&groups.has(identity[0]))cache.delete(key);
   if(parts[2].startsWith("requisition-detail:")&&identity&&documents.has(identity[0]))cache.delete(key);
  }catch { /* Other namespaces remain warm. */ }
 }
}

/** Patch only affected requisition and linked-group detail/preview caches. */
export function patchScopedRequisitionDetails<T>(client: object, scope: string, docs: ReadonlySet<string>, groups: ReadonlySet<string>, patch: (value:T)=>T) {
 const cache=clientCaches.get(client);if(!cache)return;
 for(const [key,entry]of cache){const parts=key.split("\u001f");if(parts[1]!==scope)continue;
  if([...docs,...groups].some(id=>key.includes(JSON.stringify(id))))entry.value=entry.value.then(value=>patch(value as T));
 }
}

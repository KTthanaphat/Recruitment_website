// Same-tab Home snapshots contain aggregates only and expire after 30 seconds.
const PREFIX = 'recruitment:home-summary:v1:';
let generation = 0;
function key(kind: string, accessScope: string, scope: unknown) { return PREFIX + JSON.stringify([kind, accessScope, scope]); }
export function homeSnapshotGeneration() { return generation; }
export function clearHomeSnapshots() {
  generation++;
  try { for (const name of Object.keys(sessionStorage)) if (name.startsWith(PREFIX)) sessionStorage.removeItem(name); } catch { /* Storage is optional. */ }
}
export function readHomeSnapshot<T>(kind: string, accessScope: string, scope: unknown, valid: (value: unknown) => value is T): T | null {
  if (!accessScope || typeof window === 'undefined') return null;
  try {
    const name = key(kind, accessScope, scope), raw = sessionStorage.getItem(name);
    if (!raw) return null;
    const entry = JSON.parse(raw), age = Date.now() - entry.savedAt;
    if (!Number.isFinite(age) || age < 0 || age >= 30_000 || !valid(entry.data)) { sessionStorage.removeItem(name); return null; }
    return entry.data;
  } catch { return null; }
}
export function saveHomeSnapshot(kind: string, accessScope: string, scope: unknown, data: unknown, startedGeneration: number) {
  if (generation !== startedGeneration || !accessScope || typeof window === 'undefined') return;
  try {
    for (const name of Object.keys(sessionStorage)) if (name.startsWith(PREFIX)) {
      try { if (Date.now() - JSON.parse(sessionStorage.getItem(name)!).savedAt >= 30_000) sessionStorage.removeItem(name); } catch { sessionStorage.removeItem(name); }
    }
    const entries = Object.keys(sessionStorage).filter(name => name.startsWith(PREFIX));
    if (entries.length >= 20) sessionStorage.removeItem(entries[0]);
    sessionStorage.setItem(key(kind, accessScope, scope), JSON.stringify({ savedAt: Date.now(), data }));
  } catch { /* Storage is optional. */ }
}

export function homeSnapshotRemainingMs(kind: string, accessScope: string, scope: unknown): number {
 try { const raw = sessionStorage.getItem(key(kind, accessScope, scope)); if (!raw) return Infinity; const remaining = 30_000 - (Date.now() - JSON.parse(raw).savedAt); if (remaining <= 0) { sessionStorage.removeItem(key(kind, accessScope, scope)); return Infinity; } return remaining; } catch { return Infinity; }
}

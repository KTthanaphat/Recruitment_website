export type RecruitmentReadTiming = { priority: number; queueMs: number; requestMs: number; status: "fulfilled" | "rejected" };
const timingObservers = new Set<(timing: RecruitmentReadTiming) => void>();
export function subscribeRecruitmentReadTimings(observer: (timing: RecruitmentReadTiming) => void) { timingObservers.add(observer); return () => { timingObservers.delete(observer); }; }
type Job = { priority: number; run: () => PromiseLike<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void; signal?: AbortSignal; detach: () => void };
type Lane = { active: number; background: number; pending: Job[]; scheduled: boolean };
const lanes = new WeakMap<object, Lane>();
const pendingLanes = new Set<Lane>();
function aborted() { const error = new Error("Recruitment read canceled."); error.name = "AbortError"; return error; }
function drain(lane: Lane) {
  lane.scheduled = false;
  while (lane.active < 2) {
    const index = lane.pending.findIndex(job => job.priority <= 0 || lane.background < 1);
    if (index < 0) break;
    const [job] = lane.pending.splice(index, 1); job.detach();
    if (job.signal?.aborted) { job.reject(aborted()); continue; }
    const background = job.priority > 0;
    lane.active++; if (background) lane.background++;
    Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
      lane.active--; if (background) lane.background--; drain(lane);
    });
  }
  if (!lane.pending.length && !lane.active) pendingLanes.delete(lane);
}
/** At most two reads, at most one background read. Writes bypass this scheduler. */
export function scheduleRecruitmentRead<T>(client: object, run: () => PromiseLike<T>, priority = 1, options: { signal?: AbortSignal } = {}): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(aborted());
  let lane = lanes.get(client);
  if (!lane) { lane = { active: 0, background: 0, pending: [], scheduled: false }; lanes.set(client, lane); }
  if (lane.pending.length >= 100) return Promise.reject(new Error("Too many pending recruitment reads. Please retry."));
  const browserDiagnostics = typeof window !== "undefined" && (window as Window & { __recruitmentMeasureReads?: boolean }).__recruitmentMeasureReads === true;
  const current = lane, queuedAt = timingObservers.size || browserDiagnostics ? performance.now() : null;
  return new Promise<T>((resolve, reject) => {
    const job: Job = { priority, signal: options.signal, detach: () => {}, resolve: value => resolve(value as T), reject,
      run: () => {
        const started = performance.now();
        const emit = (status: RecruitmentReadTiming["status"]) => {
          if (queuedAt === null) return;
          const timing: RecruitmentReadTiming = { priority, queueMs: started - queuedAt, requestMs: performance.now() - started, status };
          for (const observer of timingObservers) { try { observer(timing); } catch { /* Diagnostics never affect reads. */ } }
          if (browserDiagnostics) window.dispatchEvent(new CustomEvent("recruitment:read-timing", { detail: timing }));
        };
        return Promise.resolve().then(run).then(value => { emit("fulfilled"); return value; }, error => { emit("rejected"); throw error; });
      } };
    const cancel = () => { const index = current.pending.indexOf(job); if (index >= 0) { current.pending.splice(index, 1); job.detach(); reject(aborted()); drain(current); } };
    options.signal?.addEventListener("abort", cancel, { once: true });
    job.detach = () => options.signal?.removeEventListener("abort", cancel);
    current.pending.push(job); current.pending.sort((a, b) => a.priority - b.priority); pendingLanes.add(current);
    if (!current.scheduled) { current.scheduled = true; queueMicrotask(() => drain(current)); }
  });
}
export function clearRecruitmentReadQueue(client?: object) {
  const targets = client ? [lanes.get(client)].filter((lane): lane is Lane => Boolean(lane)) : [...pendingLanes];
  for (const lane of targets) { for (const job of lane.pending.splice(0)) { job.detach(); job.reject(aborted()); } if (!lane.active) pendingLanes.delete(lane); }
}

/** A queued prefetch becomes interactive when the user navigates into that block. */
export function promoteRecruitmentRead(client: object, signal: AbortSignal, priority = 0) {
 const lane = lanes.get(client); const job = lane?.pending.find(value => value.signal === signal);
 if (!lane || !job || job.priority <= priority) return;
 job.priority = priority; lane.pending.sort((a,b) => a.priority-b.priority); drain(lane);
}

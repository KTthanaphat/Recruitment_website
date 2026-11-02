type Job = { priority: number; run: () => PromiseLike<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void };
type Lane = { active: boolean; pending: Job[]; scheduled: boolean };
const lanes = new WeakMap<object, Lane>();
const pendingLanes = new Set<Lane>();

function drain(lane: Lane) {
  lane.scheduled = false;
  if (lane.active) return;
  const job = lane.pending.shift();
  if (!job) { pendingLanes.delete(lane); return; }
  lane.active = true;
  Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
    lane.active = false;
    drain(lane);
  });
}

/** Bound expensive read concurrency per client. Writes never use this queue. */
export function scheduleRecruitmentRead<T>(client: object, run: () => PromiseLike<T>, priority = 1): Promise<T> {
  let lane = lanes.get(client);
  if (!lane) { lane = { active: false, pending: [], scheduled: false }; lanes.set(client, lane); }
  if (lane.pending.length >= 100) return Promise.reject(new Error("Too many pending recruitment reads. Please retry."));
  const current = lane;
  return new Promise<T>((resolve, reject) => {
    const job: Job = { priority, run, resolve: value => resolve(value as T), reject };
    current.pending.push(job);
    // Stable sort retains FIFO order at the same priority.
    current.pending.sort((a, b) => a.priority - b.priority);
    pendingLanes.add(current);
    if (!current.active && !current.scheduled) {
      current.scheduled = true;
      queueMicrotask(() => drain(current));
    }
  });
}

/** Drop queued work when the authenticated identity changes; active reads retain stale-result guards. */
export function clearRecruitmentReadQueue(client?: object) {
  const targets = client ? [lanes.get(client)].filter((lane): lane is Lane => Boolean(lane)) : [...pendingLanes];
  for (const lane of targets) {
    const error = new Error("Recruitment read canceled because its access context changed.");
    error.name = "AbortError";
    for (const job of lane.pending.splice(0)) job.reject(error);
    if (!lane.active) pendingLanes.delete(lane);
  }
}

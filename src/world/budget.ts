// Main-thread work budget: heavy "finish a streamed tile" steps (terrain mesh, texture upload, building
// geometry) are queued and run a few milliseconds per frame, instead of all at once when downloads land.
// Without this, several tiles finishing together froze the picture for 50+ ms (much longer on phones).
const jobs: (() => void)[] = [];
/** recent job durations in ms (for diagnostics) */
export const jobTimes: number[] = [];

/** Queue a synchronous job to run in a later frame's budget. */
export function later(job: () => void) { jobs.push(job); }

/** Run queued jobs until the frame budget is used up (always at least one job). */
export function runJobs(budgetMs: number) {
  const t0 = performance.now();
  while (jobs.length) {
    const job = jobs.shift()!;
    const j0 = performance.now();
    try { job(); } catch (e) { console.warn('streamed job failed', e); }
    jobTimes.push(performance.now() - j0); if (jobTimes.length > 200) jobTimes.shift();
    if (performance.now() - t0 > budgetMs) break;
  }
}

export const pendingJobs = () => jobs.length;

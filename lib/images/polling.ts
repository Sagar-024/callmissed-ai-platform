import type { ImageJobResponse } from "@/lib/schemas";

export type PollPolicy = {
  baseMs: number;
  factor: number;
  maxMs: number;
};

export const DEFAULT_POLL_POLICY: PollPolicy = { baseMs: 1_000, factor: 2, maxMs: 3_000 };

export function nextPollDelay(attempt: number, policy: PollPolicy = DEFAULT_POLL_POLICY): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const raw = policy.baseMs * policy.factor ** safeAttempt;
  return Math.min(Math.round(raw), policy.maxMs);
}

export function isTerminalJobStatus(status: ImageJobResponse["status"]): boolean {
  return status === "succeeded" || status === "failed";
}

export type PollJobDeps = {
  fetchJob: (id: string) => Promise<ImageJobResponse>;
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (job: ImageJobResponse, attempt: number) => void;
  policy?: PollPolicy;
  signal?: AbortSignal;
};

export async function runPollLoop(
  id: string,
  deps: PollJobDeps,
): Promise<ImageJobResponse> {
  const policy = deps.policy ?? DEFAULT_POLL_POLICY;
  let attempt = 0;

  for (;;) {
    if (deps.signal?.aborted) throw new DOMException("Polling aborted", "AbortError");

    const job = await deps.fetchJob(id);
    deps.onUpdate?.(job, attempt);

    if (isTerminalJobStatus(job.status)) return job;

    await deps.wait(nextPollDelay(attempt, policy), deps.signal);
    attempt += 1;
  }
}

export function waitWithTimeout(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

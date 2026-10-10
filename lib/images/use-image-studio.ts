import { useCallback, useEffect, useRef, useState } from "react";
import { readApiError } from "@/lib/chat/protocol";
import {
  clearGalleryCache,
  loadCachedGallery,
  persistGalleryItem,
  removeCachedGalleryItem,
  type GalleryItem,
} from "@/lib/images/cache";
import { isTerminalJobStatus, runPollLoop, waitWithTimeout } from "@/lib/images/polling";
import type { ImageJobResponse } from "@/lib/schemas";

export type ActiveImageJob = {
  id: string;
  prompt: string;
  model: string;
  size: string;
  n: number;
  status: "queued" | "running";
  pollAttempt: number;
  started_at: number;
};

export type GenerateImageInput = {
  prompt: string;
  model: string;
  size: string;
  n: number;
};

export type StudioError = { code: string; message: string };

const MAX_ACTIVE_JOBS = 4;

export function useImageStudio() {
  const [active, setActive] = useState<ActiveImageJob[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<StudioError | null>(null);

  const activeCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    activeCountRef.current = active.length;
  }, [active.length]);

  useEffect(() => {
    let cancelled = false;

    void loadCachedGallery().then((items) => {
      if (cancelled) return;
      setGallery(items);
      setHydrated(true);
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  const generate = useCallback(async (input: GenerateImageInput) => {
    if (activeCountRef.current >= MAX_ACTIVE_JOBS) {
      setError({
        code: "too_many_active_jobs",
        message: `At most ${MAX_ACTIVE_JOBS} generations can run at once. Wait for a card to resolve.`,
      });
      return;
    }

    const tempId = `pending_${crypto.randomUUID()}`;
    const optimistic: ActiveImageJob = {
      id: tempId,
      prompt: input.prompt,
      model: input.model,
      size: input.size,
      n: input.n,
      status: "running",
      pollAttempt: 0,
      started_at: Date.now(),
    };
    setActive((prev) => [...prev, optimistic]);
    setError(null);

    let acceptedId: string | null = null;

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const apiError = await readApiError(res);
        throw Object.assign(new Error(apiError.message), { api: apiError });
      }

      const accepted = (await res.json()) as ImageJobResponse;
      acceptedId = accepted.id;
      setActive((prev) => prev.map((job) => (job.id === tempId ? { ...job, id: accepted.id } : job)));

      const controller = new AbortController();
      abortRef.current = controller;

      let consecutivePollFailures = 0;

      // The server now completes generation within the POST request, so the
      // response is already terminal and no cross-request polling is needed.
      // Polling is retained as a fallback for any non-terminal response.
      const final = isTerminalJobStatus(accepted.status)
        ? accepted
        : await runPollLoop(accepted.id, {
        signal: controller.signal,
        wait: waitWithTimeout,
        onUpdate: (job, attempt) => {
          setActive((prev) =>
            prev.map((job_) =>
              job_.id === accepted.id
                ? {
                    ...job_,
                    status: job.status === "running" ? "running" : "queued",
                    pollAttempt: attempt,
                  }
                : job_,
            ),
          );
        },
        fetchJob: async (id) => {
          const pollRes = await fetch(`/api/images/${id}`, {
            cache: "no-store",
            signal: controller.signal,
          });

          if (pollRes.status === 404) {
            consecutivePollFailures = 0;
            return {
              id,
              status: "failed",
              prompt: input.prompt,
              model: input.model,
              n: input.n,
              size: input.size,
              error: { message: "Job expired or was never visible to this client." },
              created_at: accepted.created_at,
              updated_at: Date.now(),
            } satisfies ImageJobResponse;
          }

          if (pollRes.status === 429) {
            // Rate limiter tripped by the poll cadence itself — wait out the
            // window and keep the job alive instead of failing it.
            consecutivePollFailures = 0;
            let waitMs = 5_000;
            try {
              const body = (await pollRes.json()) as {
                error?: { retry_after_ms?: number };
              };
              if (typeof body.error?.retry_after_ms === "number" && body.error.retry_after_ms > 0) {
                waitMs = body.error.retry_after_ms;
              }
            } catch {
              // keep the default wait
            }
            await waitWithTimeout(waitMs, controller.signal);
            return {
              id,
              status: "running",
              prompt: input.prompt,
              model: input.model,
              n: input.n,
              size: input.size,
              created_at: accepted.created_at,
              updated_at: Date.now(),
            } satisfies ImageJobResponse;
          }

          if (!pollRes.ok) {
            consecutivePollFailures += 1;
            if (consecutivePollFailures >= 3) {
              const apiError = await readApiError(pollRes);
              throw Object.assign(new Error(apiError.message), { api: apiError });
            }
            return {
              id,
              status: "running",
              prompt: input.prompt,
              model: input.model,
              n: input.n,
              size: input.size,
              created_at: accepted.created_at,
              updated_at: Date.now(),
            } satisfies ImageJobResponse;
          }

          consecutivePollFailures = 0;
          return (await pollRes.json()) as ImageJobResponse;
        },
      });

      const item: GalleryItem = {
        id: final.id,
        prompt: final.prompt,
        model: final.model,
        size: final.size,
        n: final.n,
        images: final.status === "succeeded" ? final.images ?? [] : [],
        cost_usd: final.cost_usd,
        error: final.error ? { message: final.error.message } : undefined,
        created_at: final.created_at,
        source: "session",
      };

      const persistable: GalleryItem | null =
        item.images.length > 0 ? { ...item, source: "session" } : null;

      setGallery((prev) => [item, ...prev.filter((g) => g.id !== item.id)]);
      if (persistable) void persistGalleryItem(persistable);
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      if (aborted) return;

      const api = (err as { api?: { code: string } }).api;
      const message = err instanceof Error ? err.message : "Image generation failed.";

      // The job was accepted server-side: keep a failed card in the gallery so
      // the loss is visible (and dismissable) instead of a transient toast.
      if (acceptedId) {
        const failedItem: GalleryItem = {
          id: acceptedId,
          prompt: input.prompt,
          model: input.model,
          size: input.size,
          n: input.n,
          images: [],
          error: { message },
          created_at: Date.now(),
          source: "session",
        };
        setGallery((prev) => [failedItem, ...prev.filter((g) => g.id !== failedItem.id)]);
      }

      setError({
        code: api?.code ?? "image_failed",
        message,
      });
    } finally {
      setActive((prev) =>
        prev.filter((job) => job.id !== tempId && job.id !== acceptedId),
      );
    }
  }, []);

  const removeItem = useCallback(async (id: string) => {
    setGallery((prev) => prev.filter((item) => item.id !== id));
    await removeCachedGalleryItem(id);
  }, []);

  const clearGallery = useCallback(async () => {
    setGallery([]);
    await clearGalleryCache();
  }, []);

  return {
    active,
    gallery,
    hydrated,
    error,
    dismissError,
    generate,
    removeItem,
    clearGallery,
  };
}

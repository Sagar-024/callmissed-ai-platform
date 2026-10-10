import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { fetchImageAsDataUri, GatewayError, generateImages } from "@/lib/gateway";
import { store } from "@/lib/budget/store";
import type { ImageJobResponse, ImageJobStatus, ImageRequest } from "@/lib/schemas";

type ImageJob = {
  id: string;
  identity: string;
  status: ImageJobStatus;
  prompt: string;
  model: string;
  n: number;
  size: string;
  images: string[];
  cost_usd?: number;
  error?: { status?: number; message: string };
  created_at: number;
  updated_at: number;
};

const FINISHED_JOB_TTL_MS = 15 * 60 * 1000;
const ABANDONED_JOB_TTL_MS = 60 * 60 * 1000;

const globalRegistry = globalThis as typeof globalThis & {
  __callmissedImageJobs?: Map<string, ImageJob>;
};

const registry = (globalRegistry.__callmissedImageJobs ??= new Map());

function purgeStale(now = Date.now()): void {
  for (const [id, job] of registry) {
    const age = now - job.created_at;
    const stale =
      age > ABANDONED_JOB_TTL_MS ||
      (age > FINISHED_JOB_TTL_MS && (job.status === "succeeded" || job.status === "failed"));
    if (stale) registry.delete(id);
  }
}

function toResponse(job: ImageJob): ImageJobResponse {
  return {
    id: job.id,
    status: job.status,
    prompt: job.prompt,
    model: job.model,
    n: job.n,
    size: job.size,
    images: job.status === "succeeded" ? job.images : undefined,
    cost_usd: job.cost_usd,
    error: job.error,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

async function run(job: ImageJob): Promise<void> {
  job.status = "running";
  job.updated_at = Date.now();

  try {
    const result = await generateImages({
      model: job.model,
      prompt: job.prompt,
      n: job.n,
      size: job.size,
    });

    const images: string[] = [];
    for (const item of result.data ?? []) {
      if (item.b64_json) images.push(`data:image/png;base64,${item.b64_json}`);
      else if (item.url) images.push(await fetchImageAsDataUri(item.url));
    }

    job.images = images;
    job.status = "succeeded";
    job.cost_usd = env.IMAGE_COST_USD_EACH * job.n;
    store.addCost(job.cost_usd, 0);
  } catch (err) {
    job.status = "failed";
    job.error =
      err instanceof GatewayError
        ? { status: err.status, message: err.message }
        : { message: "Image generation failed unexpectedly." };
  } finally {
    job.updated_at = Date.now();
  }
}

export function createImageJob(input: ImageRequest, identity: string): ImageJobResponse {
  purgeStale();
  const now = Date.now();
  const job: ImageJob = {
    id: randomUUID(),
    identity,
    status: "queued",
    prompt: input.prompt,
    model: input.model,
    n: input.n,
    size: input.size,
    images: [],
    created_at: now,
    updated_at: now,
  };
  registry.set(job.id, job);
  void run(job);
  return toResponse(job);
}

export function getImageJob(id: string): ImageJob | undefined {
  purgeStale();
  return registry.get(id);
}

export function toImageJobResponse(job: ImageJob): ImageJobResponse {
  return toResponse(job);
}

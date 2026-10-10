import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import { env } from "@/lib/env";
import { estimateChatCostUsd, estimateTokens } from "@/lib/budget/pricing";
import { store, type RateCheck } from "@/lib/budget/store";
import { GatewayError } from "@/lib/gateway";
import type { ApiErrorBody, BudgetSnapshot } from "@/lib/schemas";

export type RouteKey = "chat" | "images" | "voice" | "budget";
export type Scope = NonNullable<ApiErrorBody["error"]["scope"]>;

type Policy = {
  rpm: number;
  maxBodyBytes: number;
  concurrentStreams?: boolean;
  maxPromptTokens?: number;
};

const policies: Record<RouteKey, Policy> = {
  chat: {
    rpm: env.RATE_LIMIT_CHAT_RPM,
    maxBodyBytes: 512 * 1024,
    concurrentStreams: true,
    maxPromptTokens: env.MAX_PROMPT_TOKENS_PER_REQUEST,
  },
  images: { rpm: env.RATE_LIMIT_IMAGE_RPM, maxBodyBytes: 64 * 1024 },
  voice: { rpm: env.RATE_LIMIT_VOICE_RPM, maxBodyBytes: 16 * 1024 },
  budget: { rpm: env.RATE_LIMIT_BUDGET_RPM, maxBodyBytes: 8 * 1024 },
};

export type RouteRate = { limit: number; remaining: number; reset_ms: number };

export function resolveIdentity(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "local";
}

export function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  opts: {
    scope?: Scope;
    retryAfterMs?: number;
    details?: unknown;
    rate?: RateCheck;
  } = {},
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.retryAfterMs !== undefined ? { retry_after_ms: opts.retryAfterMs } : {}),
      ...(opts.details !== undefined ? { details: opts.details } : {}),
    },
  };

  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (opts.retryAfterMs !== undefined) {
    headers.set("Retry-After", String(Math.max(Math.ceil(opts.retryAfterMs / 1000), 1)));
  }
  if (opts.rate) {
    headers.set("X-RateLimit-Limit", String(opts.rate.limit));
    headers.set("X-RateLimit-Remaining", String(opts.rate.remaining));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorFrom(err: unknown): Response {
  if (err instanceof GatewayError) {
    const status = err.status >= 500 ? 502 : err.status;
    return jsonError(status, "upstream_error", err.message, {
      scope: "upstream",
      details: { upstream_status: err.status },
    });
  }
  return jsonError(500, "internal_error", "Unexpected server error.", { scope: "upstream" });
}

function projectCost(route: RouteKey, body: unknown): number {
  if (route === "chat" && body && typeof body === "object") {
    const candidate = body as { model?: string; messages?: { content: string }[]; max_tokens?: number };
    if (candidate.model && Array.isArray(candidate.messages)) {
      const outputTokens = Math.min(
        candidate.max_tokens ?? 1024,
        env.MAX_OUTPUT_TOKENS_PER_REQUEST,
      );
      return estimateChatCostUsd(candidate.model, candidate.messages, outputTokens);
    }
  }
  if (route === "images" && body && typeof body === "object") {
    const candidate = body as { n?: number };
    const count = Math.min(Math.max(candidate.n ?? 1, 1), 4);
    return count * env.IMAGE_COST_USD_EACH;
  }
  return 0;
}

function promptTokenCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const candidate = body as { messages?: { content: string }[] };
  if (!Array.isArray(candidate.messages)) return 0;
  return candidate.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

function attachBudgetHeaders(res: Response, rate: RateCheck): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-RateLimit-Limit", String(rate.limit));
  headers.set("X-RateLimit-Remaining", String(rate.remaining));

  const usage = store.usage();
  const usdRemaining = Math.max(env.BUDGET_DAILY_USD - usage.usd, 0);
  const tokenRemaining = Math.max(env.BUDGET_DAILY_TOKENS - usage.tokens, 0);
  headers.set("X-Budget-Usd-Remaining", String(roundUsd(usdRemaining)));
  headers.set("X-Budget-Tokens-Remaining", String(tokenRemaining));

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function guardStreamEnd(res: Response, onEnd: () => void, signal: AbortSignal): Response {
  if (!res.body) {
    onEnd();
    return res;
  }

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener("abort", finish);
    onEnd();
  };

  if (signal.aborted) finish();
  else signal.addEventListener("abort", finish, { once: true });

  const stream = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        finish();
      },
    }),
  );

  return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
}

type BodyOf<S> = S extends z.ZodType ? z.output<S> : null;

export type BudgetHandlerContext<B> = {
  identity: string;
  body: B;
  releaseStream: () => void;
};

export function withBudget<C = unknown, S extends z.ZodType | undefined = undefined>(
  opts: { route: RouteKey; schema?: S; skipBody?: boolean },
  handler: (
    req: NextRequest,
    ctx: C,
    bc: BudgetHandlerContext<BodyOf<S>>,
  ) => Promise<Response>,
): (req: NextRequest, ctx: C) => Promise<Response> {
  const policy = policies[opts.route];

  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const identity = resolveIdentity(req);
    const rate = store.rateCheck(`${opts.route}:${identity}`, policy.rpm);

    if (!rate.allowed) {
      return jsonError(
        429,
        "rate_limited",
        `Rate limit of ${rate.limit} requests/minute reached for the ${opts.route} route.`,
        { scope: "rate_limit", retryAfterMs: rate.resetMs, rate },
      );
    }

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    let raw: string | null = null;

    if (hasBody && !opts.skipBody) {
      const declared = Number(req.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > policy.maxBodyBytes) {
        return jsonError(
          413,
          "payload_too_large",
          `Request body exceeds ${policy.maxBodyBytes} bytes.`,
          { scope: "validation", rate },
        );
      }
      raw = await req.text();
      if (raw.length > policy.maxBodyBytes) {
        return jsonError(
          413,
          "payload_too_large",
          `Request body exceeds ${policy.maxBodyBytes} bytes.`,
          { scope: "validation", rate },
        );
      }
    }

    let body: unknown = null;

    if (raw !== null) {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        try {
          body = JSON.parse(trimmed);
        } catch {
          return jsonError(400, "invalid_json", "Request body must be valid JSON.", {
            scope: "validation",
            rate,
          });
        }

        const fingerprint = createHash("sha256")
          .update(`${opts.route}:${identity}:${raw}`)
          .digest("hex");
        if (store.isDuplicate(`loop:${fingerprint}`, env.LOOP_DEDUPE_WINDOW_MS)) {
          return jsonError(
            429,
            "duplicate_request",
            "Identical request repeated inside the loop-suppression window. Wait before retrying.",
            { scope: "loop", retryAfterMs: env.LOOP_DEDUPE_WINDOW_MS, rate },
          );
        }
      }

      if (opts.schema) {
        const parsed = opts.schema.safeParse(body);
        if (!parsed.success) {
          return jsonError(422, "validation_failed", "Request body failed validation.", {
            scope: "validation",
            details: parsed.error.issues,
            rate,
          });
        }
        body = parsed.data;
      }

      if (policy.maxPromptTokens) {
        const promptTokens = promptTokenCount(body);
        if (promptTokens > policy.maxPromptTokens) {
          return jsonError(
            413,
            "prompt_too_long",
            `Prompt is ~${promptTokens} tokens which exceeds the ${policy.maxPromptTokens} token per-request cap.`,
            { scope: "validation", rate },
          );
        }
      }
    }

    const usage = store.usage();

    if (env.BUDGET_DAILY_USD > 0 && usage.usd >= env.BUDGET_DAILY_USD) {
      return jsonError(
        402,
        "budget_exhausted",
        `Daily budget of $${env.BUDGET_DAILY_USD.toFixed(2)} has been spent. Resets at 00:00 UTC.`,
        { scope: "budget", rate },
      );
    }

    if (env.BUDGET_DAILY_TOKENS > 0 && usage.tokens >= env.BUDGET_DAILY_TOKENS) {
      return jsonError(
        402,
        "token_cap_exhausted",
        `Daily token cap of ${env.BUDGET_DAILY_TOKENS.toLocaleString()} tokens has been consumed.`,
        { scope: "budget", rate },
      );
    }

    const projected = projectCost(opts.route, body);
    if (env.BUDGET_DAILY_USD > 0 && usage.usd + projected > env.BUDGET_DAILY_USD) {
      return jsonError(
        402,
        "budget_would_exceed",
        `Worst-case cost of $${projected.toFixed(4)} would exceed the remaining daily budget of $${Math.max(env.BUDGET_DAILY_USD - usage.usd, 0).toFixed(4)}.`,
        {
          scope: "budget",
          rate,
          details: {
            projected_usd: roundUsd(projected),
            spent_usd: roundUsd(usage.usd),
            remaining_usd: roundUsd(Math.max(env.BUDGET_DAILY_USD - usage.usd, 0)),
          },
        },
      );
    }

    let releaseStream: () => void = () => {};
    if (policy.concurrentStreams) {
      const release = store.acquireStream(identity, env.MAX_CONCURRENT_CHAT_STREAMS);
      if (!release) {
        return jsonError(
          429,
          "concurrent_stream_limit",
          `At most ${env.MAX_CONCURRENT_CHAT_STREAMS} concurrent chat streams are allowed per client.`,
          { scope: "rate_limit", retryAfterMs: 5_000, rate },
        );
      }
      releaseStream = release;
    }

    try {
      const res = await handler(req, ctx, { identity, body: body as BodyOf<S>, releaseStream });
      const withHeaders = attachBudgetHeaders(res, rate);
      return guardStreamEnd(withHeaders, releaseStream, req.signal);
    } catch (err) {
      releaseStream();
      return errorFrom(err);
    }
  };
}

export function snapshotFor(identity: string): BudgetSnapshot {
  const usage = store.usage();
  const rateOf = (route: RouteKey): RouteRate => {
    const peek = store.ratePeek(`${route}:${identity}`, policies[route].rpm);
    return { limit: peek.limit, remaining: peek.remaining, reset_ms: peek.resetMs };
  };

  return {
    day: new Date().toISOString().slice(0, 10),
    usd: {
      limit: env.BUDGET_DAILY_USD,
      used: roundUsd(usage.usd),
      remaining: roundUsd(Math.max(env.BUDGET_DAILY_USD - usage.usd, 0)),
    },
    tokens: {
      limit: env.BUDGET_DAILY_TOKENS,
      used: usage.tokens,
      remaining: Math.max(env.BUDGET_DAILY_TOKENS - usage.tokens, 0),
    },
    concurrency: {
      active: store.activeStreams(identity),
      limit: env.MAX_CONCURRENT_CHAT_STREAMS,
    },
    rate: {
      chat: rateOf("chat"),
      images: rateOf("images"),
      voice: rateOf("voice"),
      budget: rateOf("budget"),
    },
  };
}

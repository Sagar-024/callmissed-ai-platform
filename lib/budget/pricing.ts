import "server-only";
import { env } from "@/lib/env";
import { getChatModel } from "@/lib/catalog";

type GatewayModel = {
  id: string;
  context_window?: number;
  pricing?: { input?: number | null; output?: number | null };
};

const live = new Map<string, GatewayModel>();
const REFRESH_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
let lastAttempt = 0;
let lastSuccess = 0;

export function getPrice(modelId: string): { input: number; output: number } {
  const snapshot = getChatModel(modelId);
  const gateway = live.get(modelId);
  return {
    input: gateway?.pricing?.input ?? snapshot?.input_per_mtok ?? 0,
    output: gateway?.pricing?.output ?? snapshot?.output_per_mtok ?? 0,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateChatCostUsd(
  modelId: string,
  messages: { content: string }[],
  outputTokens: number,
): number {
  const price = getPrice(modelId);
  const promptTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  return (promptTokens * price.input + outputTokens * price.output) / 1e6;
}

export function chatUsageCostUsd(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = getPrice(modelId);
  return (promptTokens * price.input + completionTokens * price.output) / 1e6;
}

export async function refreshPricing(force = false): Promise<boolean> {
  const now = Date.now();
  const ttl = lastSuccess > 0 ? REFRESH_TTL_MS : FAILURE_TTL_MS;
  if (!force && now - lastAttempt < ttl) return false;
  lastAttempt = now;

  try {
    const res = await fetch(`${env.CALLMISSED_API_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${env.CALLMISSED_API_KEY}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;

    const json = (await res.json()) as { data?: GatewayModel[] };
    for (const model of json.data ?? []) {
      if (model?.id) live.set(model.id, model);
    }
    lastSuccess = now;
    return true;
  } catch {
    return false;
  }
}

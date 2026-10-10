import type { NextRequest } from "next/server";
import { errorFrom, jsonError, roundUsd, withBudget } from "@/lib/budget/guard";
import { chatUsageCostUsd, estimateTokens } from "@/lib/budget/pricing";
import { store } from "@/lib/budget/store";
import { startChatCompletion } from "@/lib/gateway";
import { env } from "@/lib/env";
import { chatRequestSchema, type ChatStreamEvent } from "@/lib/schemas";
import { createSSEParser, encodeSSE, type SSEFrame } from "@/lib/sse";

export const maxDuration = 60;

type UpstreamChunk = {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

export const POST = withBudget(
  { route: "chat", schema: chatRequestSchema },
  async (req: NextRequest, _ctx, bc) => {
    const { model, messages, max_tokens, temperature } = bc.body;
    const outputCap = Math.min(max_tokens, env.MAX_OUTPUT_TOKENS_PER_REQUEST);

    let upstream: Response;
    try {
      upstream = await startChatCompletion(
        {
          model,
          messages,
          max_tokens: outputCap,
          ...(temperature !== undefined ? { temperature } : {}),
        },
        req.signal,
      );
    } catch (err) {
      return errorFrom(err);
    }

    const upstreamBody = upstream.body;
    if (!upstreamBody) {
      return jsonError(502, "upstream_error", "Gateway returned an empty stream.", {
        scope: "upstream",
      });
    }

    const reader = upstreamBody.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const parser = createSSEParser();

    let promptTokens = 0;
    let completionTokens = 0;
    let completionChars = 0;
    let usageFromGateway = false;
    let finishReason: string | null = null;
    let usageEvent: ChatStreamEvent | null = null;
    let settled = false;

    const settle = (): ChatStreamEvent => {
      if (!usageEvent) {
        if (!usageFromGateway) {
          promptTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
          completionTokens = estimateTokens("x".repeat(completionChars));
        }
        const cost = chatUsageCostUsd(model, promptTokens, completionTokens);
        store.addCost(cost, promptTokens + completionTokens);
        usageEvent = {
          type: "usage",
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          cost_usd: roundUsd(cost),
          billed: usageFromGateway,
        };
      }
      settled = true;
      return usageEvent;
    };

    const applyFrame = (
      frame: SSEFrame,
      emit: (event: ChatStreamEvent) => void,
    ): "done" | "skip" => {
      if (frame.data === "[DONE]") return "done";
      let chunk: UpstreamChunk;
      try {
        chunk = JSON.parse(frame.data) as UpstreamChunk;
      } catch {
        return "skip";
      }
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? 0;
        completionTokens = chunk.usage.completion_tokens ?? 0;
        usageFromGateway = true;
      }
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        completionChars += delta.length;
        emit({ type: "token", text: delta });
      }
      return "skip";
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: ChatStreamEvent) => {
          controller.enqueue(encoder.encode(encodeSSE(event)));
        };

        try {
          let sawDone = false;
          while (!sawDone) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const frame of parser.push(text)) {
              if (applyFrame(frame, emit) === "done") {
                sawDone = true;
                break;
              }
            }
          }

          if (!sawDone) {
            for (const frame of parser.flush()) {
              if (applyFrame(frame, emit) === "done") break;
            }
          }

          if (!settled) emit(settle());
          emit({ type: "done", finish_reason: finishReason });
          controller.close();
        } catch (err) {
          settle();
          try {
            controller.enqueue(
              encoder.encode(
                encodeSSE({
                  type: "error",
                  code: "stream_interrupted",
                  message: err instanceof Error ? err.message : "Stream interrupted.",
                } satisfies ChatStreamEvent),
              ),
            );
          } catch {
            return;
          }
          try {
            controller.close();
          } catch {
            return;
          }
        } finally {
          settle();
          void reader.cancel().catch(() => {});
        }
      },
      cancel() {
        settle();
        void reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
);

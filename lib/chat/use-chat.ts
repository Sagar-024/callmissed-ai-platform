import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  canSubmit,
  chatReducer,
  initialChatState,
  type TurnUsage,
} from "@/lib/chat/fsm";
import { parseChatEvent, readApiError } from "@/lib/chat/protocol";
import { createSSEParser, type SSEFrame } from "@/lib/sse";
import type { ChatMessage, ChatRequest, ChatStreamEvent } from "@/lib/schemas";

export type ChatUiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "error";
  usage?: TurnUsage;
  finishReason?: string | null;
};

export type SendOptions = {
  model: string;
  maxTokens: number;
  temperature?: number;
};

export type SessionStats = {
  turns: number;
  assistantTurns: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useChat() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef("");
  const rafRef = useRef(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    pendingRef.current = "";
    setMessages([]);
    dispatch({ type: "RESET" });
  }, []);

  const send = useCallback(
    async (content: string, options: SendOptions) => {
      const text = content.trim();
      if (!text || !canSubmit(state)) return;

      dispatch({ type: "SUBMIT" });

      const history: ChatMessage[] = messages
        .filter((message) => message.content.trim().length > 0)
        .map((message) => ({ role: message.role, content: message.content }));
      history.push({ role: "user", content: text });

      const userId = uid();
      const assistantId = uid();
      const userMessage: ChatUiMessage = {
        id: userId,
        role: "user",
        content: text,
        status: "complete",
      };
      const assistantMessage: ChatUiMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      const controller = new AbortController();
      abortRef.current = controller;
      pendingRef.current = "";

      let partial = "";

      const flush = () => {
        rafRef.current = 0;
        const chunk = pendingRef.current;
        if (!chunk) return;
        pendingRef.current = "";
        partial += chunk;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, content: partial } : message,
          ),
        );
      };

      const schedule = () => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(flush);
      };

      const finalize = (patch: Partial<ChatUiMessage>, dropIfEmpty = false) => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        const leftover = pendingRef.current;
        pendingRef.current = "";
        if (leftover) partial += leftover;

        setMessages((prev) => {
          const next = prev.map((message) =>
            message.id === assistantId ? { ...message, content: partial, ...patch } : message,
          );
          if (dropIfEmpty && partial.length === 0) {
            return next.filter((message) => message.id !== assistantId);
          }
          return next;
        });
      };

      const handle = (event: ChatStreamEvent, sink: { usage?: TurnUsage; finish: string | null; failure: { code: string; message: string } | null }) => {
        switch (event.type) {
          case "token":
            pendingRef.current += event.text;
            schedule();
            break;
          case "usage":
            sink.usage = {
              prompt_tokens: event.prompt_tokens,
              completion_tokens: event.completion_tokens,
              cost_usd: event.cost_usd,
              billed: event.billed,
            };
            break;
          case "done":
            sink.finish = event.finish_reason;
            break;
          case "error":
            sink.failure = { code: event.code, message: event.message };
            break;
        }
      };

      try {
        const payload: ChatRequest = {
          model: options.model,
          messages: history,
          max_tokens: options.maxTokens,
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        };

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const error = await readApiError(res);
          finalize({ status: "error" }, true);
          dispatch({ type: "FAIL", error });
          return;
        }

        dispatch({ type: "STREAM_START" });

        const sink: { usage?: TurnUsage; finish: string | null; failure: { code: string; message: string } | null } = {
          finish: null,
          failure: null,
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSSEParser();

        const consume = (frames: SSEFrame[]) => {
          for (const frame of frames) {
            const event = parseChatEvent(frame.data);
            if (event) handle(event, sink);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          consume(parser.push(decoder.decode(value, { stream: true })));
        }
        consume(parser.flush());

        if (sink.failure) {
          finalize({ status: "error" }, true);
          dispatch({
            type: "FAIL",
            error: { code: sink.failure.code, message: sink.failure.message, scope: "upstream" },
          });
          return;
        }

        finalize(
          { status: "complete", finishReason: sink.finish, usage: sink.usage },
          sink.usage === undefined && sink.finish === null,
        );
        dispatch({ type: "DONE", usage: sink.usage ?? null });
      } catch (err) {
        const aborted =
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");

        if (aborted) {
          finalize({ status: "complete", finishReason: "aborted" }, true);
          dispatch({ type: "ABORT" });
        } else {
          finalize({ status: "error" }, true);
          dispatch({
            type: "FAIL",
            error: {
              code: "network_error",
              message: err instanceof Error ? err.message : "Network request failed.",
            },
          });
        }
      } finally {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        pendingRef.current = "";
        abortRef.current = null;
      }
    },
    [state, messages],
  );

  const stats = useMemo<SessionStats>(() => {
    const totals: SessionStats = {
      turns: 0,
      assistantTurns: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    };
    for (const message of messages) {
      if (message.role === "user") totals.turns += 1;
      if (message.role === "assistant" && message.usage) {
        totals.assistantTurns += 1;
        totals.promptTokens += message.usage.prompt_tokens;
        totals.completionTokens += message.usage.completion_tokens;
        totals.costUsd += message.usage.cost_usd;
      }
    }
    totals.costUsd = Math.round(totals.costUsd * 1e6) / 1e6;
    return totals;
  }, [messages]);

  return { state, messages, send, stop, clear, stats };
}

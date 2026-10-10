"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BudgetMeter } from "@/components/dashboard/budget-meter";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { SessionPanel } from "@/components/chat/session-panel";
import { StatePill } from "@/components/chat/state-pill";
import { canSubmit, isActiveStatus } from "@/lib/chat/fsm";
import { scopeMessage } from "@/lib/chat/protocol";
import { useChat } from "@/lib/chat/use-chat";
import type { BudgetResponse, ModelPrice } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Explain how the server-side budget guard prevents runaway spend.",
  "Write a TypeScript AudioWorklet that captures 16 kHz PCM frames.",
  "Draft a markdown response with a table comparing SSE and WebSockets.",
];

const SCOPE_TONE: Record<string, string> = {
  budget: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  rate_limit: "border-orange-500/40 bg-orange-500/10 text-orange-100",
  loop: "border-violet-500/40 bg-violet-500/10 text-violet-100",
  validation: "border-red-500/40 bg-red-500/10 text-red-100",
  upstream: "border-red-500/40 bg-red-500/10 text-red-100",
  default: "border-red-500/40 bg-red-500/10 text-red-100",
};

export function ChatStudio() {
  const { state, messages, send, stop, clear, stats } = useChat();

  const [input, setInput] = useState("");
  const [models, setModels] = useState<ModelPrice[]>([]);
  const [model, setModel] = useState("gpt-6-luna");
  const [maxTokens, setMaxTokens] = useState(1024);

  useEffect(() => {
    let active = true;

    const loadCatalog = async () => {
      try {
        const res = await fetch("/api/budget", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as BudgetResponse;
        if (!active || payload.models.chat.length === 0) return;
        setModels([...payload.models.chat]);
        setModel((current) =>
          payload.models.chat.some((entry) => entry.id === current)
            ? current
            : payload.models.chat[0].id,
        );
      } catch {
        // catalog stays empty; the composer falls back to the default model id
      }
    };

    void loadCatalog();
    return () => {
      active = false;
    };
  }, []);

  const busy = isActiveStatus(state.status);

  const submit = useCallback(
    async (text?: string) => {
      const value = (text ?? input).trim();
      if (!value || busy) return;
      setInput("");
      await send(value, { model, maxTokens });
    },
    [input, busy, model, maxTokens, send],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link href="/" aria-label="Back to dashboard">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-sm font-medium tracking-tight text-zinc-200">
                Text Chat
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <BudgetMeter className="hidden md:flex" />
            <StatePill status={state.status} className="hidden sm:inline-flex" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={clear}
              disabled={messages.length === 0 && state.status === "idle"}
              aria-label="Clear transcript"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* transcript panel */}
        <div className="rounded-[14px] border border-white/20 p-[3px]">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[11px] border border-white/10 bg-black">
            <AnimatePresence initial={false}>
              {state.error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="shrink-0 overflow-hidden"
                >
                  <div
                    className={cn(
                      "mx-4 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs",
                      SCOPE_TONE[state.error.scope ?? "default"] ?? SCOPE_TONE.default,
                    )}
                    role="alert"
                  >
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-mono text-[10px] tracking-wider uppercase">
                        {state.error.code}
                      </span>
                      <span className="leading-5 break-words">{state.error.message}</span>
                      {scopeMessage(state.error.scope) && (
                        <span className="text-[11px] leading-4 opacity-70">
                          {scopeMessage(state.error.scope)}
                        </span>
                      )}
                      {state.error.retry_after_ms ? (
                        <span className="font-mono text-[10px] opacity-80">
                          retry in {Math.ceil(state.error.retry_after_ms / 1000)}s
                        </span>
                      ) : null}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex min-h-0 flex-1 flex-col">
              {messages.length === 0 ? (
                <EmptyState onPick={(text) => void submit(text)} />
              ) : (
                <MessageList messages={messages} />
              )}
            </div>

            <div className="shrink-0 border-t border-white/10 p-3 sm:p-4">
              <Composer
                value={input}
                onValueChange={setInput}
                onSubmit={() => void submit()}
                onStop={stop}
                busy={busy}
                canSend={canSubmit(state)}
                models={models}
                model={model}
                onModelChange={setModel}
                maxTokens={maxTokens}
                onMaxTokensChange={setMaxTokens}
              />
            </div>
          </div>
        </div>

        <SessionPanel
          state={state}
          stats={stats}
          models={models}
          model={model}
          maxTokens={maxTokens}
        />
      </main>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-base font-medium tracking-tight text-zinc-200">
            Start a conversation
          </h2>
          <p className="text-[13px] leading-relaxed text-zinc-500">
            Token streaming with markdown rendering and per-request budget telemetry.
          </p>
        </div>

        <div className="flex w-full flex-col gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onPick(suggestion)}
              className="rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-left text-[13px] leading-5 text-zinc-400 transition-all duration-300 outline-none hover:border-white/25 hover:bg-white/[0.05] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <span className="line-clamp-2">{suggestion}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

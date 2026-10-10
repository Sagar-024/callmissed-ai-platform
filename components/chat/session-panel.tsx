"use client";

import { AnimatePresence, motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { CHAT_STATE_META, type ChatState } from "@/lib/chat/fsm";
import { scopeMessage } from "@/lib/chat/protocol";
import type { SessionStats } from "@/lib/chat/use-chat";
import type { ModelPrice } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const SCOPE_TONE: Record<string, string> = {
  budget: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  rate_limit: "border-orange-500/40 bg-orange-500/10 text-orange-100",
  loop: "border-violet-500/40 bg-violet-500/10 text-violet-100",
  validation: "border-red-500/40 bg-red-500/10 text-red-100",
  upstream: "border-red-500/40 bg-red-500/10 text-red-100",
  default: "border-red-500/40 bg-red-500/10 text-red-100",
};

type Props = {
  state: ChatState;
  stats: SessionStats;
  models: ModelPrice[];
  model: string;
  maxTokens: number;
};

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-white/20 p-[3px]">
      <div className="h-full rounded-[11px] border border-white/10 bg-black p-4">
        {children}
      </div>
    </div>
  );
}

export function SessionPanel({ state, stats, models, model, maxTokens }: Props) {
  const selected = models.find((entry) => entry.id === model);

  return (
    <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto lg:flex">
      <Panel>
        <StateCard state={state} />
      </Panel>
      <Panel>
        <ModelCard model={selected} maxTokens={maxTokens} />
      </Panel>
      <Panel>
        <StatsCard stats={stats} />
      </Panel>
    </aside>
  );
}

function StateCard({ state }: { state: ChatState }) {
  const meta = CHAT_STATE_META[state.status];

  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase">
        Status
      </span>

      <div className="flex items-center gap-2.5">
        <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state.status}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6 }}
            transition={{ duration: 0.15 }}
            className={cn("font-mono text-sm font-medium tracking-wide uppercase", meta.text)}
          >
            {meta.label}
          </motion.span>
        </AnimatePresence>
      </div>
      <p className="text-xs leading-relaxed text-zinc-500">{meta.hint}</p>

      <AnimatePresence>
        {state.error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2.5",
                SCOPE_TONE[state.error.scope ?? "default"] ?? SCOPE_TONE.default,
              )}
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-mono text-[10px] tracking-wider uppercase">
                  {state.error.code}
                </span>
                <p className="text-xs leading-5 break-words">{state.error.message}</p>
                {scopeMessage(state.error.scope) && (
                  <p className="text-[11px] leading-4 opacity-70">
                    {scopeMessage(state.error.scope)}
                  </p>
                )}
                {state.error.retry_after_ms ? (
                  <p className="font-mono text-[10px] opacity-80">
                    retry in {Math.ceil(state.error.retry_after_ms / 1000)}s
                  </p>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModelCard({ model, maxTokens }: { model: ModelPrice | undefined; maxTokens: number }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase">
        Model
      </span>

      <div className="flex flex-col gap-2.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-zinc-200">{model?.label ?? "—"}</span>
          <span className="font-mono text-[10px] text-zinc-500">{model?.id}</span>
        </div>

        <dl className="flex flex-col gap-1.5 font-mono text-[11px] text-zinc-500">
          <div className="flex items-center justify-between">
            <dt>context</dt>
            <dd className="text-zinc-300">{model ? model.context_window.toLocaleString() : "—"} tok</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>input</dt>
            <dd className="text-zinc-300">${model ? model.input_per_mtok.toFixed(4) : "—"} / M</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>output</dt>
            <dd className="text-zinc-300">${model ? model.output_per_mtok.toFixed(4) : "—"} / M</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>max out</dt>
            <dd className="text-zinc-300">{maxTokens} tok</dd>
          </div>
          <div className="mt-0.5 flex items-center justify-between border-t border-white/10 pt-1.5">
            <dt>worst case</dt>
            <dd className="text-emerald-400">
              ${model ? ((maxTokens * model.output_per_mtok) / 1e6).toFixed(6) : "—"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function StatsCard({ stats }: { stats: SessionStats }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase">
        Usage
      </span>

      <div className="flex flex-col gap-1.5 font-mono text-[11px] text-zinc-500">
        <div className="flex items-center justify-between">
          <span>turns</span>
          <span className="text-zinc-300">{stats.turns}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>prompt</span>
          <span className="text-zinc-300">{stats.promptTokens.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>completion</span>
          <span className="text-zinc-300">{stats.completionTokens.toLocaleString()}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between border-t border-white/10 pt-1.5">
          <span>cost</span>
          <span className="text-emerald-400">${stats.costUsd.toFixed(6)}</span>
        </div>
      </div>
    </div>
  );
}

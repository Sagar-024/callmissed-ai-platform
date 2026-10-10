"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Mic, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BudgetMeter } from "@/components/dashboard/budget-meter";
import { TranscriptPanel } from "@/components/voice/transcript-panel";
import { VoiceSessionPanel } from "@/components/voice/session-panel";
import { Waveform } from "@/components/voice/waveform";
import { VOICE_STATE_META } from "@/lib/voice/fsm";
import { useVoiceAgent } from "@/lib/voice/use-voice-agent";
import type { BudgetResponse } from "@/lib/schemas";
import { cn } from "@/lib/utils";

export function VoiceStudio() {
  const {
    state,
    transcript,
    session,
    lastUsage,
    notice,
    stats,
    levelsRef,
    playbackLevelRef,
    connect,
    disconnect,
    clearNotice,
    clearTranscript,
  } = useVoiceAgent();

  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/budget", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as BudgetResponse;
        if (active) setBudget(payload);
      } catch {
        // meter falls back to defaults
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session]);

  const meta = VOICE_STATE_META[state.status];
  const active = state.status !== "idle" && state.status !== "error";
  const secondsLeft =
    session && now !== null ? Math.max(Math.round((session.expires_at - now) / 1000), 0) : null;

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
            <span className="text-sm font-medium tracking-tight text-zinc-200">
              Voice Agent
            </span>
          </div>

          <div className="flex items-center gap-2">
            <BudgetMeter className="hidden md:flex" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={clearTranscript}
              disabled={transcript.length === 0 && stats.turns === 0}
              aria-label="Clear transcript"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* live session panel */}
        <div className="rounded-[14px] border border-white/20 p-[3px]">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[11px] border border-white/10 bg-black">
            <AnimatePresence>
              {(state.error || notice) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="shrink-0 overflow-hidden"
                >
                  <div
                    className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-100"
                    role="alert"
                  >
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-mono text-[10px] tracking-wider uppercase">
                        {notice ? notice.code : "session_error"}
                      </span>
                      <span className="leading-5 break-words">
                        {state.error ?? notice?.message}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={clearNotice}
                      className="shrink-0 rounded p-0.5 outline-none hover:bg-red-500/20 focus-visible:ring-2 focus-visible:ring-white/40"
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* waveform */}
            <div className="relative h-36 shrink-0 border-b border-white/10 px-4">
              <Waveform
                status={state.status}
                levelsRef={levelsRef}
                playbackLevelRef={playbackLevelRef}
              />
              <span
                className={cn(
                  "absolute top-3 left-6 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 font-mono text-[10px] tracking-widest uppercase backdrop-blur",
                  meta.text,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                {meta.label}
              </span>
            </div>

            <TranscriptPanel entries={transcript} thinking={state.status === "thinking"} />

            {/* connect button */}
            <div className="flex shrink-0 flex-col items-center gap-3 border-t border-white/10 p-5">
              <button
                type="button"
                onClick={() => (active ? disconnect() : void connect())}
                disabled={state.status === "connecting"}
                aria-label={active ? "End voice session" : "Start voice session"}
                className={cn(
                  "relative flex h-14 w-14 items-center justify-center rounded-full border transition-all outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-4 focus-visible:ring-offset-black",
                  active
                    ? "border-red-500/50 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                    : "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
                  state.status === "connecting" && "opacity-60",
                )}
              >
                {active ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                {state.status === "listening" && (
                  <span className="absolute inset-0 animate-ping rounded-full border border-emerald-400/40" />
                )}
              </button>
              <p className="font-mono text-[10px] text-zinc-500">
                {active
                  ? "Pause to commit · speak over agent to interrupt"
                  : "Press to connect · microphone required"}
              </p>
            </div>
          </div>
        </div>

        <VoiceSessionPanel
          status={state.status}
          session={session}
          lastUsage={lastUsage}
          stats={stats}
          voicePerMinuteUsd={budget?.pricing.voice_per_minute_usd ?? 0.05}
          remainingUsd={budget?.usd.remaining ?? null}
          secondsLeft={secondsLeft}
        />
      </main>
    </div>
  );
}

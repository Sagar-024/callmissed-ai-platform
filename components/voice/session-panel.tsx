"use client";

import { VOICE_STATE_META, type VoiceStatus } from "@/lib/voice/fsm";
import type { VoiceSessionResponse } from "@/lib/schemas";
import type { VoiceSessionStats, VoiceTurnUsage } from "@/lib/voice/use-voice-agent";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate font-mono text-zinc-300">{value}</span>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-white/20 p-[3px]">
      <div className="rounded-[11px] border border-white/10 bg-black p-4">
        {children}
      </div>
    </div>
  );
}

export function VoiceSessionPanel({
  status,
  session,
  lastUsage,
  stats,
  voicePerMinuteUsd,
  remainingUsd,
  secondsLeft,
}: {
  status: VoiceStatus;
  session: VoiceSessionResponse | null;
  lastUsage: VoiceTurnUsage | null;
  stats: VoiceSessionStats;
  voicePerMinuteUsd: number;
  remainingUsd: number | null;
  secondsLeft: number | null;
}) {
  const meta = VOICE_STATE_META[status];

  return (
    <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto lg:flex">
      <Panel>
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase">
            Session
          </span>
          <span
            className={`inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 font-mono text-[10px] tracking-widest uppercase ${meta.text}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
          <p className="text-xs leading-relaxed text-zinc-500">{meta.hint}</p>

          <div className="flex flex-col gap-2">
            <Row label="STT" value={session?.models.stt ?? "—"} />
            <Row label="TTS" value={session?.models.tts ?? "—"} />
            <Row label="Session" value={session ? `${session.session_id.slice(0, 8)}…` : "—"} />
            <Row label="Token TTL" value={secondsLeft !== null ? `${secondsLeft}s` : "—"} />
            <Row label="Per-minute" value={`$${voicePerMinuteUsd.toFixed(3)}`} />
            {remainingUsd !== null && <Row label="Budget left" value={`$${remainingUsd.toFixed(4)}`} />}
          </div>
        </div>
      </Panel>

      {lastUsage && (
        <Panel>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase">
              Last turn
            </span>
            <Row label="Audio" value={`${lastUsage.audio_seconds}s · $${lastUsage.audio_usd.toFixed(4)}`} />
            <Row label="Tokens" value={`${lastUsage.prompt_tokens}↑ ${lastUsage.completion_tokens}↓`} />
            <Row label="Chat" value={`$${lastUsage.chat_usd.toFixed(4)}`} />
            <Row label="Total" value={`$${lastUsage.total_usd.toFixed(4)}`} />
          </div>
        </Panel>
      )}

      <Panel>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase">
            Totals
          </span>
          <Row label="Turns" value={String(stats.turns)} />
          <Row label="Audio" value={`${stats.audioSeconds}s`} />
          <Row label="Cost" value={`$${stats.costUsd.toFixed(4)}`} />
        </div>
      </Panel>
    </aside>
  );
}

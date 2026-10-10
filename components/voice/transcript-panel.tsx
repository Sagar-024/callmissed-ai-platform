"use client";

import { useEffect, useRef } from "react";
import type { VoiceTranscriptEntry } from "@/lib/voice/use-voice-agent";
import { cn } from "@/lib/utils";

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function TranscriptPanel({
  entries,
  thinking,
  className,
}: {
  entries: VoiceTranscriptEntry[];
  thinking: boolean;
  className?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, thinking]);

  if (entries.length === 0 && !thinking) {
    return (
      <div className={cn("flex flex-1 items-center justify-center p-6", className)}>
        <p className="text-center text-[13px] leading-relaxed text-zinc-500">
          Speak after the ring turns green — a brief pause commits your turn.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4", className)}>
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "flex items-start gap-2.5",
            entry.role === "user" ? "justify-end" : "justify-start",
          )}
        >
          {entry.role === "assistant" && (
            <span className="mt-0.5 flex h-5 shrink-0 items-center rounded-md border border-white/15 px-1.5 font-mono text-[9px] tracking-widest text-zinc-500 uppercase">
              AI
            </span>
          )}
          <div
            className={cn(
              "flex max-w-[85%] flex-col gap-1 rounded-xl px-3 py-2 text-sm leading-6",
              entry.role === "user"
                ? "rounded-br-sm bg-white/[0.06] text-zinc-200"
                : "rounded-bl-sm bg-white/[0.03] text-zinc-300",
            )}
          >
            <span className="break-words">{entry.text}</span>
            <span className="font-mono text-[9px] tracking-wider text-zinc-600 uppercase">
              {entry.role} · {formatTime(entry.at)}
            </span>
          </div>
          {entry.role === "user" && (
            <span className="mt-0.5 flex h-5 shrink-0 items-center rounded-md border border-white/15 px-1.5 font-mono text-[9px] tracking-widest text-zinc-500 uppercase">
              You
            </span>
          )}
        </div>
      ))}
      {thinking && (
        <div className="flex items-center gap-2 pl-9 text-xs text-zinc-500">
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
          </span>
          thinking…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

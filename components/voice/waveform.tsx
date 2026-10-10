"use client";

import { useEffect, useRef } from "react";
import type { VoiceStatus } from "@/lib/voice/fsm";
import { cn } from "@/lib/utils";

const STATE_COLORS: Record<VoiceStatus, string> = {
  idle: "156 163 175",
  connecting: "251 191 36",
  listening: "52 211 153",
  thinking: "167 139 250",
  speaking: "34 211 238",
  error: "248 113 113",
};

export function Waveform({
  status,
  levelsRef,
  playbackLevelRef,
  className,
}: {
  status: VoiceStatus;
  levelsRef: React.RefObject<number[]>;
  playbackLevelRef: React.RefObject<{ value: number; at: number }>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(Math.floor(rect.width * dpr), 1);
      const height = Math.max(Math.floor(rect.height * dpr), 1);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);
      const rgb = STATE_COLORS[status] ?? STATE_COLORS.idle;
      const mid = height / 2;

      ctx.strokeStyle = `rgba(${rgb}, 0.25)`;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();

      const levels = levelsRef.current ?? [];
      const bars = Math.min(levels.length, 160);
      const barWidth = width / 160;
      const playback = playbackLevelRef.current ?? { value: 0, at: 0 };
      const decay = Math.exp(-(performance.now() - playback.at) / 350);
      const playbackLevel = playback.value * decay;

      for (let i = 0; i < bars; i += 1) {
        const level = Math.max(levels[levels.length - bars + i] ?? 0, i > bars - 8 ? playbackLevel : 0);
        const barHeight = Math.max(level * mid * 0.92, dpr);
        const x = width - (bars - i) * barWidth;
        ctx.fillStyle = `rgba(${rgb}, ${0.35 + level * 0.65})`;
        ctx.fillRect(x + barWidth * 0.15, mid - barHeight, barWidth * 0.7, barHeight * 2);
      }

      if (status === "listening" || status === "speaking" || status === "thinking") {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
        ctx.fillStyle = `rgba(${rgb}, ${0.6 + pulse * 0.4})`;
        ctx.beginPath();
        ctx.arc(width / 2, mid, dpr * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [status, levelsRef, playbackLevelRef]);

  return <canvas ref={canvasRef} className={cn("h-full w-full", className)} aria-hidden />;
}

"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Image as ImageIcon, MessagesSquare, Mic } from "lucide-react";
import { BudgetMeter } from "@/components/dashboard/budget-meter";

type ModuleDescriptor = {
  href: string;
  module: string;
  title: string;
  description: string;
  icon: ReactNode;
  tags: string[];
};

const modules: ModuleDescriptor[] = [
  {
    href: "/chat",
    module: "A",
    title: "Text Chat",
    description: "SSE token streaming with markdown rendering and per-request budget telemetry.",
    icon: <MessagesSquare className="h-4 w-4" />,
    tags: ["SSE", "Markdown", "FSM"],
  },
  {
    href: "/images",
    module: "B",
    title: "Image Studio",
    description: "Asynchronous generation jobs with an IndexedDB-persistent gallery.",
    icon: <ImageIcon className="h-4 w-4" />,
    tags: ["Async", "Gallery", "IndexedDB"],
  },
  {
    href: "/voice",
    module: "C",
    title: "Voice Agent",
    description: "Real-time voice with VAD interruption, live transcripts, and a waveform.",
    icon: <Mic className="h-4 w-4" />,
    tags: ["16 kHz PCM", "VAD", "Realtime"],
  },
];

export function DashboardShell() {
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5">
          <Link
            href="/"
            className="rounded-md text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            CallMissed
          </Link>
          <BudgetMeter className="hidden sm:flex" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="grid gap-3 md:grid-cols-3"
        >
          {modules.map((mod) => (
            <Link
              key={mod.href}
              href={mod.href}
              onMouseMove={handleMouseMove}
              className="group relative block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-black"
            >
              {/* outer frame */}
              <div className="relative rounded-[14px] border border-white/25 p-[5px] transition-all duration-500 ease-out group-hover:border-white/50 group-hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_40px_-8px_rgba(255,255,255,0.12)]">
                {/* corner accents */}
                <span className="pointer-events-none absolute -top-px -left-px h-3.5 w-3.5 rounded-tl-[13px] border-t-2 border-l-2 border-white/40 transition-all duration-500 group-hover:border-white/90" />
                <span className="pointer-events-none absolute -top-px -right-px h-3.5 w-3.5 rounded-tr-[13px] border-t-2 border-r-2 border-white/40 transition-all duration-500 group-hover:border-white/90" />
                <span className="pointer-events-none absolute -bottom-px -left-px h-3.5 w-3.5 rounded-bl-[13px] border-b-2 border-l-2 border-white/40 transition-all duration-500 group-hover:border-white/90" />
                <span className="pointer-events-none absolute -right-px -bottom-px h-3.5 w-3.5 rounded-br-[13px] border-r-2 border-b-2 border-white/40 transition-all duration-500 group-hover:border-white/90" />

                {/* inner card */}
                <div className="relative flex h-full flex-col gap-5 overflow-hidden rounded-[10px] border border-white/20 bg-black p-6 transition-colors duration-500 group-hover:border-white/35">
                  {/* hover gradient sweep */}
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),rgba(255,255,255,0.05),transparent_40%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                  <div className="relative flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/25 text-zinc-400 transition-all duration-500 group-hover:border-white/50 group-hover:text-zinc-200">
                      {mod.icon}
                    </span>
                    <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase transition-colors duration-500 group-hover:text-zinc-300">
                      {mod.module}
                    </span>
                  </div>

                  <div className="relative flex flex-col gap-2">
                    <h2 className="text-[15px] font-medium tracking-tight text-zinc-200 transition-colors duration-300 group-hover:text-white">
                      {mod.title}
                    </h2>
                    <p className="text-[13px] leading-relaxed text-zinc-400 transition-colors duration-300 group-hover:text-zinc-300">
                      {mod.description}
                    </p>
                  </div>

                  <div className="relative mt-auto flex items-center justify-between gap-3 pt-1">
                    <div className="flex flex-wrap gap-1.5">
                      {mod.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-white/20 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition-all duration-500 group-hover:border-white/35 group-hover:bg-white/[0.08] group-hover:text-zinc-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-all duration-500 group-hover:translate-x-1 group-hover:text-zinc-200" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </motion.div>
      </main>
    </div>
  );
}

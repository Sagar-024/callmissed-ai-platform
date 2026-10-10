"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { BudgetSnapshot } from "@/lib/schemas";

export function BudgetMeter({ className }: { className?: string }) {
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const res = await fetch("/api/budget", { cache: "no-store" });
        if (!res.ok) throw new Error("budget request failed");
        const data = (await res.json()) as BudgetSnapshot;
        if (!active) return;
        setSnapshot(data);
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      }
    };

    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const limit = snapshot?.usd.limit ?? 0;
  const used = snapshot?.usd.used ?? 0;
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

  if (failed || !snapshot) {
    return (
      <div
        className={cn(
          "flex items-center rounded-full border border-white/15 bg-white/[0.03] px-4 py-2",
          className,
        )}
      >
        <span className="font-mono text-xs text-zinc-500">budget offline</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-full border border-white/15 bg-white/[0.03] px-4 py-2",
        className,
      )}
      title="Daily spend against the server-side budget cap"
    >
      <span className="font-mono text-xs whitespace-nowrap">
        <span className="text-zinc-200">${used.toFixed(3)}</span>
        <span className="text-zinc-500"> / ${limit.toFixed(2)}</span>
      </span>
      <Progress value={percent} className="h-1 w-16" />
      <span className="font-mono text-[10px] whitespace-nowrap text-zinc-500">
        {snapshot.tokens.used.toLocaleString()} tok
      </span>
    </div>
  );
}

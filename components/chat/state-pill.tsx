"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CHAT_STATE_META, type ChatStatus } from "@/lib/chat/fsm";
import { cn } from "@/lib/utils";

export function StatePill({ status, className }: { status: ChatStatus; className?: string }) {
  const meta = CHAT_STATE_META[status];

  return (
    <div
      className={cn(
        "glass-subtle inline-flex items-center gap-2 rounded-full px-3 py-1.5",
        className,
      )}
      title={meta.hint}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 5 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "font-mono text-[11px] tracking-[0.14em] uppercase",
            meta.text,
          )}
        >
          {meta.label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

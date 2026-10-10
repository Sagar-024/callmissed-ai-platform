"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MarkdownStream } from "@/components/chat/markdown";
import type { ChatUiMessage } from "@/lib/chat/use-chat";
import { cn } from "@/lib/utils";

export function MessageList({ messages }: { messages: ChatUiMessage[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const element = containerRef.current;
    if (element && stickRef.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const handleScroll = () => {
    const element = containerRef.current;
    if (!element) return;
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-5 sm:px-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatUiMessage }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn("flex w-full gap-3", isUser && "justify-end")}
    >
      {!isUser && (
        <span className="mt-1 flex h-6 shrink-0 items-center rounded-md border border-border/70 px-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          AI
        </span>
      )}

      <div className={cn("flex max-w-[85%] min-w-0 flex-col gap-1.5", isUser && "items-end")}>
        <div
          className={cn(
            isUser
              ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"
              : "glass rounded-2xl rounded-bl-md px-4 py-3",
          )}
        >
          {isUser ? (
            <p className="text-sm leading-6 break-words whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownStream
              content={message.content}
              streaming={message.status === "streaming"}
              className="min-w-0"
            />
          )}
        </div>

        {!isUser && <UsageFooter message={message} />}
      </div>
    </motion.div>
  );
}

function UsageFooter({ message }: { message: ChatUiMessage }) {
  const aborted = message.finishReason === "aborted";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 font-mono text-[10px] text-muted-foreground">
      {aborted && (
        <span className="rounded border border-orange-500/30 bg-orange-500/10 px-1 py-px text-orange-300">
          aborted
        </span>
      )}
      {message.finishReason && !aborted && (
        <span className="rounded border border-border/70 px-1 py-px">
          finish: {message.finishReason}
        </span>
      )}
      {message.usage && (
        <>
          <span>
            {message.usage.prompt_tokens}↑ {message.usage.completion_tokens}↓ tok
          </span>
          <span aria-hidden>·</span>
          <span>${message.usage.cost_usd.toFixed(5)}</span>
          <span
            className={cn(
              "rounded border px-1 py-px",
              message.usage.billed
                ? "border-emerald-500/30 text-emerald-400"
                : "border-amber-500/30 text-amber-400",
            )}
          >
            {message.usage.billed ? "gateway billed" : "estimated"}
          </span>
        </>
      )}
      {message.status === "error" && (
        <span className="rounded border border-red-500/30 bg-red-500/10 px-1 py-px text-red-300">
          stream error
        </span>
      )}
    </div>
  );
}

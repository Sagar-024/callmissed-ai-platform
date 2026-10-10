"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Clock,
  Copy,
  Download,
  Maximize2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { aspectRatioCss, imageFileName } from "@/lib/images/dimensions";
import type { GalleryItem } from "@/lib/images/cache";
import type { ActiveImageJob } from "@/lib/images/use-image-studio";
import { cn } from "@/lib/utils";

export function SkeletonCard({ job }: { job: ActiveImageJob }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, Math.round((now - job.started_at) / 1000));
  const running = job.status === "running";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="glass flex flex-col overflow-hidden rounded-xl"
    >
      <div
        className="relative w-full animate-pulse bg-muted/40"
        style={{ aspectRatio: aspectRatioCss(job.size) }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-cyan-500/10" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
          <span className="relative flex h-9 w-9 items-center justify-center">
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full",
                running ? "bg-violet-400/20" : "bg-amber-400/20",
                "animate-ping",
              )}
            />
            <Clock
              className={cn(
                "relative h-4.5 w-4.5",
                running ? "text-violet-300" : "text-amber-300",
              )}
            />
          </span>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            {running ? `Generating · poll #${job.pollAttempt + 1}` : "Queued"}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{elapsed}s</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{job.prompt}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[9px] tracking-wider">
            {job.model}
          </Badge>
          <Badge variant="outline" className="font-mono text-[9px] tracking-wider">
            {job.size}
          </Badge>
          {job.n > 1 && (
            <Badge variant="outline" className="font-mono text-[9px] tracking-wider">
              ×{job.n}
            </Badge>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function ResolvedCard({
  item,
  src,
  index,
  total,
  onPreview,
  onRemove,
}: {
  item: GalleryItem;
  src: string;
  index: number;
  total: number;
  onPreview: () => void;
  onRemove: () => void;
}) {
  const handleCopy = (event: React.MouseEvent) => {
    event.stopPropagation();
    void navigator.clipboard
      .writeText(src)
      .then(() => toast.success("Data URI copied to clipboard"))
      .catch(() => toast.error("Clipboard write failed"));
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="glass group relative flex cursor-pointer flex-col overflow-hidden rounded-xl outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onPreview}
      onKeyDown={(event) => {
        if (event.key === "Enter") onPreview();
      }}
      role="button"
      tabIndex={0}
      aria-label={`Preview generated image ${index + 1} of ${total}`}
    >
      <div className="relative w-full overflow-hidden bg-muted/20" style={{ aspectRatio: aspectRatioCss(item.size) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={item.prompt}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />

        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <CardAction label="Preview" onClick={onPreview}>
            <Maximize2 className="h-3.5 w-3.5" />
          </CardAction>
          <a
            href={src}
            download={imageFileName(item.model, item.id, index)}
            onClick={(event) => event.stopPropagation()}
            aria-label="Download image"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
          <CardAction label="Copy data URI" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" />
          </CardAction>
          <CardAction label="Remove" onClick={(event) => { event.stopPropagation(); onRemove(); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </CardAction>
        </div>

        {total > 1 && (
          <span className="absolute top-2 left-2 rounded border border-white/15 bg-black/50 px-1.5 py-0.5 font-mono text-[9px] text-white/90 backdrop-blur-sm">
            {index + 1}/{total}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{item.prompt}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[9px] tracking-wider">
            {item.model}
          </Badge>
          <Badge variant="outline" className="font-mono text-[9px] tracking-wider">
            {item.size}
          </Badge>
          <span className="ml-auto font-mono text-[10px] text-emerald-400">
            ${item.cost_usd?.toFixed(3) ?? "—"}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function FailedCard({
  item,
  onDismiss,
}: {
  item: GalleryItem;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-4"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[10px] tracking-wider text-red-300 uppercase">
            generation failed
          </span>
          <p className="text-xs leading-5 break-words text-red-200/90">
            {item.error?.message ?? "Unknown error."}
          </p>
          <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {item.prompt}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="self-start font-mono text-[10px] tracking-wider text-muted-foreground uppercase underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        dismiss
      </button>
    </motion.div>
  );
}

function CardAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
    >
      {children}
    </button>
  );
}

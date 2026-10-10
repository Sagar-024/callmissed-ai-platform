"use client";

import { useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FailedCard, ResolvedCard, SkeletonCard } from "@/components/images/image-card";
import type { GalleryItem } from "@/lib/images/cache";
import type { ActiveImageJob } from "@/lib/images/use-image-studio";

const SUGGESTIONS = [
  "A neon-lit ramen stand in a rainy Osaka alley, cinematic lighting, 35mm film grain",
  "Isometric illustration of a tiny floating datacenter server rack, pastel gradients",
  "Macro photo of dew on a spider web at dawn, shallow depth of field",
];

type Tile =
  | { kind: "skeleton"; job: ActiveImageJob; key: string }
  | { kind: "image"; item: GalleryItem; src: string; index: number; total: number; key: string }
  | { kind: "failed"; item: GalleryItem; key: string };

type Props = {
  active: ActiveImageJob[];
  gallery: GalleryItem[];
  hydrated: boolean;
  onPreview: (item: GalleryItem, src: string, index: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onPickSuggestion: (text: string) => void;
};

export function ImageGallery({
  active,
  gallery,
  hydrated,
  onPreview,
  onRemove,
  onClear,
  onPickSuggestion,
}: Props) {
  const tiles = useMemo<Tile[]>(() => {
    const list: Tile[] = [];
    for (const job of active) {
      list.push({ kind: "skeleton", job, key: `sk_${job.id}` });
    }
    for (const item of gallery) {
      if (item.error || item.images.length === 0) {
        list.push({ kind: "failed", item, key: `fail_${item.id}` });
        continue;
      }
      item.images.forEach((src, index) => {
        list.push({
          kind: "image",
          item,
          src,
          index,
          total: item.images.length,
          key: `img_${item.id}_${index}`,
        });
      });
    }
    return list;
  }, [active, gallery]);

  const imageCount = gallery.reduce((sum, item) => sum + item.images.length, 0);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {tiles.length > 0 && (
        <div className="flex shrink-0 items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase">
            {imageCount} image{imageCount === 1 ? "" : "s"}
            {active.length > 0 ? ` · ${active.length} running` : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[11px] text-zinc-500 hover:text-zinc-300"
            onClick={onClear}
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </Button>
        </div>
      )}

      {tiles.length === 0 ? (
        hydrated ? (
          <EmptyState onPickSuggestion={onPickSuggestion} />
        ) : (
          <div className="flex flex-1 items-center justify-center py-24">
            <span className="animate-pulse font-mono text-[11px] tracking-[0.15em] text-zinc-600 uppercase">
              loading…
            </span>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {tiles.map((tile) => {
              if (tile.kind === "skeleton") return <SkeletonCard key={tile.key} job={tile.job} />;
              if (tile.kind === "failed") {
                return <FailedCard key={tile.key} item={tile.item} onDismiss={() => onRemove(tile.item.id)} />;
              }
              return (
                <ResolvedCard
                  key={tile.key}
                  item={tile.item}
                  src={tile.src}
                  index={tile.index}
                  total={tile.total}
                  onPreview={() => onPreview(tile.item, tile.src, tile.index)}
                  onRemove={() => onRemove(tile.item.id)}
                />
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPickSuggestion }: { onPickSuggestion: (text: string) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-base font-medium tracking-tight text-zinc-200">No images yet</h2>
          <p className="text-[13px] leading-relaxed text-zinc-500">
            Describe what you want and hit Generate. Results persist in IndexedDB.
          </p>
        </div>
        <div className="flex w-full flex-col gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onPickSuggestion(suggestion)}
              className="rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-left text-[13px] leading-5 text-zinc-400 transition-all duration-300 outline-none hover:border-white/25 hover:bg-white/[0.05] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

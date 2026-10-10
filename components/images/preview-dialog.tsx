"use client";

import { Copy, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { imageFileName } from "@/lib/images/dimensions";
import type { GalleryItem } from "@/lib/images/cache";

type Props = {
  item: GalleryItem | null;
  src: string | null;
  index: number;
  total: number;
  onOpenChange: (open: boolean) => void;
  onRemove: () => void;
};

export function PreviewDialog({ item, src, index, total, onOpenChange, onRemove }: Props) {
  if (!item || !src) {
    return (
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent className="hidden" />
      </Dialog>
    );
  }

  const copyUri = () => {
    void navigator.clipboard
      .writeText(src)
      .then(() => toast.success("Data URI copied to clipboard"))
      .catch(() => toast.error("Clipboard write failed"));
  };

  const copyPrompt = () => {
    void navigator.clipboard
      .writeText(item.prompt)
      .then(() => toast.success("Prompt copied"))
      .catch(() => toast.error("Clipboard write failed"));
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(96vw,64rem)] gap-3 border border-border/60 bg-popover/95 p-3 backdrop-blur-md sm:max-w-[min(96vw,64rem)]"
        showCloseButton
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Generated image preview</DialogTitle>
          <DialogDescription className="line-clamp-2">{item.prompt}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="line-clamp-1 text-sm font-medium">{item.prompt}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-mono text-[9px] tracking-wider">
                {item.model}
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px] tracking-wider">
                {item.size}
              </Badge>
              {total > 1 && (
                <Badge variant="outline" className="font-mono text-[9px] tracking-wider">
                  {index + 1}/{total}
                </Badge>
              )}
              <span className="font-mono text-[10px] text-emerald-400">
                ${item.cost_usd?.toFixed(3) ?? "—"}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {new Date(item.created_at).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-black/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={item.prompt}
            className="max-h-[68vh] w-auto object-contain"
          />
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copyPrompt}>
              <Copy className="h-3.5 w-3.5" />
              Copy prompt
            </Button>
            <Button variant="outline" size="sm" onClick={copyUri}>
              <Copy className="h-3.5 w-3.5" />
              Copy data URI
            </Button>
            <Button variant="outline" size="sm" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
          <Button size="sm" asChild>
            <a href={src} download={imageFileName(item.model, item.id, index)}>
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

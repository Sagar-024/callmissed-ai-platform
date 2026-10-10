"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BudgetMeter } from "@/components/dashboard/budget-meter";
import { ImageGallery } from "@/components/images/gallery";
import { PreviewDialog } from "@/components/images/preview-dialog";
import { PromptPanel } from "@/components/images/prompt-panel";
import { useImageStudio } from "@/lib/images/use-image-studio";
import type { GalleryItem } from "@/lib/images/cache";
import type { BudgetResponse } from "@/lib/schemas";

type PreviewState = { item: GalleryItem; src: string; index: number } | null;

export function ImageStudio() {
  const { active, gallery, hydrated, error, dismissError, generate, removeItem, clearGallery } =
    useImageStudio();

  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [model, setModel] = useState("flux-2-pro");
  const [size, setSize] = useState("1024x1024");
  const [n, setN] = useState(1);
  const [costEachUsd, setCostEachUsd] = useState(0.04);
  const [preview, setPreview] = useState<PreviewState>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      try {
        const res = await fetch("/api/budget", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as BudgetResponse;
        if (cancelled) return;
        if (payload.models.image.length > 0) {
          setModels([...payload.models.image]);
          setModel((current) =>
            payload.models.image.some((entry) => entry.id === current)
              ? current
              : payload.models.image[0].id,
          );
        }
        if (typeof payload.pricing?.image_each_usd === "number") {
          setCostEachUsd(payload.pricing.image_each_usd);
        }
      } catch {
        // catalog stays at defaults
      }
    };

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    toast.error(error.message, { description: error.code });
    dismissError();
  }, [error, dismissError]);

  const handleGenerate = useCallback(() => {
    const value = prompt.trim();
    if (!value) return;
    void generate({ prompt: value, model, size, n });
  }, [prompt, model, size, n, generate]);

  const handlePreview = useCallback((item: GalleryItem, src: string, index: number) => {
    setPreview({ item, src, index });
  }, []);

  const closePreview = useCallback((open: boolean) => {
    if (!open) setPreview(null);
  }, []);

  const removePreviewItem = useCallback(() => {
    if (!preview) return;
    void removeItem(preview.item.id);
    setPreview(null);
  }, [preview, removeItem]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link href="/" aria-label="Back to dashboard">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span className="text-sm font-medium tracking-tight text-zinc-200">
              Image Studio
            </span>
          </div>

          <div className="flex items-center gap-2">
            <BudgetMeter className="hidden md:flex" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void clearGallery()}
              disabled={gallery.length === 0 && active.length === 0}
              aria-label="Clear gallery"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-3 overflow-hidden px-4 py-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* prompt panel */}
        <div className="hidden min-h-0 flex-col overflow-y-auto rounded-[14px] border border-white/20 p-[3px] lg:flex">
          <div className="h-full rounded-[11px] border border-white/10 bg-black p-4">
            <PromptPanel
              prompt={prompt}
              onPromptChange={setPrompt}
              models={models}
              model={model}
              onModelChange={setModel}
              size={size}
              onSizeChange={setSize}
              n={n}
              onNChange={setN}
              onGenerate={handleGenerate}
              busy={active.length >= 4}
              costEachUsd={costEachUsd}
            />
          </div>
        </div>

        {/* gallery */}
        <div className="flex min-h-0 flex-col overflow-y-auto">
          <ImageGallery
            active={active}
            gallery={gallery}
            hydrated={hydrated}
            onPreview={handlePreview}
            onRemove={(id) => void removeItem(id)}
            onClear={() => void clearGallery()}
            onPickSuggestion={setPrompt}
          />
        </div>
      </main>

      {/* mobile prompt panel */}
      <div className="border-t border-white/10 p-4 lg:hidden">
        <PromptPanel
          prompt={prompt}
          onPromptChange={setPrompt}
          models={models}
          model={model}
          onModelChange={setModel}
          size={size}
          onSizeChange={setSize}
          n={n}
          onNChange={setN}
          onGenerate={handleGenerate}
          busy={active.length >= 4}
          costEachUsd={costEachUsd}
        />
      </div>

      <PreviewDialog
        item={preview?.item ?? null}
        src={preview?.src ?? null}
        index={preview?.index ?? 0}
        total={preview?.item.images.length ?? 0}
        onOpenChange={closePreview}
        onRemove={removePreviewItem}
      />
    </div>
  );
}

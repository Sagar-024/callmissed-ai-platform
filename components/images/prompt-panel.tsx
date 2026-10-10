"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ModelOption } from "@/lib/schemas";

export const SIZE_OPTIONS = [
  { id: "1024x1024", label: "Square · 1024×1024" },
  { id: "1280x720", label: "Landscape · 1280×720" },
  { id: "720x1280", label: "Portrait · 720×1280" },
  { id: "896x1152", label: "Portrait · 896×1152" },
] as const;

const N_OPTIONS = [1, 2, 3, 4] as const;

type Props = {
  prompt: string;
  onPromptChange: (value: string) => void;
  models: readonly ModelOption[];
  model: string;
  onModelChange: (model: string) => void;
  size: string;
  onSizeChange: (size: string) => void;
  n: number;
  onNChange: (n: number) => void;
  onGenerate: () => void;
  busy: boolean;
  costEachUsd: number;
};

export function PromptPanel({
  prompt,
  onPromptChange,
  models,
  model,
  onModelChange,
  size,
  onSizeChange,
  n,
  onNChange,
  onGenerate,
  busy,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="Describe the image you want…"
        aria-label="Image prompt"
        rows={5}
        className="min-h-[110px] resize-none border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm leading-6 placeholder:text-zinc-600 focus-visible:border-white/25"
      />

      <div className="flex flex-col gap-3">
        <Field label="Model">
          <Select value={model} onValueChange={onModelChange}>
            <SelectTrigger
              className="h-9 w-full gap-2 border border-white/15 bg-white/[0.03] px-3 font-mono text-[11px] text-zinc-300 hover:border-white/25"
              aria-label="Image model"
            >
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent className="border-white/15 bg-black">
              {models.map((entry) => (
                <SelectItem key={entry.id} value={entry.id} className="text-xs focus:bg-white/[0.06]">
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Size">
          <Select value={size} onValueChange={onSizeChange}>
            <SelectTrigger
              className="h-9 w-full gap-2 border border-white/15 bg-white/[0.03] px-3 font-mono text-[11px] text-zinc-300 hover:border-white/25"
              aria-label="Image size"
            >
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent className="border-white/15 bg-black">
              {SIZE_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id} className="text-xs focus:bg-white/[0.06]">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Count">
          <Select value={String(n)} onValueChange={(value) => onNChange(Number(value))}>
            <SelectTrigger
              className="h-9 w-full gap-2 border border-white/15 bg-white/[0.03] px-3 font-mono text-[11px] text-zinc-300 hover:border-white/25"
              aria-label="Image count"
            >
              <SelectValue placeholder="Count" />
            </SelectTrigger>
            <SelectContent className="border-white/15 bg-black">
              {N_OPTIONS.map((count) => (
                <SelectItem key={count} value={String(count)} className="text-xs focus:bg-white/[0.06]">
                  {count} image{count > 1 ? "s" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Button
        size="sm"
        className="h-9 w-full border border-white/20 bg-white/[0.06] px-4 text-zinc-200 hover:border-white/40 hover:bg-white/[0.1] hover:text-white"
        onClick={onGenerate}
        disabled={busy || prompt.trim().length === 0}
      >
        Generate
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] tracking-[0.15em] text-zinc-500 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

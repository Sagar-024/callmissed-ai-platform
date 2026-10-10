"use client";

import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ModelPrice } from "@/lib/schemas";

const MAX_TOKEN_OPTIONS = [256, 512, 1024, 2048, 4096];

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  canSend: boolean;
  models: ModelPrice[];
  model: string;
  onModelChange: (model: string) => void;
  maxTokens: number;
  onMaxTokensChange: (tokens: number) => void;
};

export function Composer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  busy,
  canSend,
  models,
  model,
  onModelChange,
  maxTokens,
  onMaxTokensChange,
}: Props) {
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && canSend) onSubmit();
      }}
    >
      <Textarea
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!busy && canSend) onSubmit();
          }
        }}
        placeholder="Ask anything…"
        aria-label="Chat message"
        rows={3}
        className="max-h-40 min-h-[64px] resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select value={model} onValueChange={onModelChange}>
            <SelectTrigger
              className="h-9 w-[180px] gap-2 border border-white/15 bg-white/[0.03] px-3 font-mono text-[11px] text-zinc-300 hover:border-white/25"
              aria-label="Model"
            >
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent className="border-white/15 bg-black">
              {models.map((entry) => (
                <SelectItem
                  key={entry.id}
                  value={entry.id}
                  className="text-xs focus:bg-white/[0.06]"
                >
                  <span className="flex flex-col items-start gap-0.5">
                    <span>{entry.label}</span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      ${entry.input_per_mtok.toFixed(3)} / ${entry.output_per_mtok.toFixed(3)} per M
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(maxTokens)}
            onValueChange={(next) => onMaxTokensChange(Number(next))}
          >
            <SelectTrigger
              className="h-9 w-[110px] gap-2 border border-white/15 bg-white/[0.03] px-3 font-mono text-[11px] text-zinc-300 hover:border-white/25"
              aria-label="Max output tokens"
            >
              <SelectValue placeholder="Tokens" />
            </SelectTrigger>
            <SelectContent className="border-white/15 bg-black">
              {MAX_TOKEN_OPTIONS.map((tokens) => (
                <SelectItem
                  key={tokens}
                  value={String(tokens)}
                  className="text-xs focus:bg-white/[0.06]"
                >
                  {tokens} tokens
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {busy ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-9 border border-red-500/30 bg-red-500/10 px-4 text-red-300 hover:bg-red-500/20"
            onClick={onStop}
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Button
            type="submit"
            size="sm"
            className="h-9 border border-white/20 bg-white/[0.06] px-4 text-zinc-200 hover:border-white/40 hover:bg-white/[0.1] hover:text-white"
            disabled={!canSend || value.trim().length === 0}
          >
            <ArrowUp className="h-3.5 w-3.5" />
            Send
          </Button>
        )}
      </div>
    </form>
  );
}

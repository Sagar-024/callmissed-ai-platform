import { z } from "zod";

export const MAX_MESSAGES_PER_REQUEST = 100;
export const MAX_CONTENT_CHARS = 32000;
export const MAX_PROMPT_CHARS = 4000;

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().max(MAX_CONTENT_CHARS),
});

export const chatRequestSchema = z.object({
  model: z.string().min(1).max(120),
  messages: z.array(chatMessageSchema).min(1).max(MAX_MESSAGES_PER_REQUEST),
  max_tokens: z.number().int().min(1).max(4096).default(1024),
  temperature: z.number().min(0).max(2).optional(),
});

export const imageRequestSchema = z.object({
  model: z.string().min(1).max(120),
  prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
  n: z.number().int().min(1).max(4).default(1),
  size: z
    .string()
    .regex(/^\d{3,4}x\d{3,4}$/)
    .default("1024x1024"),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ImageRequest = z.infer<typeof imageRequestSchema>;

export type ChatStreamEvent =
  | { type: "token"; text: string }
  | {
      type: "usage";
      prompt_tokens: number;
      completion_tokens: number;
      cost_usd: number;
      billed: boolean;
    }
  | { type: "done"; finish_reason: string | null }
  | { type: "error"; code: string; message: string };

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    scope?: "rate_limit" | "budget" | "loop" | "validation" | "upstream";
    retry_after_ms?: number;
    details?: unknown;
  };
};

export type ImageJobStatus = "queued" | "running" | "succeeded" | "failed";

export type ImageJobResponse = {
  id: string;
  status: ImageJobStatus;
  prompt: string;
  model: string;
  n: number;
  size: string;
  images?: string[];
  cost_usd?: number;
  error?: { status?: number; message: string };
  created_at: number;
  updated_at: number;
};

export type BudgetSnapshot = {
  day: string;
  usd: { limit: number; used: number; remaining: number };
  tokens: { limit: number; used: number; remaining: number };
  concurrency: { active: number; limit: number };
  rate: Record<string, { limit: number; remaining: number; reset_ms: number }>;
};

export type ModelPrice = {
  id: string;
  label: string;
  category: "chat";
  context_window: number;
  input_per_mtok: number;
  output_per_mtok: number;
};

export type ModelOption = { id: string; label: string };

export type BudgetResponse = BudgetSnapshot & {
  models: {
    chat: ModelPrice[];
    image: readonly ModelOption[];
    voice: { stt: readonly ModelOption[]; tts: readonly ModelOption[] };
  };
  pricing: {
    image_each_usd: number;
    voice_per_minute_usd: number;
  };
};

export type VoiceSessionResponse = {
  session_id: string;
  token: string;
  expires_at: number;
  ws_path: string;
  models: { stt: string; tts: string };
  max_duration_seconds: number;
};

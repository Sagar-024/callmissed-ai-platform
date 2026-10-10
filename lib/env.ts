import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CALLMISSED_API_KEY: z.string().min(1),
  CALLMISSED_API_BASE_URL: z.url().default("https://api.callmissed.com/v1"),
  BUDGET_DAILY_USD: z.coerce.number().nonnegative().default(2),
  BUDGET_DAILY_TOKENS: z.coerce.number().int().nonnegative().default(1_000_000),
  MAX_PROMPT_TOKENS_PER_REQUEST: z.coerce.number().int().positive().default(16_000),
  MAX_OUTPUT_TOKENS_PER_REQUEST: z.coerce.number().int().positive().default(4_096),
  IMAGE_COST_USD_EACH: z.coerce.number().nonnegative().default(0.04),
  AUDIO_COST_USD_PER_MINUTE: z.coerce.number().nonnegative().default(0.05),
  RATE_LIMIT_CHAT_RPM: z.coerce.number().int().positive().default(24),
  RATE_LIMIT_IMAGE_RPM: z.coerce.number().int().positive().default(6),
  RATE_LIMIT_VOICE_RPM: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_BUDGET_RPM: z.coerce.number().int().positive().default(120),
  MAX_CONCURRENT_CHAT_STREAMS: z.coerce.number().int().positive().default(2),
  LOOP_DEDUPE_WINDOW_MS: z.coerce.number().int().nonnegative().default(4_000),
  VOICE_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  VOICE_SESSION_SECRET: z.string().optional(),
});

const parsed = envSchema.parse(process.env);

export const env = Object.freeze(parsed);

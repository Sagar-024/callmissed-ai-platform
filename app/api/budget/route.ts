import { snapshotFor, withBudget } from "@/lib/budget/guard";
import { refreshPricing } from "@/lib/budget/pricing";
import { CHAT_MODELS, IMAGE_MODELS, VOICE_MODELS } from "@/lib/catalog";
import { env } from "@/lib/env";
import type { BudgetResponse } from "@/lib/schemas";

export const GET = withBudget({ route: "budget" }, async (_req, _ctx, bc) => {
  void refreshPricing();

  const payload: BudgetResponse = {
    ...snapshotFor(bc.identity),
    models: { chat: CHAT_MODELS, image: IMAGE_MODELS, voice: VOICE_MODELS },
    pricing: {
      image_each_usd: env.IMAGE_COST_USD_EACH,
      voice_per_minute_usd: env.AUDIO_COST_USD_PER_MINUTE,
    },
  };

  return Response.json(payload);
});

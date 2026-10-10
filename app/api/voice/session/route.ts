import { withBudget } from "@/lib/budget/guard";
import { env } from "@/lib/env";
import { VOICE_MODELS } from "@/lib/catalog";
import { createVoiceSession } from "@/lib/voice/session";
import type { VoiceSessionResponse } from "@/lib/schemas";

export const maxDuration = 30;

export const POST = withBudget({ route: "voice" }, async (_req, _ctx, bc) => {
  const session = createVoiceSession(bc.identity);

  const payload: VoiceSessionResponse = {
    session_id: session.sessionId,
    token: session.token,
    expires_at: session.expiresAt,
    ws_path: "/api/voice/stream",
    models: { stt: VOICE_MODELS.stt[0].id, tts: VOICE_MODELS.tts[0].id },
    max_duration_seconds: Math.min(env.VOICE_SESSION_TTL_SECONDS, 600),
  };

  return Response.json(payload, { status: 201 });
});

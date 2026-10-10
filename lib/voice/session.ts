import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type VoiceClaims = {
  sid: string;
  exp: number;
  scope: "voice";
  identity: string;
};

function signingSecret(): Buffer {
  if (env.VOICE_SESSION_SECRET) return Buffer.from(env.VOICE_SESSION_SECRET, "utf8");
  return createHmac("sha256", env.CALLMISSED_API_KEY)
    .update("callmissed-voice-session-v1")
    .digest();
}

export function createVoiceSession(identity: string): {
  token: string;
  sessionId: string;
  expiresAt: number;
} {
  const claims: VoiceClaims = {
    sid: randomUUID(),
    exp: Date.now() + env.VOICE_SESSION_TTL_SECONDS * 1000,
    scope: "voice",
    identity,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, sessionId: claims.sid, expiresAt: claims.exp };
}

export function verifyVoiceSession(token: string): VoiceClaims | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", signingSecret()).update(payload).digest("base64url");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as VoiceClaims;
    if (claims.scope !== "voice") return null;
    if (typeof claims.sid !== "string" || typeof claims.identity !== "string") return null;
    if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

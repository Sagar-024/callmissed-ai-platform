export type ClientVoiceControl =
  | { type: "commit" }
  | { type: "interrupt" };

export type ServerVoiceControl =
  | { type: "ready"; session_id: string }
  | { type: "state"; status: "listening" | "thinking" | "speaking" }
  | { type: "audio_format"; sample_rate: number }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | {
      type: "usage";
      audio_seconds: number;
      audio_usd: number;
      prompt_tokens: number;
      completion_tokens: number;
      chat_usd: number;
      total_usd: number;
    }
  | { type: "agent_audio_end" }
  | { type: "error"; code: string; message: string };

export function parseClientControl(json: unknown): ClientVoiceControl | null {
  if (!json || typeof json !== "object") return null;
  const type = (json as { type?: unknown }).type;
  if (type === "commit" || type === "interrupt") return { type };
  return null;
}

export function parseServerControl(json: unknown): ServerVoiceControl | null {
  if (!json || typeof json !== "object") return null;
  const message = json as { type?: unknown };
  switch (message.type) {
    case "ready": {
      const m = json as { session_id?: unknown };
      if (typeof m.session_id !== "string") return null;
      return { type: "ready", session_id: m.session_id };
    }
    case "state": {
      const m = json as { status?: unknown };
      if (m.status !== "listening" && m.status !== "thinking" && m.status !== "speaking") return null;
      return { type: "state", status: m.status };
    }
    case "audio_format": {
      const m = json as { sample_rate?: unknown };
      if (typeof m.sample_rate !== "number" || !Number.isFinite(m.sample_rate)) return null;
      return { type: "audio_format", sample_rate: m.sample_rate };
    }
    case "transcript": {
      const m = json as { role?: unknown; text?: unknown };
      if (m.role !== "user" && m.role !== "assistant") return null;
      if (typeof m.text !== "string") return null;
      return { type: "transcript", role: m.role, text: m.text };
    }
    case "usage": {
      const m = json as Record<string, unknown>;
      const keys = [
        "audio_seconds",
        "audio_usd",
        "prompt_tokens",
        "completion_tokens",
        "chat_usd",
        "total_usd",
      ] as const;
      const numbers: Record<(typeof keys)[number], number> = {
        audio_seconds: 0,
        audio_usd: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        chat_usd: 0,
        total_usd: 0,
      };
      for (const key of keys) {
        const value = m[key];
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        numbers[key] = value;
      }
      return {
        type: "usage",
        audio_seconds: numbers.audio_seconds,
        audio_usd: numbers.audio_usd,
        prompt_tokens: numbers.prompt_tokens,
        completion_tokens: numbers.completion_tokens,
        chat_usd: numbers.chat_usd,
        total_usd: numbers.total_usd,
      };
    }
    case "agent_audio_end":
      return { type: "agent_audio_end" };
    case "error": {
      const m = json as { code?: unknown; message?: unknown };
      if (typeof m.code !== "string" || typeof m.message !== "string") return null;
      return { type: "error", code: m.code, message: m.message };
    }
    default:
      return null;
  }
}

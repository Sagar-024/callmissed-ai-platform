import type { ChatStreamEvent, ApiErrorBody } from "@/lib/schemas";
import type { ChatError } from "@/lib/chat/fsm";

const EVENT_TYPES = new Set(["token", "usage", "done", "error"]);

export function parseChatEvent(data: string): ChatStreamEvent | null {
  if (data === "[DONE]") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as { type?: unknown };
  if (typeof candidate.type !== "string" || !EVENT_TYPES.has(candidate.type)) return null;
  return parsed as ChatStreamEvent;
}

export async function readApiError(res: Response): Promise<ChatError> {
  try {
    const json = (await res.json()) as ApiErrorBody;
    if (json && typeof json === "object" && json.error && typeof json.error.message === "string") {
      return {
        code: json.error.code,
        message: json.error.message,
        scope: json.error.scope,
        retry_after_ms: json.error.retry_after_ms,
      };
    }
  } catch {
    // fall through to the generic message below
  }

  return {
    code: `http_${res.status}`,
    message: `Request failed with status ${res.status}.`,
  };
}

export function scopeMessage(scope: ChatError["scope"]): string | null {
  switch (scope) {
    case "budget":
      return "The daily budget guard rejected this request before any tokens were billed.";
    case "rate_limit":
      return "Per-client rate limit tripped. The window resets automatically.";
    case "loop":
      return "Loop suppression caught an identical payload. Vary the request or wait.";
    case "validation":
      return "The payload failed server-side schema validation.";
    case "upstream":
      return "The CallMissed gateway returned an error.";
    default:
      return null;
  }
}

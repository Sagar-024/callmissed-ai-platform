import type { ApiErrorBody } from "@/lib/schemas";

export type ChatStatus =
  | "idle"
  | "submitting"
  | "streaming"
  | "completed"
  | "aborted"
  | "error";

export type TurnUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  billed: boolean;
};

export type ChatError = {
  code: string;
  message: string;
  scope?: ApiErrorBody["error"]["scope"];
  retry_after_ms?: number;
};

export type ChatState = {
  status: ChatStatus;
  error: ChatError | null;
  usage: TurnUsage | null;
  turn: number;
};

export type ChatEvent =
  | { type: "SUBMIT" }
  | { type: "STREAM_START" }
  | { type: "DONE"; usage?: TurnUsage | null }
  | { type: "ABORT" }
  | { type: "FAIL"; error: ChatError }
  | { type: "RESET" };

export const initialChatState: ChatState = {
  status: "idle",
  error: null,
  usage: null,
  turn: 0,
};

const ALLOWED: Record<ChatStatus, readonly ChatStatus[]> = {
  idle: ["submitting", "idle"],
  submitting: ["streaming", "aborted", "error", "idle"],
  streaming: ["completed", "aborted", "error", "idle"],
  completed: ["submitting", "idle"],
  aborted: ["submitting", "idle"],
  error: ["submitting", "idle"],
};

function targetStatus(event: ChatEvent): ChatStatus {
  switch (event.type) {
    case "SUBMIT":
      return "submitting";
    case "STREAM_START":
      return "streaming";
    case "DONE":
      return "completed";
    case "ABORT":
      return "aborted";
    case "FAIL":
      return "error";
    case "RESET":
      return "idle";
  }
}

export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  const next = targetStatus(event);
  if (!ALLOWED[state.status].includes(next)) return state;

  switch (event.type) {
    case "SUBMIT":
      return { status: "submitting", error: null, usage: null, turn: state.turn + 1 };
    case "STREAM_START":
      return { ...state, status: "streaming", error: null };
    case "DONE":
      return { ...state, status: "completed", error: null, usage: event.usage ?? state.usage };
    case "ABORT":
      return { ...state, status: "aborted", error: null };
    case "FAIL":
      return { ...state, status: "error", error: event.error };
    case "RESET":
      return initialChatState;
  }
}

export function canSubmit(state: ChatState): boolean {
  return (
    state.status === "idle" ||
    state.status === "completed" ||
    state.status === "aborted" ||
    state.status === "error"
  );
}

export function isActiveStatus(status: ChatStatus): boolean {
  return status === "submitting" || status === "streaming";
}

export const CHAT_STATE_META: Record<
  ChatStatus,
  { label: string; hint: string; dot: string; text: string }
> = {
  idle: {
    label: "Idle",
    hint: "Ready for input",
    dot: "bg-zinc-400",
    text: "text-zinc-400",
  },
  submitting: {
    label: "Submitting",
    hint: "User message optimistically queued",
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-300",
  },
  streaming: {
    label: "Streaming",
    hint: "Receiving token deltas",
    dot: "bg-violet-400 animate-pulse",
    text: "text-violet-300",
  },
  completed: {
    label: "Completed",
    hint: "Turn finalized and billed",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
  },
  aborted: {
    label: "Aborted",
    hint: "Cancelled by user via AbortController",
    dot: "bg-orange-400",
    text: "text-orange-300",
  },
  error: {
    label: "Error",
    hint: "Request failed or was rejected",
    dot: "bg-red-400",
    text: "text-red-300",
  },
};

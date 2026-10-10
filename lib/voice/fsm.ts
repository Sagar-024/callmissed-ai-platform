export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type VoiceEvent =
  | { type: "CONNECT" }
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "FAIL"; message: string }
  | { type: "USER_COMMIT" }
  | { type: "AGENT_START" }
  | { type: "AGENT_END" }
  | { type: "INTERRUPT" }
  | { type: "RESET" };

export type VoiceState = {
  status: VoiceStatus;
  error: string | null;
};

export const initialVoiceState: VoiceState = { status: "idle", error: null };

const ALLOWED: Record<VoiceStatus, readonly VoiceStatus[]> = {
  idle: ["connecting"],
  connecting: ["listening", "error", "idle"],
  listening: ["thinking", "speaking", "error", "idle"],
  thinking: ["listening", "speaking", "error", "idle"],
  speaking: ["listening", "thinking", "error", "idle"],
  error: ["connecting", "idle"],
};

function targetStatus(event: VoiceEvent): VoiceStatus {
  switch (event.type) {
    case "CONNECT":
      return "connecting";
    case "OPEN":
      return "listening";
    case "USER_COMMIT":
      return "thinking";
    case "AGENT_START":
      return "speaking";
    case "AGENT_END":
      return "listening";
    case "INTERRUPT":
      return "listening";
    case "CLOSE":
      return "idle";
    case "FAIL":
      return "error";
    case "RESET":
      return "idle";
  }
}

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  const next = targetStatus(event);
  if (!ALLOWED[state.status].includes(next)) return state;

  switch (event.type) {
    case "CONNECT":
      return { status: "connecting", error: null };
    case "OPEN":
      return { status: "listening", error: null };
    case "USER_COMMIT":
      return { status: "thinking", error: null };
    case "AGENT_START":
      return { status: "speaking", error: null };
    case "AGENT_END":
      return { status: "listening", error: null };
    case "INTERRUPT":
      return { status: "listening", error: null };
    case "CLOSE":
      return { status: "idle", error: null };
    case "FAIL":
      return { status: "error", error: event.message };
    case "RESET":
      return initialVoiceState;
  }
}

export function isVoiceActive(status: VoiceStatus): boolean {
  return status === "connecting" || status === "listening" || status === "thinking" || status === "speaking";
}

export function canBargeIn(status: VoiceStatus): boolean {
  return status === "speaking" || status === "thinking";
}

export const VOICE_STATE_META: Record<
  VoiceStatus,
  { label: string; hint: string; dot: string; text: string }
> = {
  idle: {
    label: "Idle",
    hint: "Press connect to start a voice session",
    dot: "bg-zinc-400",
    text: "text-zinc-400",
  },
  connecting: {
    label: "Connecting",
    hint: "Minting ephemeral token and opening the duplex stream",
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-300",
  },
  listening: {
    label: "Listening",
    hint: "Speak naturally — pause briefly to commit your turn",
    dot: "bg-emerald-400 animate-pulse",
    text: "text-emerald-300",
  },
  thinking: {
    label: "Thinking",
    hint: "Transcribing, chatting, and synthesizing the reply",
    dot: "bg-violet-400 animate-pulse",
    text: "text-violet-300",
  },
  speaking: {
    label: "Speaking",
    hint: "The agent is talking — interrupt any time (barge-in)",
    dot: "bg-cyan-400 animate-pulse",
    text: "text-cyan-300",
  },
  error: {
    label: "Error",
    hint: "The session failed — check the message and retry",
    dot: "bg-red-400",
    text: "text-red-300",
  },
};

import type { NextRequest } from "next/server";
import { jsonError, resolveIdentity, roundUsd } from "@/lib/budget/guard";
import { chatUsageCostUsd, estimateChatCostUsd, estimateTokens } from "@/lib/budget/pricing";
import { store } from "@/lib/budget/store";
import { gatewayJSON, synthesizeSpeech, transcribeAudio } from "@/lib/gateway";
import { env } from "@/lib/env";
import { VOICE_MODELS } from "@/lib/catalog";
import { verifyVoiceSession } from "@/lib/voice/session";
import {
  FRAME_AUDIO,
  FRAME_CONTROL,
  VoiceFrameDecoder,
  encodeAudioFrame,
  encodeControlFrame,
} from "@/lib/voice/framing";
import { concatInt16, int16ToWav, parseWav } from "@/lib/voice/pcm";
import { parseClientControl } from "@/lib/voice/protocol";
import {
  attachDown,
  clearRelayIdleTimer,
  closeRelay,
  createRelay,
  enqueueUp,
  getRelay,
  type VoiceRelay,
} from "@/lib/voice/relay";

export const maxDuration = 300;

const STT_MODEL = VOICE_MODELS.stt[0].id;
const TTS_MODEL = VOICE_MODELS.tts[0].id;
const CHAT_MODEL = "claude-haiku-5-5";
const CHAT_MAX_TOKENS = 160;
const HISTORY_CAP = 12;
const MAX_TURN_SECONDS = 30;
const MIN_TURN_SECONDS = 0.4;
const MAX_MIC_SECONDS = 60;
const MAX_UP_BODY_BYTES = 64 * 1024;

const SYSTEM_PROMPT =
  "You are a concise voice assistant. Answer in one to three short spoken sentences. Plain text only: no markdown, no lists, no emoji.";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type UpstreamChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type Writer = WritableStreamDefaultWriter<Uint8Array>;

async function sendControl(writer: Writer, message: unknown): Promise<void> {
  await writer.write(encodeControlFrame(message));
}

async function runTurn(
  writer: Writer,
  history: ChatMessage[],
  rawPcm: Int16Array,
  signal: AbortSignal,
): Promise<void> {
  const minSamples = Math.floor(MIN_TURN_SECONDS * 16000);
  if (rawPcm.length < minSamples) {
    await sendControl(writer, { type: "transcript", role: "user", text: "" });
    await sendControl(writer, { type: "state", status: "listening" });
    return;
  }

  const maxSamples = MAX_TURN_SECONDS * 16000;
  const pcm = rawPcm.length > maxSamples ? rawPcm.slice(rawPcm.length - maxSamples) : rawPcm;
  const audioSeconds = pcm.length / 16000;
  const audioCost = (audioSeconds / 60) * env.AUDIO_COST_USD_PER_MINUTE;

  await sendControl(writer, { type: "state", status: "thinking" });

  const usage = store.usage();
  const projectedChat = estimateChatCostUsd(
    CHAT_MODEL,
    [...history.map((m) => ({ content: m.content })), { content: "voice turn" }],
    CHAT_MAX_TOKENS,
  );
  if (
    env.BUDGET_DAILY_USD > 0 &&
    usage.usd + audioCost + projectedChat > env.BUDGET_DAILY_USD
  ) {
    await sendControl(writer, {
      type: "error",
      code: "budget_exceeded",
      message: `This voice turn (~$${(audioCost + projectedChat).toFixed(4)}) would exceed the remaining daily budget.`,
    });
    await sendControl(writer, { type: "state", status: "listening" });
    return;
  }

  try {
    const text = (await transcribeAudio(int16ToWav(pcm, 16000), STT_MODEL, signal)).trim();
    await sendControl(writer, { type: "transcript", role: "user", text });
    if (!text) {
      await sendControl(writer, { type: "state", status: "listening" });
      return;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-(HISTORY_CAP - 2)),
      { role: "user", content: text },
    ];

    const chatJson = await gatewayJSON<UpstreamChatResponse>("/chat/completions", {
      body: { model: CHAT_MODEL, messages, max_tokens: CHAT_MAX_TOKENS, temperature: 0.7 },
      signal,
    });

    const reply = (chatJson.choices?.[0]?.message?.content ?? "").trim();
    const promptTokens =
      chatJson.usage?.prompt_tokens ?? estimateTokens(messages.map((m) => m.content).join());
    const completionTokens = chatJson.usage?.completion_tokens ?? estimateTokens(reply);
    const chatCost = chatUsageCostUsd(CHAT_MODEL, promptTokens, completionTokens);
    store.addCost(chatCost, promptTokens + completionTokens);

    if (!reply) {
      await sendControl(writer, { type: "state", status: "listening" });
      return;
    }

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: reply });
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);

    await sendControl(writer, { type: "transcript", role: "assistant", text: reply });

    if (signal.aborted) return;

    const wav = await synthesizeSpeech(reply, TTS_MODEL, signal);
    store.addCost(audioCost, 0);
    await sendControl(writer, {
      type: "usage",
      audio_seconds: Math.round(audioSeconds * 10) / 10,
      audio_usd: roundUsd(audioCost),
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      chat_usd: roundUsd(chatCost),
      total_usd: roundUsd(audioCost + chatCost),
    });

    const { sampleRate, pcm: ttsPcm } = parseWav(wav);
    await sendControl(writer, { type: "audio_format", sample_rate: sampleRate });
    await sendControl(writer, { type: "state", status: "speaking" });

    const chunkSamples = 1600;
    for (let offset = 0; offset < ttsPcm.length; offset += chunkSamples) {
      if (signal.aborted) break;
      await writer.write(encodeAudioFrame(ttsPcm.subarray(offset, offset + chunkSamples)));
    }

    if (signal.aborted) {
      await sendControl(writer, { type: "state", status: "listening" });
      return;
    }
    await sendControl(writer, { type: "agent_audio_end" });
    await sendControl(writer, { type: "state", status: "listening" });
  } catch (err) {
    if (signal.aborted) {
      await sendControl(writer, { type: "state", status: "listening" });
      return;
    }
    await sendControl(writer, {
      type: "error",
      code: "turn_failed",
      message: err instanceof Error ? err.message : "Voice turn failed.",
    });
    await sendControl(writer, { type: "state", status: "listening" });
  }
}

async function runEngine(relay: VoiceRelay): Promise<void> {
  const writer = relay.down;
  if (!writer) {
    closeRelay(relay.sid);
    return;
  }

  const history: ChatMessage[] = [];
  const micChunks: Int16Array[] = [];
  let micSamples = 0;
  let turnAbort: AbortController | null = null;
  let turnChain: Promise<void> = Promise.resolve();

  const abortTurn = () => {
    turnAbort?.abort();
    turnAbort = null;
  };

  const decoder = new VoiceFrameDecoder();
  const textDecoder = new TextDecoder();

  const handleControl = (payload: Uint8Array) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(textDecoder.decode(payload));
    } catch {
      return;
    }
    const control = parseClientControl(parsed);
    if (!control) return;
    if (control.type === "interrupt") {
      abortTurn();
      return;
    }
    if (control.type === "commit") {
      if (turnAbort) return;
      const pcm = micChunks.length === 1 ? micChunks[0] : concatInt16(micChunks);
      micChunks.length = 0;
      micSamples = 0;
      turnAbort = new AbortController();
      const signal = turnAbort.signal;
      const turn = runTurn(writer, history, pcm, signal).finally(() => {
        if (turnAbort?.signal === signal) turnAbort = null;
      });
      turnChain = turnChain.then(() => turn);
    }
  };

  const handleFrame = (frame: { type: number; payload: Uint8Array }) => {
    if (frame.type === FRAME_AUDIO) {
      const pcm = new Int16Array(
        frame.payload.buffer.slice(
          frame.payload.byteOffset,
          frame.payload.byteOffset + frame.payload.byteLength,
        ),
      );
      micChunks.push(pcm);
      micSamples += pcm.length;
      while (micSamples > MAX_MIC_SECONDS * 16000 && micChunks.length > 1) {
        const dropped = micChunks.shift();
        if (dropped) micSamples -= dropped.length;
      }
    } else if (frame.type === FRAME_CONTROL) {
      handleControl(frame.payload);
    }
  };

  try {
    await sendControl(writer, { type: "ready", session_id: relay.sid });
    while (true) {
      const { done, value } = await relay.upReader.read();
      if (done) break;
      for (const frame of decoder.push(value)) handleFrame(frame);
    }
    for (const frame of decoder.flush()) {
      if (frame.type === FRAME_CONTROL) handleFrame(frame);
    }
  } catch {
    // up queue reset; fall through to cleanup
  } finally {
    abortTurn();
    await turnChain.catch(() => {});
    closeRelay(relay.sid);
  }
}

function authorize(req: NextRequest, identity: string): VoiceRelay | Response {
  const token = req.headers.get("x-voice-token") ?? "";
  const claims = verifyVoiceSession(token);
  if (!claims) {
    return jsonError(401, "invalid_voice_token", "Missing or invalid ephemeral voice token.", {
      scope: "validation",
    });
  }
  if (claims.identity !== identity) {
    return jsonError(403, "voice_token_identity_mismatch", "Voice token was minted for a different client.", {
      scope: "validation",
    });
  }
  return getRelay(claims.sid) ?? createRelay(claims.sid, identity);
}

const STREAM_HEADERS = {
  "Content-Type": "application/octet-stream",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
} as const;

export async function GET(req: NextRequest): Promise<Response> {
  const identity = resolveIdentity(req);

  const relayOrError = authorize(req, identity);
  if (relayOrError instanceof Response) return relayOrError;
  const relay = relayOrError;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  if (!attachDown(relay, writable.getWriter())) {
    return jsonError(409, "down_stream_taken", "This voice session already has a down stream.", {
      scope: "validation",
    });
  }

  req.signal.addEventListener("abort", () => closeRelay(relay.sid), { once: true });

  if (!relay.engineStarted) {
    relay.engineStarted = true;
    clearRelayIdleTimer(relay);
    void runEngine(relay).catch(() => {});
  }

  return new Response(readable, { status: 200, headers: STREAM_HEADERS });
}

export async function POST(req: NextRequest): Promise<Response> {
  const identity = resolveIdentity(req);

  const token = req.headers.get("x-voice-token") ?? "";
  const claims = verifyVoiceSession(token);
  if (!claims || claims.identity !== identity) {
    return jsonError(401, "invalid_voice_token", "Missing or invalid ephemeral voice token.", {
      scope: "validation",
    });
  }

  const relay = getRelay(claims.sid);
  if (!relay || !relay.down) {
    return jsonError(409, "down_stream_missing", "Open the down stream (GET) before sending audio.", {
      scope: "validation",
    });
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UP_BODY_BYTES) {
    return jsonError(413, "payload_too_large", `Up-stream batch exceeds ${MAX_UP_BODY_BYTES} bytes.`, {
      scope: "validation",
    });
  }

  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength > MAX_UP_BODY_BYTES) {
    return jsonError(413, "payload_too_large", `Up-stream batch exceeds ${MAX_UP_BODY_BYTES} bytes.`, {
      scope: "validation",
    });
  }
  if (buf.byteLength === 0) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  if (!enqueueUp(relay, buf)) {
    return jsonError(409, "session_closed", "Voice session is closed or exceeded its upload budget.", {
      scope: "validation",
    });
  }

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

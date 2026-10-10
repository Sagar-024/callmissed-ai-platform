import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { readApiError } from "@/lib/chat/protocol";
import type { VoiceSessionResponse } from "@/lib/schemas";
import { initialVoiceState, voiceReducer } from "@/lib/voice/fsm";
import {
  FRAME_AUDIO,
  FRAME_CONTROL,
  VoiceFrameDecoder,
  decodeControlPayload,
  encodeAudioFrame,
  encodeControlFrame,
} from "@/lib/voice/framing";
import { LinearResampler } from "@/lib/voice/pcm";
import { parseServerControl, type ServerVoiceControl } from "@/lib/voice/protocol";
import { computeRms, VoiceActivityDetector } from "@/lib/voice/vad";

export type VoiceTranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
};

export type VoiceTurnUsage = {
  audio_seconds: number;
  audio_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  chat_usd: number;
  total_usd: number;
};

export type VoiceSessionStats = {
  turns: number;
  audioSeconds: number;
  costUsd: number;
};

const MIN_COMMIT_SAMPLES = 6400;
const BARGE_IN_FRAMES = 2;
const LEVEL_HISTORY = 160;
const UP_FLUSH_BYTES = 16 * 1024;

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useVoiceAgent() {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([]);
  const [session, setSession] = useState<VoiceSessionResponse | null>(null);
  const [lastUsage, setLastUsage] = useState<VoiceTurnUsage | null>(null);
  const [notice, setNotice] = useState<{ code: string; message: string } | null>(null);
  const [stats, setStats] = useState<VoiceSessionStats>({
    turns: 0,
    audioSeconds: 0,
    costUsd: 0,
  });

  const statusRef = useRef(state.status);
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  const levelsRef = useRef<number[]>([]);
  const playbackLevelRef = useRef({ value: 0, at: 0 });

  const ctxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackNextRef = useRef(0);
  const playbackPendingRef = useRef(0);
  const playbackEndedRef = useRef(false);
  const playbackGenRef = useRef(0);
  const resamplerRef = useRef<{ rate: number; resampler: LinearResampler } | null>(null);

  const vadRef = useRef(new VoiceActivityDetector());
  const bargeFramesRef = useRef(0);
  const samplesSinceCommitRef = useRef(0);

  const upBufferRef = useRef<Uint8Array[]>([]);
  const upBytesRef = useRef(0);
  const upInFlightRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const readerAbortRef = useRef(false);
  const readyResolveRef = useRef<(() => void) | null>(null);
  const flushUpRef = useRef<() => void>(() => {});

  const appendTranscript = useCallback((role: "user" | "assistant", text: string) => {
    if (role === "user" && text.trim().length === 0) return;
    setTranscript((prev) => [...prev, { id: uid(), role, text, at: Date.now() }]);
  }, []);

  const applyUsage = useCallback((usage: VoiceTurnUsage) => {
    setLastUsage(usage);
    setStats((prev) => ({
      turns: prev.turns + 1,
      audioSeconds: Math.round((prev.audioSeconds + usage.audio_seconds) * 10) / 10,
      costUsd: Math.round((prev.costUsd + usage.total_usd) * 1e6) / 1e6,
    }));
  }, []);

  const handleControl = useCallback(
    (message: ServerVoiceControl) => {
      switch (message.type) {
        case "ready":
          dispatch({ type: "OPEN" });
          readyResolveRef.current?.();
          readyResolveRef.current = null;
          break;
        case "state":
          if (message.status === "thinking") dispatch({ type: "USER_COMMIT" });
          else if (message.status === "speaking") dispatch({ type: "AGENT_START" });
          else dispatch({ type: "AGENT_END" });
          break;
        case "audio_format":
          resamplerRef.current = null;
          resamplerRef.current = {
            rate: message.sample_rate,
            resampler: new LinearResampler(message.sample_rate, ctxRef.current?.sampleRate ?? 48000),
          };
          break;
        case "transcript":
          appendTranscript(message.role, message.text);
          break;
        case "usage":
          applyUsage(message);
          break;
        case "agent_audio_end":
          playbackEndedRef.current = true;
          if (playbackPendingRef.current === 0 && statusRef.current === "speaking") {
            dispatch({ type: "AGENT_END" });
          }
          break;
        case "error":
          setNotice({ code: message.code, message: message.message });
          break;
      }
    },
    [appendTranscript, applyUsage],
  );

  const enqueuePlayback = useCallback((pcm: Int16Array, sampleRate: number) => {
    const ctx = ctxRef.current;
    const gain = playbackGainRef.current;
    if (!ctx || !gain || ctx.state === "closed") return;

    let resamplerEntry = resamplerRef.current;
    if (!resamplerEntry || resamplerEntry.rate !== sampleRate) {
      resamplerEntry = {
        rate: sampleRate,
        resampler: new LinearResampler(sampleRate, ctx.sampleRate),
      };
      resamplerRef.current = resamplerEntry;
    }
    const resampler = resamplerEntry.resampler;

    const floats = new Float32Array(pcm.length);
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 1) {
      const value = pcm[i] / 32768;
      floats[i] = value;
      const abs = Math.abs(value);
      if (abs > peak) peak = abs;
    }
    playbackLevelRef.current = { value: peak, at: performance.now() };

    const resampled = resampler.push(floats);
    if (resampled.length === 0) return;

    const buffer = ctx.createBuffer(1, resampled.length, ctx.sampleRate);
    buffer.copyToChannel(resampled, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const now = ctx.currentTime;
    const start = Math.max(playbackNextRef.current, now + 0.03);
    source.start(start);
    playbackNextRef.current = start + buffer.duration;

    playbackPendingRef.current += 1;
    sourcesRef.current.add(source);
    const generation = playbackGenRef.current;
    source.onended = () => {
      if (generation !== playbackGenRef.current) return;
      sourcesRef.current.delete(source);
      playbackPendingRef.current = Math.max(playbackPendingRef.current - 1, 0);
      if (playbackEndedRef.current && playbackPendingRef.current === 0 && statusRef.current === "speaking") {
        dispatch({ type: "AGENT_END" });
      }
    };
  }, []);

  const flushPlayback = useCallback(() => {
    playbackGenRef.current += 1;
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    sourcesRef.current.clear();
    playbackPendingRef.current = 0;
    playbackEndedRef.current = false;
    playbackNextRef.current = 0;
  }, []);

  const teardown = useCallback(() => {
    readerAbortRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    tokenRef.current = null;
    upBufferRef.current = [];
    upBytesRef.current = 0;
    upInFlightRef.current = false;
    flushPlayback();

    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    workletRef.current = null;

    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    playbackGainRef.current?.disconnect();
    playbackGainRef.current = null;

    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});

    vadRef.current.reset();
    bargeFramesRef.current = 0;
    samplesSinceCommitRef.current = 0;
    resamplerRef.current = null;
    levelsRef.current = [];
  }, [flushPlayback]);

  const flushUp = useCallback(() => {
    if (upInFlightRef.current || upBufferRef.current.length === 0) return;
    const token = tokenRef.current;
    const signal = abortRef.current?.signal;
    if (!token || !signal) return;

    const total = upBytesRef.current;
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of upBufferRef.current) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    upBufferRef.current = [];
    upBytesRef.current = 0;
    upInFlightRef.current = true;

    void fetch("/api/voice/stream", {
      method: "POST",
      headers: {
        "X-Voice-Token": token,
        "Content-Type": "application/octet-stream",
      },
      body: new Blob([joined]),
      cache: "no-store",
      signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const error = await readApiError(res).catch(() => ({ message: "Voice upload failed." }));
          throw new Error(error.message);
        }
      })
      .catch((err) => {
        if (signal.aborted) return;
        const message = err instanceof Error ? err.message : "Voice upload failed.";
        teardown();
        dispatch({ type: "FAIL", message });
      })
      .finally(() => {
        upInFlightRef.current = false;
        if (upBufferRef.current.length > 0) flushUpRef.current();
      });
  }, [teardown]);

  useEffect(() => {
    flushUpRef.current = flushUp;
  }, [flushUp]);

  const sendControl = useCallback(
    (message: unknown) => {
      const frame = encodeControlFrame(message);
      upBufferRef.current.push(frame);
      upBytesRef.current += frame.byteLength;
      flushUp();
    },
    [flushUp],
  );

  const onMicFrame = useCallback(
    (pcm: Int16Array) => {
      const rms = computeRms(pcm);
      const levels = levelsRef.current;
      levels.push(Math.min(rms * 4, 1));
      if (levels.length > LEVEL_HISTORY) levels.shift();

      const status = statusRef.current;
      if (status !== "listening" && status !== "thinking" && status !== "speaking") return;

      const frame = encodeAudioFrame(pcm);
      upBufferRef.current.push(frame);
      upBytesRef.current += frame.byteLength;
      if (upBytesRef.current >= UP_FLUSH_BYTES) flushUp();
      samplesSinceCommitRef.current += pcm.length;

      const verdict = vadRef.current.push(pcm);

      if (status === "listening") {
        if (verdict === "end" && samplesSinceCommitRef.current >= MIN_COMMIT_SAMPLES) {
          samplesSinceCommitRef.current = 0;
          vadRef.current.reset();
          bargeFramesRef.current = 0;
          dispatch({ type: "USER_COMMIT" });
          sendControl({ type: "commit" });
        }
        return;
      }

      if (verdict === "speech") {
        bargeFramesRef.current += 1;
        if (bargeFramesRef.current >= BARGE_IN_FRAMES) {
          bargeFramesRef.current = 0;
          vadRef.current.reset();
          flushPlayback();
          dispatch({ type: "INTERRUPT" });
          sendControl({ type: "interrupt" });
        }
      } else {
        bargeFramesRef.current = 0;
      }
    },
    [flushPlayback, flushUp, sendControl],
  );

  const disconnect = useCallback(() => {
    teardown();
    dispatch({ type: "CLOSE" });
  }, [teardown]);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
    setLastUsage(null);
    setNotice(null);
    setStats({ turns: 0, audioSeconds: 0, costUsd: 0 });
  }, []);

  const connect = useCallback(async () => {
    if (statusRef.current !== "idle" && statusRef.current !== "error") return;
    dispatch({ type: "CONNECT" });
    setNotice(null);
    readerAbortRef.current = false;

    let sessionPayload: VoiceSessionResponse | null = null;

    try {
      const sessionRes = await fetch("/api/voice/session", {
        method: "POST",
        cache: "no-store",
      });
      if (!sessionRes.ok) {
        const error = await readApiError(sessionRes);
        throw new Error(error.message);
      }
      sessionPayload = (await sessionRes.json()) as VoiceSessionResponse;
      setSession(sessionPayload);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");

      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      gain.connect(ctx.destination);
      playbackGainRef.current = gain;

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "pcm-capture");
      source.connect(worklet);
      worklet.port.onmessage = (event: MessageEvent) => {
        const data = event.data as Int16Array;
        onMicFrame(new Int16Array(data.buffer.slice(0)));
      };
      workletRef.current = worklet;

      if (ctx.state === "suspended") await ctx.resume();

      const controller = new AbortController();
      abortRef.current = controller;
      tokenRef.current = sessionPayload.token;

      const downRes = await fetch("/api/voice/stream", {
        method: "GET",
        headers: { "X-Voice-Token": sessionPayload.token },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!downRes.ok || !downRes.body) {
        const error = await readApiError(downRes);
        throw new Error(error.message);
      }

      const downReader = downRes.body.getReader();

      const readyPromise = new Promise<void>((resolve) => {
        readyResolveRef.current = resolve;
      });

      void (async () => {
        const decoder = new VoiceFrameDecoder();
        try {
          while (!readerAbortRef.current) {
            const { done, value } = await downReader.read();
            if (done) break;
            for (const frame of decoder.push(value)) {
              if (frame.type === FRAME_AUDIO) {
                const pcm = new Int16Array(
                  frame.payload.buffer.slice(
                    frame.payload.byteOffset,
                    frame.payload.byteOffset + frame.payload.byteLength,
                  ),
                );
                enqueuePlayback(pcm, resamplerRef.current?.rate ?? 24000);
              } else if (frame.type === FRAME_CONTROL) {
                let parsed: unknown;
                try {
                  parsed = decodeControlPayload(frame);
                } catch {
                  continue;
                }
                const control = parseServerControl(parsed);
                if (control) handleControl(control);
              }
            }
          }
          if (!readerAbortRef.current && statusRef.current !== "idle") {
            teardown();
            dispatch({ type: "CLOSE" });
          }
        } catch {
          if (!readerAbortRef.current) {
            teardown();
            dispatch({ type: "FAIL", message: "Voice stream ended unexpectedly." });
          }
        }
      })();

      const abortWait = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Voice session aborted.")),
          { once: true },
        );
      });
      abortWait.catch(() => {});
      let readyTimeout = 0;
      const timeoutWait = new Promise<never>((_, reject) => {
        readyTimeout = window.setTimeout(
          () => reject(new Error("Voice stream did not become ready.")),
          15_000,
        );
      });
      timeoutWait.catch(() => {});
      try {
        await Promise.race([readyPromise, abortWait, timeoutWait]);
      } finally {
        window.clearTimeout(readyTimeout);
      }
    } catch (err) {
      teardown();
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow mic access and retry."
          : err instanceof Error
            ? err.message
            : "Failed to start the voice session.";
      dispatch({ type: "FAIL", message });
      if (sessionPayload) setSession(sessionPayload);
    }
  }, [enqueuePlayback, handleControl, onMicFrame, teardown]);

  useEffect(() => teardown, [teardown]);

  return {
    state,
    transcript,
    session,
    lastUsage,
    notice,
    stats,
    levelsRef,
    playbackLevelRef,
    connect,
    disconnect,
    clearNotice: () => setNotice(null),
    clearTranscript,
    isConnected: state.status !== "idle" && state.status !== "error",
  };
}

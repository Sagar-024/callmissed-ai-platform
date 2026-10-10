import assert from "node:assert/strict";
import {
  FRAME_AUDIO,
  FRAME_CONTROL,
  VoiceFrameDecoder,
  encodeAudioFrame,
  encodeControlFrame,
  encodeVoiceFrame,
} from "../lib/voice/framing.ts";
import {
  LinearResampler,
  concatInt16,
  floatTo16BitPCM,
  int16ToWav,
  parseWav,
} from "../lib/voice/pcm.ts";
import { VoiceActivityDetector, computeRms, DEFAULT_VAD_CONFIG } from "../lib/voice/vad.ts";
import {
  canBargeIn,
  initialVoiceState,
  isVoiceActive,
  voiceReducer,
  VOICE_STATE_META,
} from "../lib/voice/fsm.ts";
import { parseClientControl, parseServerControl } from "../lib/voice/protocol.ts";
import {
  attachDown,
  clearRelayIdleTimer,
  closeRelay,
  closeUp,
  createRelay,
  enqueueUp,
  getRelay,
  relayIsPaired,
} from "../lib/voice/relay.ts";

type Case = { name: string; run: () => void | Promise<void> };
const cases: Case[] = [];

function test(name: string, run: () => void | Promise<void>): void {
  cases.push({ name, run });
}

function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

function silence(seconds: number, sampleRate = 16000): Int16Array {
  return new Int16Array(Math.floor(seconds * sampleRate));
}

function tone(seconds: number, amplitude = 12000, sampleRate = 16000): Int16Array {
  const pcm = new Int16Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < pcm.length; i += 1) {
    pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude);
  }
  return pcm;
}

// ------------------------------------------------------------- framing

test("encode/decode: audio frame roundtrips through arbitrary chunk sizes", () => {
  const pcm = tone(0.1);
  const encoded = encodeAudioFrame(pcm);
  const decoder = new VoiceFrameDecoder();
  const frames: ReturnType<VoiceFrameDecoder["push"]> = [];
  for (const chunk of chunkBytes(encoded, 7)) frames.push(...decoder.push(chunk));
  frames.push(...decoder.flush());

  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, FRAME_AUDIO);
  assert.deepEqual(new Int16Array(frames[0].payload.buffer, frames[0].payload.byteOffset, frames[0].payload.byteLength / 2), pcm);
});

test("encode/decode: multiple frames in one chunk", () => {
  const a = encodeControlFrame({ type: "commit" });
  const b = encodeAudioFrame(new Int16Array([1, -2, 3]));
  const merged = new Uint8Array(a.length + b.length);
  merged.set(a, 0);
  merged.set(b, a.length);

  const decoder = new VoiceFrameDecoder();
  const frames = decoder.push(merged);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].type, FRAME_CONTROL);
  assert.equal(frames[1].type, FRAME_AUDIO);
  assert.deepEqual(new Int16Array(frames[1].payload.buffer, frames[1].payload.byteOffset, 3), new Int16Array([1, -2, 3]));
});

test("encode/decode: unknown frame type throws", () => {
  const bad = new Uint8Array([0x7f, 0, 0, 0, 0]);
  const decoder = new VoiceFrameDecoder();
  assert.throws(() => decoder.push(bad), /Unknown frame type/);
});

test("encode/decode: declared length above cap throws", () => {
  const bad = new Uint8Array(5);
  bad[0] = FRAME_AUDIO;
  new DataView(bad.buffer).setUint32(1, 9 * 1024 * 1024, false);
  const decoder = new VoiceFrameDecoder();
  assert.throws(() => decoder.push(bad), /exceeds cap/);
});

test("encode/decode: flush rejects truncated payload", () => {
  const encoded = encodeControlFrame({ type: "interrupt" });
  const decoder = new VoiceFrameDecoder();
  decoder.push(encoded.subarray(0, encoded.length - 1));
  assert.throws(() => decoder.flush(), /Truncated frame/);
});

test("encode/decode: flush on empty decoder returns nothing", () => {
  assert.deepEqual(new VoiceFrameDecoder().flush(), []);
});

test("encodeVoiceFrame: payload cap enforced on encode", () => {
  assert.throws(() => encodeVoiceFrame(FRAME_AUDIO, new Uint8Array(9 * 1024 * 1024)), RangeError);
});

// ----------------------------------------------------------------- pcm

test("LinearResampler: 48k→16k yields ~one third the samples", () => {
  const resampler = new LinearResampler(48000, 16000);
  const out = resampler.push(new Float32Array(4800));
  assert.equal(out.length, 1600);
});

test("LinearResampler: identity when rates match", () => {
  const resampler = new LinearResampler(24000, 24000);
  const input = Float32Array.from([0, 0.5, -0.5, 1]);
  assert.deepEqual(resampler.push(input), input);
});

test("LinearResampler: carries fractional position across pushes (no drift)", () => {
  const resampler = new LinearResampler(48000, 16000);
  let total = 0;
  for (let i = 0; i < 48; i += 1) {
    total += resampler.push(new Float32Array(100)).length;
  }
  assert.equal(total, 1600);
});

test("LinearResampler: constructor rejects non-positive rates", () => {
  assert.throws(() => new LinearResampler(0, 16000), RangeError);
});

test("floatTo16BitPCM: clamps outside [-1, 1]", () => {
  const out = floatTo16BitPCM(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
  assert.equal(out[0], 0);
  assert.equal(out[1], 0x7fff);
  assert.equal(out[2], -0x8000);
  assert.equal(out[3], 0x7fff);
  assert.equal(out[4], -0x8000);
  assert.equal(out[5], Math.round(0.5 * 0x7fff));
});

test("int16ToWav → parseWav roundtrips samples and sample rate", () => {
  const pcm = tone(0.25, 9000, 24000);
  const wav = int16ToWav(pcm, 24000);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  const parsed = parseWav(wav);
  assert.equal(parsed.sampleRate, 24000);
  assert.deepEqual(parsed.pcm, pcm);
});

test("parseWav: tolerates placeholder RIFF/data size fields (streaming encoder)", () => {
  const pcm = tone(0.1, 5000, 16000);
  const wav = int16ToWav(pcm, 16000);
  new DataView(wav.buffer).setUint32(4, 0x7fff0024, true);
  new DataView(wav.buffer).setUint32(40, 0x7fffffff, true);
  const parsed = parseWav(wav);
  assert.equal(parsed.sampleRate, 16000);
  assert.deepEqual(parsed.pcm, pcm);
});

test("parseWav: rejects non-RIFF buffers", () => {
  assert.throws(() => parseWav(new Uint8Array(64)), /Not a RIFF/);
});

test("concatInt16: concatenates in order", () => {
  const out = concatInt16([new Int16Array([1, 2]), new Int16Array([3]), new Int16Array([4, 5])]);
  assert.deepEqual(out, new Int16Array([1, 2, 3, 4, 5]));
});

// ------------------------------------------------------------------ vad

test("VAD: silence → speech → end with hangover", () => {
  const vad = new VoiceActivityDetector();
  assert.equal(vad.push(silence(0.1)), "silence");
  for (let i = 0; i < DEFAULT_VAD_CONFIG.minSpeechFrames; i += 1) {
    assert.equal(vad.push(tone(0.1)), "speech");
  }
  let sawEnd = false;
  for (let i = 0; i < DEFAULT_VAD_CONFIG.hangoverFrames + 3; i += 1) {
    if (vad.push(silence(0.1)) === "end") {
      sawEnd = true;
      break;
    }
  }
  assert.equal(sawEnd, true);
  assert.equal(vad.push(silence(0.1)), "silence");
});

test("VAD: blip below minSpeechFrames resets to silence without end", () => {
  const vad = new VoiceActivityDetector();
  assert.equal(vad.push(tone(0.1)), "speech");
  let verdict = "speech";
  for (let i = 0; i < DEFAULT_VAD_CONFIG.hangoverFrames + 3; i += 1) {
    verdict = vad.push(silence(0.1));
  }
  assert.equal(verdict, "silence");
  assert.equal(vad.push(silence(0.1)), "silence");
});

test("VAD: computeRms of silence is 0 and of full-scale square ~1", () => {
  assert.equal(computeRms(silence(0.1)), 0);
  const loud = new Int16Array(1600).fill(32767);
  assert.ok(computeRms(loud) > 0.99);
});

test("VAD: reset clears in-flight speech state", () => {
  const vad = new VoiceActivityDetector();
  vad.push(tone(0.1));
  vad.reset();
  assert.equal(vad.push(silence(0.1)), "silence");
});

// ------------------------------------------------------------------ fsm

test("fsm: happy path CONNECT → OPEN → USER_COMMIT → AGENT_START → AGENT_END", () => {
  let s = initialVoiceState;
  s = voiceReducer(s, { type: "CONNECT" });
  assert.equal(s.status, "connecting");
  s = voiceReducer(s, { type: "OPEN" });
  assert.equal(s.status, "listening");
  s = voiceReducer(s, { type: "USER_COMMIT" });
  assert.equal(s.status, "thinking");
  s = voiceReducer(s, { type: "AGENT_START" });
  assert.equal(s.status, "speaking");
  s = voiceReducer(s, { type: "AGENT_END" });
  assert.equal(s.status, "listening");
});

test("fsm: barge-in INTERRUPT from speaking and thinking returns to listening", () => {
  let s = voiceReducer(voiceReducer(initialVoiceState, { type: "CONNECT" }), { type: "OPEN" });
  s = voiceReducer(s, { type: "USER_COMMIT" });
  s = voiceReducer(s, { type: "INTERRUPT" });
  assert.equal(s.status, "listening");
  s = voiceReducer(s, { type: "USER_COMMIT" });
  s = voiceReducer(s, { type: "AGENT_START" });
  s = voiceReducer(s, { type: "INTERRUPT" });
  assert.equal(s.status, "listening");
});

test("fsm: invalid transitions are ignored", () => {
  assert.equal(voiceReducer(initialVoiceState, { type: "AGENT_START" }).status, "idle");
  assert.equal(voiceReducer(initialVoiceState, { type: "USER_COMMIT" }).status, "idle");
  const listening = voiceReducer(voiceReducer(initialVoiceState, { type: "CONNECT" }), { type: "OPEN" });
  assert.equal(voiceReducer(listening, { type: "OPEN" }).status, "listening");
});

test("fsm: FAIL carries the message and RESET clears it", () => {
  const connecting = voiceReducer(initialVoiceState, { type: "CONNECT" });
  const failed = voiceReducer(connecting, { type: "FAIL", message: "mic denied" });
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "mic denied");
  assert.equal(voiceReducer(failed, { type: "RESET" }).error, null);
});

test("fsm: canBargeIn / isVoiceActive / meta coverage", () => {
  assert.equal(canBargeIn("speaking"), true);
  assert.equal(canBargeIn("thinking"), true);
  assert.equal(canBargeIn("listening"), false);
  assert.equal(isVoiceActive("connecting"), true);
  assert.equal(isVoiceActive("idle"), false);
  for (const status of ["idle", "connecting", "listening", "thinking", "speaking", "error"] as const) {
    assert.ok(VOICE_STATE_META[status].label.length > 0);
  }
});

// --------------------------------------------------------------- relay

test("relay: create/get roundtrip and idempotent create", () => {
  const relay = createRelay("sid-relay-1", "local");
  assert.equal(getRelay("sid-relay-1"), relay);
  assert.equal(createRelay("sid-relay-1", "local"), relay);
  closeRelay("sid-relay-1");
  assert.equal(getRelay("sid-relay-1"), undefined);
});

test("relay: attachDown accepts once, rejects duplicates", () => {
  const relay = createRelay("sid-relay-2", "local");
  const { writable } = new TransformStream<Uint8Array, Uint8Array>();
  const { writable: second } = new TransformStream<Uint8Array, Uint8Array>();
  assert.equal(attachDown(relay, writable.getWriter()), true);
  assert.equal(attachDown(relay, second.getWriter()), false);
  assert.equal(relayIsPaired(relay), true);
  closeRelay("sid-relay-2");
});

test("relay: enqueueUp delivers bytes to the engine reader in order", async () => {
  const relay = createRelay("sid-relay-4", "local");
  assert.equal(enqueueUp(relay, new Uint8Array([1, 2, 3])), true);
  assert.equal(enqueueUp(relay, new Uint8Array([4, 5])), true);
  const first = await relay.upReader.read();
  assert.equal(first.done, false);
  assert.deepEqual([...(first.value ?? [])], [1, 2, 3]);
  const second = await relay.upReader.read();
  assert.equal(second.done, false);
  assert.deepEqual([...(second.value ?? [])], [4, 5]);
  closeUp(relay);
  const end = await relay.upReader.read();
  assert.equal(end.done, true);
  closeRelay("sid-relay-4");
});

test("relay: enqueueUp after closeUp or post cap is rejected", async () => {
  const relay = createRelay("sid-relay-5", "local");
  closeUp(relay);
  assert.equal(enqueueUp(relay, new Uint8Array([9])), false);
  closeRelay("sid-relay-5");

  const capped = createRelay("sid-relay-6", "local");
  capped.upPosts = 600;
  assert.equal(enqueueUp(capped, new Uint8Array([9])), false);
  closeRelay("sid-relay-6");
});

test("relay: closeRelay aborts the session signal", () => {
  const relay = createRelay("sid-relay-3", "local");
  assert.equal(relay.abort.signal.aborted, false);
  clearRelayIdleTimer(relay);
  assert.equal(relay.idleTimer, null);
  closeRelay("sid-relay-3");
  assert.equal(relay.abort.signal.aborted, true);
  assert.equal(getRelay("sid-relay-3"), undefined);
});

// -------------------------------------------------------------- protocol

test("protocol: parseClientControl accepts commit/interrupt only", () => {
  assert.deepEqual(parseClientControl({ type: "commit" }), { type: "commit" });
  assert.deepEqual(parseClientControl({ type: "interrupt" }), { type: "interrupt" });
  assert.equal(parseClientControl({ type: "nope" }), null);
  assert.equal(parseClientControl(null), null);
  assert.equal(parseClientControl("commit"), null);
});

test("protocol: parseServerControl validates each shape", () => {
  assert.deepEqual(parseServerControl({ type: "ready", session_id: "s1" }), { type: "ready", session_id: "s1" });
  assert.equal(parseServerControl({ type: "ready" }), null);
  assert.deepEqual(parseServerControl({ type: "state", status: "speaking" }), { type: "state", status: "speaking" });
  assert.equal(parseServerControl({ type: "state", status: "idle" }), null);
  assert.deepEqual(parseServerControl({ type: "audio_format", sample_rate: 24000 }), { type: "audio_format", sample_rate: 24000 });
  assert.equal(parseServerControl({ type: "audio_format", sample_rate: "24k" }), null);
  assert.deepEqual(parseServerControl({ type: "transcript", role: "user", text: "hi" }), { type: "transcript", role: "user", text: "hi" });
  assert.equal(parseServerControl({ type: "transcript", role: "system", text: "hi" }), null);
  assert.deepEqual(parseServerControl({ type: "agent_audio_end" }), { type: "agent_audio_end" });
  assert.deepEqual(parseServerControl({ type: "error", code: "x", message: "y" }), { type: "error", code: "x", message: "y" });
  assert.equal(parseServerControl({ type: "error", code: "x" }), null);
  assert.equal(parseServerControl({ type: "unknown" }), null);
});

test("protocol: usage frame validated field-by-field", () => {
  const good = {
    type: "usage",
    audio_seconds: 1.2,
    audio_usd: 0.001,
    prompt_tokens: 10,
    completion_tokens: 20,
    chat_usd: 0.0002,
    total_usd: 0.0012,
  };
  assert.deepEqual(parseServerControl(good), good);
  assert.equal(parseServerControl({ ...good, completion_tokens: "20" }), null);
});

// ---------------------------------------------------------------- runner

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;
  for (const item of cases) {
    try {
      await item.run();
      passed += 1;
      console.log(`  ok  ${item.name}`);
    } catch (err) {
      failed += 1;
      console.error(` FAIL ${item.name}`);
      console.error(err);
    }
  }
  console.log(`phase4: ${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

void main();

export const FRAME_AUDIO = 0x01;
export const FRAME_CONTROL = 0x02;

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type VoiceFrame = {
  type: typeof FRAME_AUDIO | typeof FRAME_CONTROL;
  payload: Uint8Array;
};

const HEADER_BYTES = 5;

export function encodeVoiceFrame(
  type: typeof FRAME_AUDIO | typeof FRAME_CONTROL,
  payload: Uint8Array,
): Uint8Array {
  if (payload.byteLength > MAX_FRAME_BYTES) {
    throw new RangeError(`Frame payload exceeds ${MAX_FRAME_BYTES} bytes`);
  }
  const out = new Uint8Array(HEADER_BYTES + payload.byteLength);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, payload.byteLength, false);
  out.set(payload, HEADER_BYTES);
  return out;
}

export function encodeAudioFrame(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return encodeVoiceFrame(FRAME_AUDIO, bytes);
}

export function encodeControlFrame(message: unknown): Uint8Array {
  return encodeVoiceFrame(FRAME_CONTROL, new TextEncoder().encode(JSON.stringify(message)));
}

export function decodeControlPayload(frame: VoiceFrame): unknown {
  return JSON.parse(new TextDecoder().decode(frame.payload));
}

export class VoiceFrameDecoder {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): VoiceFrame[] {
    if (this.buffer.length === 0) {
      this.buffer = chunk.slice();
    } else {
      const merged = new Uint8Array(this.buffer.length + chunk.length);
      merged.set(this.buffer, 0);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;
    }

    const frames: VoiceFrame[] = [];

    while (this.buffer.length >= HEADER_BYTES) {
      const type = this.buffer[0];
      if (type !== FRAME_AUDIO && type !== FRAME_CONTROL) {
        throw new Error(`Unknown frame type 0x${type.toString(16)}`);
      }
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const length = view.getUint32(1, false);
      if (length > MAX_FRAME_BYTES) {
        throw new RangeError(`Frame length ${length} exceeds cap`);
      }
      if (this.buffer.length < HEADER_BYTES + length) break;

      const payload = this.buffer.slice(HEADER_BYTES, HEADER_BYTES + length);
      frames.push({ type, payload });
      this.buffer = this.buffer.slice(HEADER_BYTES + length);
    }

    return frames;
  }

  flush(): VoiceFrame[] {
    const leftover = this.buffer;
    this.buffer = new Uint8Array(0);
    if (leftover.length === 0) return [];
    if (leftover.length < HEADER_BYTES) throw new Error("Truncated frame header at stream end");
    const view = new DataView(leftover.buffer, leftover.byteOffset, leftover.byteLength);
    const length = view.getUint32(1, false);
    if (leftover.length < HEADER_BYTES + length) throw new Error("Truncated frame payload at stream end");
    const payload = leftover.slice(HEADER_BYTES, HEADER_BYTES + length);
    return [{ type: leftover[0] as VoiceFrame["type"], payload }];
  }
}

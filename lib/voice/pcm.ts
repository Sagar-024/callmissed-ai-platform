export class LinearResampler {
  readonly fromRate: number;
  readonly toRate: number;
  private readonly step: number;
  private pos = 0;
  private prevSample = 0;
  private hasPrev = false;

  constructor(fromRate: number, toRate: number) {
    if (fromRate <= 0 || toRate <= 0) throw new RangeError("Rates must be positive");
    this.fromRate = fromRate;
    this.toRate = toRate;
    this.step = fromRate / toRate;
  }

  push(input: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    if (this.fromRate === this.toRate) return input.slice();

    const virtualLength = this.hasPrev ? input.length + 1 : input.length;
    const at = (index: number): number => {
      if (this.hasPrev && index === 0) return this.prevSample;
      const sourceIndex = this.hasPrev ? index - 1 : index;
      return input[sourceIndex];
    };

    const out: number[] = [];
    while (this.pos < virtualLength - 1) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      out.push(at(i) * (1 - frac) + at(i + 1) * frac);
      this.pos += this.step;
    }

    this.pos -= virtualLength - 1;
    if (input.length > 0) {
      this.prevSample = input[input.length - 1];
      this.hasPrev = true;
    }
    return Float32Array.from(out);
  }
}

export function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function int16ToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));

  return new Uint8Array(buffer);
}

export function parseWav(bytes: Uint8Array): { sampleRate: number; pcm: Int16Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE buffer");
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.length) {
    const id = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataStart = body;
      // Some streaming encoders write a placeholder RIFF/data size; trust the
      // remaining buffer instead of the declared chunk size.
      dataLength = Math.min(size, bytes.length - body);
      break;
    }

    offset = body + size + (size % 2);
  }

  if (dataStart < 0 || sampleRate === 0) throw new Error("WAV missing fmt/data chunk");
  if (bitsPerSample !== 16) throw new Error(`Unsupported bit depth ${bitsPerSample}`);

  const sampleCount = Math.floor(dataLength / 2 / Math.max(channels, 1));
  const pcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    pcm[i] = view.getInt16(dataStart + i * 2 * channels, true);
  }
  return { sampleRate, pcm };
}

export function concatInt16(chunks: readonly Int16Array[]): Int16Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

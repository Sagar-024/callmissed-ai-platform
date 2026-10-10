// AudioWorklet: mixes input channels to mono, linearly downsamples the
// context sample rate to 16 kHz, and posts Int16 PCM chunks (~100 ms) to
// the main thread. Math mirrors lib/voice/pcm.ts LinearResampler.

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fromRate = sampleRate;
    this.toRate = TARGET_RATE;
    this.step = this.fromRate / this.toRate;
    this.pos = 0;
    this.prevSample = 0;
    this.hasPrev = false;
    this.pcm = new Int16Array(CHUNK_SAMPLES);
    this.pcmLen = 0;
  }

  resample(input) {
    if (this.fromRate === this.toRate) return input;
    const virtualLength = this.hasPrev ? input.length + 1 : input.length;
    const at = (index) => {
      if (this.hasPrev && index === 0) return this.prevSample;
      return input[this.hasPrev ? index - 1 : index];
    };
    const out = [];
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
    return out;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const length = input[0].length;
    const mono = new Float32Array(length);
    const channels = input.length;
    for (let ch = 0; ch < channels; ch += 1) {
      const data = input[ch];
      for (let i = 0; i < length; i += 1) mono[i] += data[i] / channels;
    }

    const resampled = this.resample(mono);
    for (let i = 0; i < resampled.length; i += 1) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      this.pcm[this.pcmLen++] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      if (this.pcmLen === CHUNK_SAMPLES) {
        this.port.postMessage(this.pcm);
        this.pcm = new Int16Array(CHUNK_SAMPLES);
        this.pcmLen = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

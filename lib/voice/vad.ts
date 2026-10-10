export type VadConfig = {
  thresholdRms: number;
  hangoverFrames: number;
  minSpeechFrames: number;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  thresholdRms: 0.02,
  hangoverFrames: 8,
  minSpeechFrames: 3,
};

export function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = pcm[i] / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / pcm.length);
}

export type VadVerdict = "silence" | "speech" | "end";

export class VoiceActivityDetector {
  readonly config: VadConfig;
  private hangover = 0;
  private speechFrames = 0;
  private inSpeech = false;

  constructor(config: VadConfig = DEFAULT_VAD_CONFIG) {
    this.config = config;
  }

  push(pcm: Int16Array): VadVerdict {
    const loud = computeRms(pcm) >= this.config.thresholdRms;

    if (loud) {
      this.speechFrames += 1;
      this.hangover = this.config.hangoverFrames;
      this.inSpeech = true;
      return "speech";
    }

    if (this.inSpeech && this.hangover > 0) {
      this.hangover -= 1;
      return "speech";
    }

    if (this.inSpeech) {
      const recognized = this.speechFrames >= this.config.minSpeechFrames;
      this.reset();
      return recognized ? "end" : "silence";
    }

    return "silence";
  }

  reset(): void {
    this.hangover = 0;
    this.speechFrames = 0;
    this.inSpeech = false;
  }
}

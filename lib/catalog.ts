import type { ModelPrice } from "@/lib/schemas";

export const CHAT_MODELS: ModelPrice[] = [
  { id: "gpt-6-luna", label: "GPT-6 Luna", category: "chat", context_window: 1050000, input_per_mtok: 0.1042, output_per_mtok: 0.5208 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", category: "chat", context_window: 1000000, input_per_mtok: 0.1042, output_per_mtok: 0.5208 },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", category: "chat", context_window: 1050000, input_per_mtok: 0.2083, output_per_mtok: 1.25 },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", category: "chat", context_window: 1048576, input_per_mtok: 0.2604, output_per_mtok: 1.563 },
  { id: "DeepSeek-V4-Flash", label: "DeepSeek V4 Flash", category: "chat", context_window: 1048576, input_per_mtok: 0.4583, output_per_mtok: 1.375 },
  { id: "glm-4.7-flash", label: "GLM 4.7 Flash", category: "chat", context_window: 131072, input_per_mtok: 0.5208, output_per_mtok: 2.083 },
  { id: "sarvam-105b", label: "Sarvam 105B", category: "chat", context_window: 131072, input_per_mtok: 0.3646, output_per_mtok: 0.3646 },
  { id: "gemma-4-31b", label: "Gemma 4 31B", category: "chat", context_window: 131072, input_per_mtok: 0.6146, output_per_mtok: 1.542 },
  { id: "kimi-k2.5-fast", label: "Kimi K2.5 Fast", category: "chat", context_window: 256000, input_per_mtok: 0.8438, output_per_mtok: 4.219 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", category: "chat", context_window: 1000000, input_per_mtok: 2.083, output_per_mtok: 10.42 },
];

export const IMAGE_MODELS = [
  { id: "flux-2-pro", label: "FLUX 2 Pro" },
  { id: "flux-1.1-pro", label: "FLUX 1.1 Pro" },
  { id: "gpt-image-2", label: "GPT Image 2" },
  { id: "nano-banana-pro", label: "Nano Banana Pro" },
  { id: "lucid-origin", label: "Lucid Origin" },
  { id: "sdxl-lightning", label: "SDXL Lightning" },
] as const;

export const VOICE_MODELS = {
  stt: [
    { id: "deepgram-nova-3", label: "Deepgram Nova 3" },
    { id: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe" },
    { id: "nova-3", label: "Cartesia Nova 3" },
  ],
  tts: [
    { id: "deepgram-aura-2", label: "Deepgram Aura 2" },
    { id: "aura-2-en", label: "Aura 2 EN" },
    { id: "sonic-3.6", label: "Sonic 3.6" },
  ],
} as const;

export function getChatModel(id: string): ModelPrice | undefined {
  return CHAT_MODELS.find((model) => model.id === id);
}

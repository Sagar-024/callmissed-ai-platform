import "server-only";
import { env } from "@/lib/env";

export class GatewayError extends Error {
  readonly status: number;
  readonly body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.body = body;
  }
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.CALLMISSED_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function toGatewayError(res: Response): Promise<GatewayError> {
  const text = await res.text().catch(() => "");
  let message = `CallMissed gateway responded with ${res.status}`;
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
    message = json?.error?.message ?? json?.message ?? message;
  } catch {
    if (text) message = text.slice(0, 300);
  }
  return new GatewayError(message, res.status, text);
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (signal) signals.push(signal);
  if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

export type GatewayRequest = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

async function gatewayFetch(path: string, opts: GatewayRequest = {}): Promise<Response> {
  const { method = "POST", body, signal, timeoutMs = 45_000 } = opts;
  return fetch(`${env.CALLMISSED_API_BASE_URL}${path}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: combineSignals(signal, timeoutMs),
  });
}

export async function gatewayJSON<T>(path: string, opts: GatewayRequest = {}): Promise<T> {
  const res = await gatewayFetch(path, opts);
  if (!res.ok) throw await toGatewayError(res);
  return (await res.json()) as T;
}

export async function gatewayStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const res = await gatewayFetch(path, { body, signal, timeoutMs: 0 });
  if (!res.ok) throw await toGatewayError(res);
  if (!res.body) throw new GatewayError("Gateway returned an empty stream.", 502);
  return res;
}

export async function startChatCompletion(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await gatewayStream("/chat/completions", {
      ...payload,
      stream: true,
      stream_options: { include_usage: true },
    }, signal);
  } catch (err) {
    const retriable =
      err instanceof GatewayError &&
      (err.status === 400 || err.status === 422) &&
      (err.body ?? "").includes("stream_options");
    if (!retriable) throw err;
    return gatewayStream("/chat/completions", { ...payload, stream: true }, signal);
  }
}

export async function transcribeAudio(
  wav: Uint8Array,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "speech.wav");
  form.append("model", model);
  const res = await fetch(`${env.CALLMISSED_API_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CALLMISSED_API_KEY}` },
    body: form,
    cache: "no-store",
    signal: combineSignals(signal, 30_000),
  });
  if (!res.ok) throw await toGatewayError(res);
  const json = (await res.json()) as { text?: string };
  return json.text ?? "";
}

export async function synthesizeSpeech(
  text: string,
  model: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const res = await gatewayFetch("/audio/speech", {
    body: { model, input: text, response_format: "wav" },
    signal,
    timeoutMs: 45_000,
  });
  if (!res.ok) throw await toGatewayError(res);
  return new Uint8Array(await res.arrayBuffer());
}

export type GatewayImage = { b64_json?: string; url?: string; revised_prompt?: string };
export type GatewayImagesResponse = { created?: number; data?: GatewayImage[] };

export async function generateImages(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<GatewayImagesResponse> {
  return gatewayJSON<GatewayImagesResponse>("/images/generations", {
    body: payload,
    signal,
    timeoutMs: 120_000,
  });
}

const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;

export async function fetchImageAsDataUri(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new GatewayError(`Failed to download generated image (${res.status}).`, 502);
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > MAX_REMOTE_IMAGE_BYTES) {
    throw new GatewayError("Generated image exceeded the size limit.", 502);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new GatewayError("Generated image exceeded the size limit.", 502);
  }
  const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
  const mime = type.startsWith("image/") ? type : "image/png";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

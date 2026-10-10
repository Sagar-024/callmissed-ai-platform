export type VoiceRelay = {
  sid: string;
  identity: string;
  createdAt: number;
  down: WritableStreamDefaultWriter<Uint8Array> | null;
  upReader: ReadableStreamDefaultReader<Uint8Array>;
  upWriter: WritableStreamDefaultWriter<Uint8Array>;
  upPosts: number;
  upClosed: boolean;
  engineStarted: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  abort: AbortController;
};

const RELAY_PAIR_TIMEOUT_MS = 30_000;

const globalRelays = globalThis as typeof globalThis & {
  __callmissedVoiceRelays?: Map<string, VoiceRelay>;
};

const relays = (globalRelays.__callmissedVoiceRelays ??= new Map());

export function getRelay(sid: string): VoiceRelay | undefined {
  return relays.get(sid);
}

export function createRelay(sid: string, identity: string): VoiceRelay {
  const existing = relays.get(sid);
  if (existing) return existing;
  const up = new TransformStream<Uint8Array, Uint8Array>();
  const relay: VoiceRelay = {
    sid,
    identity,
    createdAt: Date.now(),
    down: null,
    upReader: up.readable.getReader(),
    upWriter: up.writable.getWriter(),
    upPosts: 0,
    upClosed: false,
    engineStarted: false,
    idleTimer: null,
    abort: new AbortController(),
  };
  relays.set(sid, relay);
  const timer = setTimeout(() => closeRelay(sid), RELAY_PAIR_TIMEOUT_MS);
  if (typeof timer.unref === "function") timer.unref();
  relay.idleTimer = timer;
  return relay;
}

export function clearRelayIdleTimer(relay: VoiceRelay): void {
  if (relay.idleTimer) {
    clearTimeout(relay.idleTimer);
    relay.idleTimer = null;
  }
}

export function attachDown(relay: VoiceRelay, writer: WritableStreamDefaultWriter<Uint8Array>): boolean {
  if (relay.down) return false;
  relay.down = writer;
  return true;
}

export function enqueueUp(relay: VoiceRelay, bytes: Uint8Array): boolean {
  if (relay.abort.signal.aborted || relay.upClosed || relay.upPosts >= 600) return false;
  relay.upPosts += 1;
  void relay.upWriter.write(bytes).catch(() => {});
  return true;
}

export function closeUp(relay: VoiceRelay): void {
  relay.upClosed = true;
  void relay.upWriter.close().catch(() => {});
}

export function closeRelay(sid: string): void {
  const relay = relays.get(sid);
  if (!relay) return;
  relays.delete(sid);
  relay.upClosed = true;
  clearRelayIdleTimer(relay);
  relay.abort.abort();
  if (relay.down) {
    void relay.down.close().catch(() => {});
  }
  void relay.upWriter.close().catch(() => {});
}

export function relayIsPaired(relay: VoiceRelay): boolean {
  return relay.down !== null;
}

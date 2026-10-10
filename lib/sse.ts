export type SSEFrame = {
  event?: string;
  data: string;
};

export function encodeSSE(payload: unknown, event?: string): string {
  const prefix = event ? `event: ${event}\n` : "";
  return `${prefix}data: ${JSON.stringify(payload)}\n\n`;
}

export function createSSEParser() {
  let buffer = "";

  function parseBlock(block: string): SSEFrame | null {
    let data = "";
    let event: string | undefined;

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue;
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? "" : line.slice(idx + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      if (field === "data") data = data ? `${data}\n${value}` : value;
      else if (field === "event") event = value;
    }

    if (!data) return null;
    return event ? { event, data } : { data };
  }

  return {
    push(chunk: string): SSEFrame[] {
      buffer += chunk;
      const frames: SSEFrame[] = [];
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const frame = parseBlock(block);
        if (frame) frames.push(frame);
      }
      return frames;
    },
    flush(): SSEFrame[] {
      if (!buffer.trim()) {
        buffer = "";
        return [];
      }
      const frame = parseBlock(buffer);
      buffer = "";
      return frame ? [frame] : [];
    },
  };
}

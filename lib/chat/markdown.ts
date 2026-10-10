const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

type Marker = { char: string; len: number };

function readMarker(line: string): { marker: Marker; rest: string } | null {
  const match = line.match(FENCE_RE);
  if (!match) return null;
  return { marker: { char: match[2][0], len: match[2].length }, rest: match[3] };
}

function walkFences(lines: string[]): Marker | null {
  let open: Marker | null = null;
  for (const line of lines) {
    const parsed = readMarker(line);
    if (!parsed) continue;
    if (!open) {
      open = parsed.marker;
      continue;
    }
    const isClosing =
      parsed.marker.char === open.char &&
      parsed.marker.len >= open.len &&
      parsed.rest.trim() === "";
    if (isClosing) open = null;
  }
  return open;
}

function countInlineBackticks(lines: string[]): number {
  let open: Marker | null = null;
  let count = 0;
  for (const line of lines) {
    const parsed = readMarker(line);
    if (parsed) {
      if (!open) {
        open = parsed.marker;
        continue;
      }
      const isClosing =
        parsed.marker.char === open.char &&
        parsed.marker.len >= open.len &&
        parsed.rest.trim() === "";
      if (isClosing) {
        open = null;
        continue;
      }
    }
    if (!open) count += (line.match(/`/g) ?? []).length;
  }
  return count;
}

export function sanitizeStreamMarkdown(source: string): string {
  if (!source) return source;

  const lines = source.split("\n");
  const openFence = walkFences(lines);
  let output = source;

  if (openFence) output += `\n${openFence.char.repeat(openFence.len)}`;

  if (countInlineBackticks(output.split("\n")) % 2 === 1) output += "`";

  return output;
}

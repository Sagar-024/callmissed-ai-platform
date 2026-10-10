export function parseSize(size: string): { w: number; h: number } {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(size);
  if (!match) return { w: 1024, h: 1024 };
  return { w: Number(match[1]), h: Number(match[2]) };
}

export function aspectRatioCss(size: string): string {
  const { w, h } = parseSize(size);
  return `${w} / ${h}`;
}

export function imageFileName(model: string, id: string, index = 0): string {
  const slug = model.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "image";
  const shortId = id.replace(/[^a-z0-9]+/gi, "").slice(-8).toLowerCase() || "local";
  return `cm_${slug}_${shortId}${index > 0 ? `_${index}` : ""}.png`;
}

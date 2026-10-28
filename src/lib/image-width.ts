/**
 * A photo's size lives in its Markdown address as "#width=50": the share of the
 * text column it fills, in percent. Browsers and servers ignore what comes after
 * "#", so the address still loads anywhere, and the size survives a round trip.
 */
const WIDTH = /#width=(\d{1,3})$/;

export const MIN_WIDTH = 10;

/** The address without its size, and the size (10–100), or null when it fills its natural size. */
export function splitImageSrc(src: string): { src: string; width: number | null } {
  const m = src.match(WIDTH);
  if (!m) return { src, width: null };
  const width = Math.min(100, Math.max(MIN_WIDTH, Number(m[1])));
  return { src: src.slice(0, m.index), width };
}

export function joinImageSrc(src: string, width: number | null | undefined) {
  return width ? `${src}#width=${Math.round(width)}` : src;
}

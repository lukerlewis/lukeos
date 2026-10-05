import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system's own text sizes (globals.css), so `text-meta` counts as a
// size and doesn't knock out a text colour like `text-primary-foreground`.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["tag", "meta", "preview", "control", "body", "heading", "section", "title", "display"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A short wait. Used after ticking a task, so the tick has time to draw
 * before a list that hides finished tasks takes it away.
 */
export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

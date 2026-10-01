import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A short wait. Used after ticking a task, so the tick has time to draw
 * before a list that hides finished tasks takes it away.
 */
export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

"use client";

import { createPortal } from "react-dom";
import { clock } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { useFocus } from "./focus-provider";

const HOUR = 3_600_000;

type DocumentPictureInPicture = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};

/** Chrome, Edge and Arc on computers can float a small window above every app; Safari and Firefox can't. */
export function miniPlayerSupported() {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

/** Opens the floating window, styled like the app (same stylesheets, light or dark). Must be called from a click. */
export async function openMiniWindow() {
  const pip = (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;
  if (!pip) return null;
  const win = await pip.requestWindow({ width: 220, height: 84 });
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = win.document.createElement("link");
      link.rel = "stylesheet";
      link.href = node.href; // absolute, so it loads in the new window
      win.document.head.append(link);
    } else win.document.head.append(node.cloneNode(true));
  }
  win.document.documentElement.className = document.documentElement.className;
  win.document.documentElement.style.colorScheme = document.documentElement.style.colorScheme;
  win.document.title = "Focus";
  win.document.body.className = "m-0 bg-background text-foreground";
  return win;
}

/**
 * What the floating window shows: just the ring filling up and the time, for
 * whichever timer is running (or the one on screen when neither is).
 */
export function MiniPlayer({ win }: { win: Window }) {
  const focus = useFocus();
  if (!focus) return null;
  const { pomodoro, stopwatch, mode } = focus;
  const showStopwatch = stopwatch.running || (!pomodoro.running && mode === "timer");
  const ms = showStopwatch ? stopwatch.elapsedMs : pomodoro.leftMs;
  const progress = showStopwatch ? (stopwatch.elapsedMs % HOUR) / HOUR : 1 - pomodoro.leftMs / pomodoro.lengthMs;
  const soft = !showStopwatch && pomodoro.phase !== "focus";
  const r = 40;
  const length = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress || 0));

  return createPortal(
    // Sized to the window, so dragging it bigger makes the timer bigger.
    <div className="flex h-dvh items-center justify-center gap-[6vw] px-[6vw]">
      <svg viewBox="0 0 100 100" className="aspect-square h-[min(56vh,30vw)] shrink-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="14" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="14"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - p)}
          className={cn(soft ? "stroke-muted-foreground" : "stroke-foreground", p === 0 && "opacity-0")}
        />
      </svg>
      <span role="timer" className="text-[min(42vh,22vw)] leading-none font-medium tracking-[-0.04em] text-ink tabular-nums">
        {clock(ms)}
      </span>
    </div>,
    win.document.body,
  );
}

"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { clock } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { useFocus } from "./focus-provider";

const HOUR = 3_600_000;

type DocumentPictureInPicture = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};

/**
 * The floating timer sits above every app on the computer, like a video in
 * picture-in-picture. Chrome, Edge and Arc float a real little page; Safari
 * floats a live picture of the timer drawn as a video. Firefox can do neither.
 */
export function miniPlayerSupported() {
  return typeof window !== "undefined" && (floatsPage() || floatsVideo());
}

/** Chrome, Edge, Arc: a real page in the floating window. */
export const floatsPage = () => "documentPictureInPicture" in window;

const floatsVideo = () =>
  document.pictureInPictureEnabled === true && typeof HTMLCanvasElement.prototype.captureStream === "function";

export type MiniView = { ms: number; progress: number; soft: boolean };

/** What the floating timer shows: whichever timer is running, or the one on screen when neither is. */
export function miniView(focus: Pick<NonNullable<ReturnType<typeof useFocus>>, "pomodoro" | "stopwatch" | "mode">): MiniView {
  const { pomodoro, stopwatch, mode } = focus;
  const showStopwatch = stopwatch.running || (!pomodoro.running && mode === "timer");
  const progress = showStopwatch ? (stopwatch.elapsedMs % HOUR) / HOUR : 1 - pomodoro.leftMs / pomodoro.lengthMs;
  return {
    ms: showStopwatch ? stopwatch.elapsedMs : pomodoro.leftMs,
    progress: Math.min(1, Math.max(0, progress || 0)),
    soft: !showStopwatch && pomodoro.phase !== "focus",
  };
}

// Safari: the timer is drawn on a canvas, which plays as a muted video that floats.
const W = 440;
const H = 168;
let video: HTMLVideoElement | null = null;
let canvas: HTMLCanvasElement | null = null;

/** Gets the video ready ahead of the click, as Safari only floats a video that's already playing. */
export function prepareMiniVideo(onFloatChange: (floating: boolean) => void) {
  if (video || !floatsVideo()) return;
  canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  drawMiniVideo({ ms: 0, progress: 0, soft: false });
  video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = canvas.captureStream();
  video.setAttribute("aria-hidden", "true");
  // Safari won't float a video that isn't on screen, so it sits in a corner, invisibly small.
  Object.assign(video.style, { position: "fixed", right: "0", bottom: "0", width: "2px", height: "2px", opacity: "0.01", pointerEvents: "none" });
  document.body.append(video);
  const v = video;
  // The floating window's own pause button would freeze the picture, so keep it playing.
  v.addEventListener("pause", () => void v.play().catch(() => {}));
  v.addEventListener("enterpictureinpicture", () => onFloatChange(true));
  v.addEventListener("leavepictureinpicture", () => onFloatChange(false));
  v.addEventListener("webkitpresentationmodechanged", () =>
    onFloatChange((v as SafariVideo).webkitPresentationMode === "picture-in-picture"),
  );
  void v.play().catch(() => {});
}

type SafariVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: "inline" | "picture-in-picture") => void;
  webkitPresentationMode?: string;
};

/** Floats the timer, or puts it back. Returns false when the browser refused. */
export async function toggleMiniVideo() {
  const v = video as SafariVideo | null;
  if (!v) return false;
  if (document.pictureInPictureElement === v || v.webkitPresentationMode === "picture-in-picture") {
    if (v.webkitSetPresentationMode) v.webkitSetPresentationMode("inline");
    else await document.exitPictureInPicture().catch(() => {});
    return true;
  }
  try {
    // Safari's own way first: it's the one its web apps honour.
    if (v.webkitSupportsPresentationMode?.("picture-in-picture") && v.webkitSetPresentationMode) {
      v.webkitSetPresentationMode("picture-in-picture");
      return true;
    }
    await v.requestPictureInPicture();
    return true;
  } catch (err) {
    console.error("[focus] couldn't float the timer", err);
    return false;
  }
}

/** Draws the ring and the time in the app's own colours and font. */
export function drawMiniVideo(view: MiniView) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => css.getPropertyValue(name).trim() || "#000";
  ctx.fillStyle = color("--background");
  ctx.fillRect(0, 0, W, H);
  const r = 40;
  const cx = 34 + r;
  const cy = H / 2;
  ctx.lineWidth = 14;
  ctx.strokeStyle = color("--muted");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (view.progress > 0) {
    ctx.strokeStyle = color(view.soft ? "--muted-foreground" : "--foreground");
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + view.progress * Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = color("--ink");
  ctx.font = `500 76px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.fillText(clock(view.ms), cx + r + 30, cy + 4);
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

/** The floating page (Chrome, Edge, Arc): just the ring filling up and the time. */
export function MiniPlayer({ win }: { win: Window }) {
  const focus = useFocus();
  if (!focus) return null;
  const { ms, progress: p, soft } = miniView(focus);
  const r = 40;
  const length = 2 * Math.PI * r;

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

/** Safari's floating timer is a picture: this redraws it as the time changes. */
export function MiniVideoPainter() {
  const focus = useFocus();
  const view = focus ? miniView(focus) : null;
  useEffect(() => {
    if (view) drawMiniVideo(view);
  }, [view?.ms, view?.progress, view?.soft]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

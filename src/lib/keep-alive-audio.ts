"use client";

/**
 * Keeps the installed iPhone app awake for a while after the music is paused.
 *
 * iOS freezes a home-screen web app in the background soon after its audio
 * stops. Once frozen, the lock screen's Play button reaches nothing, so music
 * paused from the lock screen wouldn't start again until Luke opened the app.
 * A running Web Audio context counts as audio still playing, so while it runs
 * the app isn't frozen. It plays a signal far too quiet to hear, and only for
 * a few minutes after a pause, so it doesn't drain the battery.
 *
 * `wake` must be called while starting playback (a tap or a lock-screen
 * command), because Safari only lets audio start then.
 */

const AFTER_PAUSE_MS = 10 * 60_000;

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function create() {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const c = new Ctor();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = 30;
  gain.gain.value = 0.0001;
  osc.connect(gain).connect(c.destination);
  osc.start();
  return c;
}

/** Starts (or keeps) the quiet signal going. */
export function wake() {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    ctx ??= create();
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
  } catch {}
}

/** After a pause: keep going for a few minutes, then let the phone rest. */
export function windDown() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(stop, AFTER_PAUSE_MS);
}

/** Stops the quiet signal now. */
export function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {});
}

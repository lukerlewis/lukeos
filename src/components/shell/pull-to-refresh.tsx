"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";

/** How far (after damping) a pull has to go before letting go refreshes. */
const TRIGGER = 64;
const MAX_PULL = 96;
/** Holding still this long before moving is a press-and-hold (a board drag), not a pull. */
const HOLD_MS = 200;
/** The spinner stays at least this long, so a quick refresh still reads as one. */
const MIN_SPIN_MS = 500;

const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isPhone = () => window.matchMedia("(max-width: 767.98px)").matches;

/** True when the touch started somewhere a downward drag means something else. */
function startsElsewhere(target: EventTarget | null) {
  if (document.querySelector("dialog[open]")) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-pull]")) return true;
  // Inside a box that scrolls on its own and isn't at its top: the drag scrolls that box.
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
  }
  return false;
}

/**
 * Pull down from the top of any screen to refresh it, on phones. An app added
 * to the iPhone Home Screen doesn't get the browser's own pull to refresh, so
 * this adds one: a small circle follows your finger down and spins while the
 * screen's data reloads. It only starts at the very top of the page, and
 * stays out of the way of typing, pop-ups, sideways scrolling and board drags.
 */
export function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = spinning || isPending;
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!isInstalled()) return; // In a browser tab, the browser's own pull to refresh is there already.

    let start: { x: number; y: number; t: number } | null = null;
    let pulling = false;
    let distance = 0;

    const reset = () => {
      start = null;
      pulling = false;
      distance = 0;
      setPull(0);
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      if (busyRef.current || e.touches.length !== 1 || !isPhone() || window.scrollY > 0) return;
      if (startsElsewhere(e.target)) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: e.timeStamp };
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!pulling) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // Sideways, upwards, after a press-and-hold, or the page has scrolled: not a pull.
        if (dy <= 0 || Math.abs(dx) > dy || e.timeStamp - start.t > HOLD_MS || window.scrollY > 0) {
          start = null;
          return;
        }
        pulling = true;
      }
      // Resistance grows the further you pull, like the real thing.
      distance = Math.min(MAX_PULL, Math.max(0, dy) * 0.5);
      setPull(distance);
    };

    const onEnd = () => {
      if (!start) return;
      const go = pulling && distance >= TRIGGER;
      reset();
      if (!go) return;
      setSpinning(true);
      startTransition(() => router.refresh());
      setTimeout(() => setSpinning(false), MIN_SPIN_MS);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [router]);

  const shown = busy ? TRIGGER : pull;
  const ready = pull >= TRIGGER;
  if (!shown) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-40 flex justify-center md:hidden"
      role={busy ? "status" : undefined}
      aria-label={busy ? "Refreshing" : undefined}
    >
      <div
        className={cn(
          "pull-indicator flex size-9 items-center justify-center rounded-full border bg-card text-muted-foreground border-stroke",
          (ready || busy) && "text-foreground",
          !pull && "pull-indicator-settle",
        )}
        style={{ translate: `0 ${shown - 28}px`, opacity: Math.min(1, shown / TRIGGER) }}
      >
        <RefreshCw
          className={cn("size-4", busy && "pull-spin")}
          style={busy ? undefined : { rotate: `${(pull / TRIGGER) * 270}deg` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

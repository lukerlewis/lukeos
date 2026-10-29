"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { rememberPlace, rememberScroll, scroller, takePendingScroll } from "@/lib/places";

/** Keeps track of where Luke is in each section, and puts his scroll back when he returns. */
export function PlaceMemory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    rememberPlace(pathname, search);
    const back = takePendingScroll(search ? `${pathname}?${search}` : pathname);
    if (back) return restoreScroll(back.scroll);
  }, [pathname, search]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(rememberScroll, 150);
    };
    // Capture, so the main column's scrolling is heard as well as the page's.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, []);

  return null;
}

/**
 * The page may still be filling in, so this keeps trying for a moment until
 * it's long enough to reach the old spot. Luke scrolling or typing stops it.
 */
function restoreScroll(top: number) {
  let frame = 0;
  let tries = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    ["wheel", "touchstart", "keydown", "pointerdown"].forEach((e) => window.removeEventListener(e, stop, true));
  };
  ["wheel", "touchstart", "keydown", "pointerdown"].forEach((e) => window.addEventListener(e, stop, { capture: true, passive: true }));
  const step = () => {
    const el = scroller();
    if (el) {
      el.scrollTop = top;
      if (Math.abs(el.scrollTop - top) < 2 && tries > 10) return stop();
    }
    if (++tries > 120) return stop();
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return stop;
}

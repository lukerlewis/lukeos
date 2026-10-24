"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

/** How old a screen can be before it's quietly fetched again. */
const STALE_MS = 10_000;
/** How long the app can sit in the background before its screen is fetched again. */
const AWAY_MS = 60_000;

/**
 * Opening LukeOS shows the last screen saved on this device at once (see
 * public/sw.js), and coming back to it shows whatever was left open. Either
 * way the screen may be out of date, so this fetches it again in the
 * background and swaps in the fresh version when it arrives.
 */
export function KeepFresh({ renderedAt }: { renderedAt: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => startTransition(() => router.refresh());
    // A saved copy of the page, rather than one the server just made.
    if (Date.now() - renderedAt > STALE_MS) refresh();

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // Only on first load: later screens come from the server fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

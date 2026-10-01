"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/push-client";

/**
 * Keeps the notification helper (service worker) installed, and refreshes
 * the screen when a notification arrives while LukeOS is open, so a new
 * message from Claude shows up straight away.
 */
export function PushListener() {
  const router = useRouter();
  useEffect(() => {
    registerServiceWorker();
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "lukeos:push") router.refresh();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);
  return null;
}

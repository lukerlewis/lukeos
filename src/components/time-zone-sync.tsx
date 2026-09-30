"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { op } from "@/lib/ops-client";

/**
 * Keeps LukeOS's idea of "today" in step with this device's time zone, so
 * due dates and the Today screen match Luke's clock (and Claude's view too).
 */
export function TimeZoneSync({ saved }: { saved: string }) {
  const router = useRouter();
  useEffect(() => {
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!here || here === saved) return;
    op("set_time_zone", { timeZone: here })
      .then(() => router.refresh())
      .catch(() => {});
  }, [saved, router]);
  return null;
}

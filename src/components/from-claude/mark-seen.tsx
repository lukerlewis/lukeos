"use client";

import { useEffect } from "react";
import { op } from "@/lib/ops-client";

export const SEEN_EVENT = "lukeos:from-claude-seen";

/**
 * Once Luke has looked at the Agent log, clear the New count. The dots on this
 * visit stay, so he can still see what's new; they're gone next time.
 */
export function MarkFromClaudeSeen({ hasNew }: { hasNew: boolean }) {
  useEffect(() => {
    if (!hasNew) return;
    op("mark_from_claude_seen", {})
      .then(() => window.dispatchEvent(new Event(SEEN_EVENT)))
      .catch(() => {});
  }, [hasNew]);
  return null;
}

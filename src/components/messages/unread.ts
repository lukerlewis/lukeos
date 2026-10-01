"use client";

import { useEffect, useState } from "react";

export const MESSAGES_READ_EVENT = "lukeos:messages-read";

/** The unread count from the server, cleared straight away when Luke opens Messages. */
export function useUnreadMessages(fromServer: number) {
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  useEffect(() => {
    const clear = () => setClearedAt(fromServer);
    window.addEventListener(MESSAGES_READ_EVENT, clear);
    return () => window.removeEventListener(MESSAGES_READ_EVENT, clear);
  }, [fromServer]);
  return clearedAt === fromServer ? 0 : fromServer;
}

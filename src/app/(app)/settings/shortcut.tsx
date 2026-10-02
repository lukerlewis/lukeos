"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyAddress } from "./claude";

/**
 * Makes the address the iPhone Shortcut sends things to, with its key in it.
 * It's shown once; making a new one stops the old one working.
 */
export function ShortcutKey({ hasKey, address }: { hasKey: boolean; address: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    if (hasKey && !key && !confirm("Make a new address? The Shortcut will need the new one.")) return;
    setBusy(true);
    const res = await fetch("/api/inspiration/shortcut-key", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return alert(body.error ?? "Couldn't make an address.");
    setKey(body.key);
  }

  if (key) return <CopyAddress address={`${address}?key=${key}`} label="Copy Shortcut address" />;
  return (
    <Button variant="outline" size="sm" onClick={make} disabled={busy} className="self-start">
      {hasKey ? "Make a new address" : "Make the address"}
    </Button>
  );
}

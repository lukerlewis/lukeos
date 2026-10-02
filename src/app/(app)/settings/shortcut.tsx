"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyAddress } from "./claude";

/** Makes the key the iPhone Shortcut signs with. It's shown once; a new one replaces the old. */
export function ShortcutKey({ hasKey }: { hasKey: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    if (hasKey && !key && !confirm("Make a new key? The Shortcut will need the new one.")) return;
    setBusy(true);
    const res = await fetch("/api/inspiration/shortcut-key", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return alert(body.error ?? "Couldn't make a key.");
    setKey(body.key);
  }

  if (key) return <CopyAddress address={key} label="Copy key" />;
  return (
    <Button variant="outline" size="sm" onClick={make} disabled={busy} className="self-start">
      {hasKey ? "Make a new key" : "Make a key"}
    </Button>
  );
}

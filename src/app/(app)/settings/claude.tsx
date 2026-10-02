"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyAddress({ address, label = "Copy connector address" }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2">
      <code className="grow truncate text-[13px] select-all">{address}</code>
      <Button variant="ghost" size="sm" onClick={copy} aria-label={label}>
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function DisconnectButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (!confirm(`Disconnect ${name}? It won't be able to use LukeOS until you connect it again.`)) return;
    setBusy(true);
    const res = await fetch(`/api/connections/${id}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "Couldn't disconnect it.");
    setBusy(false);
    router.refresh();
  }

  return (
    <Button variant="danger" size="sm" onClick={disconnect} disabled={busy}>
      Disconnect
    </Button>
  );
}

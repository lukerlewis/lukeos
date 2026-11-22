"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

const field = "h-11 w-full rounded-lg border bg-card px-3 text-body border-stroke-strong outline-none md:text-control focus-visible:border-ring";

type Status = {
  configured: boolean;
  connected: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  failedTypes: string[];
  liveUpdates: boolean;
  liveUpdatesError: string | null;
};

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Paste the Google client, sign in with Google, or disconnect. */
export function HealthConnect({ status, redirectUri, error }: { status: Status; redirectUri: string; error: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!status.configured);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/health/client", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, clientSecret }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return showToast(body.error ?? "Couldn't save that.");
    setEditing(false);
    setClientSecret("");
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    try {
      await op("disconnect_health", {});
      router.refresh();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      {(error ?? status.lastError) && <Card className="px-4 py-3 text-control text-danger">{error ?? status.lastError}</Card>}

      {status.connected ? (
        <Card>
          <ul className="divide-y divide-border">
            <Row label="Connected" value={status.connectedAt ? when.format(new Date(status.connectedAt)) : "Yes"} />
            <Row label="Last update" value={status.lastSyncAt ? when.format(new Date(status.lastSyncAt)) : "Not yet"} />
            <Row label="Live updates" value={status.liveUpdates ? "On" : "Off, daily only"} note={status.liveUpdates ? null : status.liveUpdatesError} />
            {status.failedTypes.length > 0 && <Row label="Not coming in" value={status.failedTypes.join(", ")} />}
          </ul>
        </Card>
      ) : (
        !editing && (
          <a href="/api/health/authorize" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            Connect Fitbit
          </a>
        )
      )}

      {editing ? (
        <Card className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-meta text-muted-foreground">Client ID</span>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-meta text-muted-foreground">Client secret</span>
            <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" autoComplete="off" spellCheck={false} className={field} />
          </label>
          <RedirectUri uri={redirectUri} />
          <div className="flex justify-end gap-2">
            {status.configured && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button onClick={save} disabled={busy || !clientId.trim() || !clientSecret.trim()}>
              Save
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Change Google client
          </Button>
          {status.connected && (
            <Button variant="danger" size="sm" onClick={disconnect} disabled={busy}>
              Disconnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function RedirectUri({ uri }: { uri: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-meta text-muted-foreground">Redirect URI</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 grow truncate rounded-lg bg-muted px-3 py-2.5 text-meta">{uri}</code>
        <Button
          variant="outline"
          size="icon"
          aria-label="Copy redirect URI"
          onClick={() => navigator.clipboard.writeText(uri).then(() => showToast("Copied"), () => showToast("Couldn't copy."))}
        >
          <Copy aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <li className="flex min-h-14 flex-col justify-center gap-0.5 px-4 py-3">
      <span className="flex items-center gap-3">
        <span className="grow text-control">{label}</span>
        <span className="text-right text-control text-muted-foreground">{value}</span>
      </span>
      {note && <span className="text-meta text-muted-foreground">{note}</span>}
    </li>
  );
}

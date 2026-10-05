"use client";

import { Link2, LogOut, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { friendlyPasskeyError, registerPasskey } from "@/lib/passkey-client";
import { CopyAddress } from "./claude";

export function AddDeviceButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      await registerPasskey();
      setMessage("Added. This device can now sign in on its own.");
      router.refresh();
    } catch (err) {
      setMessage(friendlyPasskeyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" onClick={add} disabled={busy}>
        <Plus className="size-4" aria-hidden />
        {busy ? "Waiting for your device…" : "Add this device"}
      </Button>
      {message && (
        <p role="status" className="text-meta text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}

/** Makes a one-time link that a new device (with no passkey yet) opens to add its own. */
export function NewDeviceLink() {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/invite", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setLink(`${location.origin}/sign-in/add/${data.code}`);
      // Hide it once it stops working.
      setTimeout(() => setLink(null), new Date(data.expiresAt).getTime() - Date.now());
    } else {
      setError(data.error ?? "Couldn't make a link.");
    }
    setBusy(false);
  }

  if (link) {
    return (
      <div className="flex w-full flex-col gap-2">
        <CopyAddress address={link} label="Copy link" />
        <p className="text-meta text-muted-foreground">Open on the new device. Works once, for 10 minutes.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" onClick={make} disabled={busy}>
        <Link2 className="size-4" aria-hidden />
        Add a new device
      </Button>
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function RemoveDeviceButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm(`Remove ${name}? It won't be able to sign in any more.`)) return;
    setBusy(true);
    const res = await fetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "Couldn't remove it.");
    setBusy(false);
    router.refresh();
  }

  return (
    <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
      Remove
    </Button>
  );
}

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={signOut}>
      <LogOut className="size-4" aria-hidden />
      Sign out
    </Button>
  );
}

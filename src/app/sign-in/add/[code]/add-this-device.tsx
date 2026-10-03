"use client";

import { ScanFace } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { friendlyPasskeyError, registerPasskey } from "@/lib/passkey-client";

export function AddThisDevice({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(code);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(friendlyPasskeyError(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <Button size="lg" className="w-full" onClick={go} disabled={busy}>
        <ScanFace className="size-5" aria-hidden />
        {busy ? "Waiting for your device…" : "Create passkey"}
      </Button>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

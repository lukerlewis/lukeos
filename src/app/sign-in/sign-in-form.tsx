"use client";

import { ScanFace } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { friendlyPasskeyError, registerPasskey, signInWithPasskey } from "@/lib/passkey-client";

export function SignInForm({ mode, next = "/" }: { mode: "sign-in" | "set-up"; next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await (mode === "set-up" ? registerPasskey() : signInWithPasskey());
      router.replace(next);
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
        {busy ? "Waiting for your device…" : mode === "set-up" ? "Create passkey" : "Sign in"}
      </Button>
      {mode === "sign-in" && (
        <p className="text-[13px] text-muted-foreground">
          On a new computer? Choose the option to use your phone, then scan the code.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

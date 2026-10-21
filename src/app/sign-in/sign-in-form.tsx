"use client";

import { ScanFace } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { friendlyPasskeyError, registerPasskey, signInWithPasskey } from "@/lib/passkey-client";

export function SignInForm({ mode, next = "/" }: { mode: "sign-in" | "set-up"; next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = useIsMacApp();

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
      {mode === "sign-in" && !desktop && (
        <p className="text-meta text-muted-foreground">
          On a new computer? Choose the option to use your phone, then scan the code.
        </p>
      )}
      {mode === "sign-in" && desktop && <CodeSignIn next={next} />}
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** True inside the LukeOS Mac app, which adds `window.lukeosDesktop`. */
function useIsMacApp() {
  return useSyncExternalStore(
    () => () => {},
    () => "lukeosDesktop" in window,
    () => false,
  );
}

/** The Mac app can't make passkeys, so it signs in with the code from Settings > Devices instead. */
function CodeSignIn({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // A pasted link works too: the code is its last part.
    const res = await fetch("/api/auth/invite/use", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim().split("/").pop() }),
    });
    if (res.ok) {
      router.replace(next);
      router.refresh();
      return;
    }
    setError((await res.json().catch(() => ({}))).error ?? "That code didn't work.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-4 flex w-full flex-col gap-2 border-t pt-6 text-left">
      <label htmlFor="device-code" className="text-meta text-muted-foreground">
        Or use a code from Settings › Devices on your phone
      </label>
      <div className="flex gap-2">
        <input
          id="device-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABCDE-23456"
          autoComplete="off"
          spellCheck={false}
          className="h-11 min-w-0 flex-1 rounded-lg border bg-card px-3 text-base uppercase md:text-control"
        />
        <Button type="submit" variant="outline" disabled={busy || !code.trim()}>
          Sign in
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

"use client";

import { Bell, BellOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from "@/lib/push-client";

const DISMISSED = "lukeos:push-prompt-dismissed";

function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);
  return [state, setState] as const;
}

/** On Messages: a nudge to turn on notifications, until they're on or he says no. */
export function PushPrompt() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    pushState().then(
      (s) => {
        let saidNo = false;
        try {
          saidNo = localStorage.getItem(DISMISSED) === "1";
        } catch {}
        setDismissed(saidNo);
        setState(s);
      },
      () => setState("unsupported"),
    );
  }, []);

  if (dismissed || !state || state === "on" || state === "unsupported" || state === "denied") return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl items-start gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
      <Bell className="mt-0.5 size-[18px] shrink-0 text-foreground" aria-hidden />
      <div className="flex grow flex-col gap-2">
        <p className="text-[14px]">
          {state === "needs-install"
            ? "To get a notification when Claude texts you, add LukeOS to your Home Screen (Share, then Add to Home Screen) and open it from there."
            : "Get a notification when Claude texts you."}
        </p>
        {state === "off" && (
          <Button
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setState(await enablePush());
              } catch (err) {
                alert((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Turn on notifications
          </Button>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Not now" className="-m-1 p-1 text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
}

/** In Settings: notifications on or off for this device, and a test. */
export function PushSettings({ devices }: { devices: number }) {
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await action();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const explain: Record<PushState, string> = {
    on: "On for this device. You'll get a notification when Claude texts you.",
    off: "Off for this device.",
    denied: "Notifications are blocked for LukeOS. Turn them on in this device's settings (on iPhone: Settings, Notifications, LukeOS).",
    "needs-install": "On iPhone and iPad, add LukeOS to your Home Screen (Share, then Add to Home Screen) and open it from there to turn these on.",
    unsupported: "This browser can't show notifications.",
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <p className="text-[13px] text-muted-foreground">
        {state ? explain[state] : "Checking this device…"}
        {devices > 0 && ` ${devices} ${devices === 1 ? "device has" : "devices have"} them on.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {state === "off" && (
          <Button size="sm" disabled={busy} onClick={() => run(async () => setState(await enablePush()))}>
            <Bell className="size-4" /> Turn on
          </Button>
        )}
        {state === "on" && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const reached = await sendTestPush();
                  setNote(reached ? "Sent. It should arrive in a moment." : "No device has notifications on yet.");
                })
              }
            >
              Send a test
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => setState(await disablePush()))}>
              <BellOff className="size-4" /> Turn off
            </Button>
          </>
        )}
      </div>
      {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
    </div>
  );
}

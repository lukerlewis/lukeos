"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { op } from "@/lib/ops-client";

type Toast = { id: number; message: string; undo?: () => Promise<void> };

const EVENT = "lukeos:toast";

/** Shows a short message at the bottom of the screen, with an optional Undo. */
export function showToast(message: string, undo?: () => Promise<void>) {
  window.dispatchEvent(new CustomEvent<Omit<Toast, "id">>(EVENT, { detail: { message, undo } }));
}

/** "Moved to Trash", with an Undo that brings it straight back. */
export function showTrashedToast(type: "task" | "note" | "project", id: string, onUndone?: () => void) {
  const what = type === "task" ? "Task" : type === "note" ? "Note" : "Project";
  showToast(`${what} moved to Trash`, async () => {
    await op("restore_from_trash", { type, id });
    onUndone?.();
  });
}

/** Lives in the app's frame, so a message outlasts the screen that showed it. */
export function Toaster() {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const show = (e: Event) => {
      const detail = (e as CustomEvent<Omit<Toast, "id">>).detail;
      clearTimeout(timer.current);
      setBusy(false);
      setToast({ ...detail, id: Date.now() });
      timer.current = setTimeout(() => setToast(null), detail.undo ? 7000 : 3500);
    };
    window.addEventListener(EVENT, show);
    return () => {
      window.removeEventListener(EVENT, show);
      clearTimeout(timer.current);
    };
  }, []);

  if (!toast) return null;

  async function undo() {
    if (!toast?.undo) return;
    setBusy(true);
    try {
      await toast.undo();
      setToast(null);
      router.refresh();
    } catch (err) {
      setToast({ id: Date.now(), message: (err as Error).message });
    }
  }

  return (
    <div
      role="status"
      key={toast.id}
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 flex justify-center px-4 md:bottom-6"
    >
      <div className="flex min-h-11 items-center gap-3 rounded-xl bg-foreground py-1.5 pr-1.5 pl-4 text-[13px] font-medium text-background shadow-lg">
        <span className="py-1.5">{toast.message}</span>
        {toast.undo ? (
          <button
            type="button"
            onClick={undo}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 font-semibold underline-offset-2 hover:bg-background/15 disabled:opacity-60"
          >
            {busy ? "Undoing…" : "Undo"}
          </button>
        ) : (
          <span className="w-2.5" />
        )}
      </div>
    </div>
  );
}

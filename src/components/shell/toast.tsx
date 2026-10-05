"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { op } from "@/lib/ops-client";
import { pushUndo, undo as undoLatest } from "@/lib/undo";

/** `undo` is the id of the change the Undo button takes back. */
type Toast = { id: number; message: string; undo?: number };

const EVENT = "lukeos:toast";

/**
 * Shows a short message at the bottom of the screen. With `undo`, it gets an
 * Undo button, and Cmd+Z takes the change back too.
 */
export function showToast(message: string, undo?: () => Promise<void>) {
  const entry = undo ? pushUndo(message.charAt(0).toLowerCase() + message.slice(1), undo) : null;
  window.dispatchEvent(new CustomEvent<Omit<Toast, "id">>(EVENT, { detail: { message, undo: entry?.id } }));
}

/** Cmd+Z (Ctrl+Z) anywhere but a text box, where it undoes typing as usual. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

/** "Moved to Trash", with an Undo that brings it straight back. */
export function showTrashedToast(
  type: "task" | "note" | "artifact" | "document" | "card" | "project" | "sop" | "context" | "routine" | "entry" | "inspiration",
  id: string,
  onUndone?: () => void,
) {
  const what = { card: "Card", task: "Task", note: "Note", artifact: "Artifact", document: "Document", project: "Project", sop: "SOP", context: "Context file", routine: "Routine", entry: "Entry", inspiration: "Item" }[type];
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
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.defaultPrevented || isTyping(e.target)) return;
      e.preventDefault();
      void runUndo();
    };
    window.addEventListener(EVENT, show);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener(EVENT, show);
      window.removeEventListener("keydown", key);
      clearTimeout(timer.current);
    };
    // runUndo only uses setters and the router, which don't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runUndo(id?: number) {
    setBusy(true);
    try {
      const entry = await undoLatest(id);
      showToast(entry ? `Undone: ${entry.label}` : "Nothing to undo");
      if (entry) router.refresh();
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  if (!toast) return null;

  return (
    <div
      role="status"
      key={toast.id}
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 flex justify-center px-4 md:bottom-6"
    >
      <div className="motion-toast flex min-h-11 items-center gap-3 rounded-xl bg-foreground py-1.5 pr-1.5 pl-4 text-meta font-medium text-background">
        <span className="py-1.5">{toast.message}</span>
        {toast.undo !== undefined ? (
          <button
            type="button"
            onClick={() => runUndo(toast.undo)}
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

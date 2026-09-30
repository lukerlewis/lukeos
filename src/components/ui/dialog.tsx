"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A modal panel: a sheet from the bottom on phones, a centred card on
 * computers. Uses the browser's own <dialog>, so Escape and focus just work.
 */
export function Dialog({
  label,
  onClose,
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the dimmed backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40",
        "sm:m-auto sm:max-h-[85dvh] sm:max-w-lg sm:rounded-2xl",
        className,
      )}
    >
      {children}
    </dialog>
  );
}

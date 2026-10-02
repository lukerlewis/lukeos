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
  focusFirstField = true,
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  /** False: on touch screens, open without focusing a field, so the keyboard stays down. */
  focusFirstField?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // showModal focuses the first field; on touch screens that pops the keyboard up.
    if (!focusFirstField && window.matchMedia("(pointer: coarse)").matches) dialog.focus();
    return () => dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the dimmed backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-0 mt-auto outline-none max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40",
        "sm:m-auto sm:max-h-[85dvh] sm:max-w-lg sm:rounded-2xl",
        className,
      )}
    >
      {children}
    </dialog>
  );
}

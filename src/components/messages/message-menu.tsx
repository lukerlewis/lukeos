"use client";

import { Copy, Pencil, Reply, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type MenuAnchor = { id: string; rect: { top: number; bottom: number; left: number; right: number } };

const MENU_W = 180;
const GAP = 6;
/** Room kept clear at the bottom for the phone tab bar and the message box. */
const BOTTOM_ROOM = 140;

/** The space a message's bubble, photos and link card take up on screen. */
export function messageRect(el: HTMLElement): MenuAnchor["rect"] {
  const parts = [...el.children].filter((c) => !(c as HTMLElement).dataset.menuIgnore).map((c) => c.getBoundingClientRect());
  if (!parts.length) return el.getBoundingClientRect();
  return {
    top: Math.min(...parts.map((r) => r.top)),
    bottom: Math.max(...parts.map((r) => r.bottom)),
    left: Math.min(...parts.map((r) => r.left)),
    right: Math.max(...parts.map((r) => r.right)),
  };
}

/**
 * The small menu for a message: Reply and Copy on any, plus Edit and Unsend
 * on Luke's own. Opens from a press and hold on a phone, or the ⋯ button or a
 * right-click on a computer, lined up under the message (or above it near the
 * bottom), on the side the message sits.
 */
export function MessageMenu({
  anchor,
  mine,
  canEdit,
  canCopy,
  onReply,
  onEdit,
  onCopy,
  onUnsend,
  onClose,
}: {
  anchor: MenuAnchor;
  /** Luke's message: on the right, and can be edited and unsent. */
  mine: boolean;
  canEdit: boolean;
  canCopy: boolean;
  onReply: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onUnsend: () => void;
  onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const { rect } = anchor;
  const side = mine
    ? { right: Math.max(12, window.innerWidth - rect.right) }
    : { left: Math.min(Math.max(12, rect.left), window.innerWidth - MENU_W - 12) };
  const below = rect.bottom + GAP + 150 < window.innerHeight - BOTTOM_ROOM || rect.top < 200;
  const place = below ? { top: rect.bottom + GAP } : { bottom: window.innerHeight - rect.top + GAP };

  const item = "press-tint flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] md:py-2 md:text-sm";
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div className="fixed inset-0 z-40" onPointerDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => e.preventDefault()}>
      <div
        role="menu"
        aria-label="Message"
        style={{ ...side, width: MENU_W, ...place }}
        className={cn(
          "motion-pop fixed flex flex-col rounded-xl border bg-card p-1 shadow-lg",
          below ? (mine ? "origin-top-right" : "origin-top-left") : mine ? "origin-bottom-right" : "origin-bottom-left",
        )}
      >
        <button ref={first} type="button" role="menuitem" className={item} onClick={run(onReply)}>
          Reply
          <Reply className="size-4 text-muted-foreground" aria-hidden />
        </button>
        {mine && canEdit && (
          <button type="button" role="menuitem" className={item} onClick={run(onEdit)}>
            Edit
            <Pencil className="size-4 text-muted-foreground" aria-hidden />
          </button>
        )}
        {canCopy && (
          <button type="button" role="menuitem" className={item} onClick={run(onCopy)}>
            Copy
            <Copy className="size-4 text-muted-foreground" aria-hidden />
          </button>
        )}
        {mine && (
          <button type="button" role="menuitem" className={cn(item, "text-danger")} onClick={run(onUnsend)}>
            Unsend
            <Undo2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

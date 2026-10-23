"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type CellOption<T extends string> = { value: T | null; label: React.ReactNode };

/**
 * A table cell you click to pick its value from a small menu, like a Notion property.
 * The menu floats over the page, so a card's rounded edge doesn't cut it off.
 * It opens below the cell, or above it when there's more room there, and
 * scrolls if it's still taller than the space it has.
 */
export function CellMenu<T extends string>({
  label,
  value,
  options,
  onPick,
  children,
  className,
}: {
  /** What the cell is, e.g. "Focus type", for screen readers. */
  label: string;
  value: T | null;
  options: CellOption<T>[];
  onPick: (value: T | null) => void;
  /** What the cell shows. Empty shows a faint plus on hover. */
  children?: React.ReactNode;
  className?: string;
}) {
  const [at, setAt] = useState<{ top: number; left: number; up: boolean; maxHeight?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Once the menu is drawn, measure it and keep it on screen.
  useLayoutEffect(() => {
    if (!at || at.maxHeight !== undefined || !menu.current || !button.current) return;
    setAt(place(button.current.getBoundingClientRect(), menu.current));
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const click = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  function toggle() {
    if (at) return setAt(null);
    const r = button.current!.getBoundingClientRect();
    setAt({ top: r.bottom + GAP, left: r.left, up: false });
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={toggle}
        className={cn("group flex h-full w-full min-w-0 items-center px-2 text-left hover:bg-muted/60", at && "bg-muted/60", className)}
      >
        {children ?? <Plus className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden />}
      </button>
      {at &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={label}
            style={{ top: at.top, left: at.left, maxHeight: at.maxHeight, visibility: at.maxHeight === undefined ? "hidden" : undefined }}
            className={cn(
              "motion-pop fixed z-50 flex min-w-44 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl border border-stroke bg-card p-1",
              at.up ? "origin-bottom-left" : "origin-top-left",
            )}
          >
            {options.map((o) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value ?? "none"}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => {
                    setAt(null);
                    if (!on) onPick(o.value);
                  }}
                  className={cn(
                    "press-tint flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-preview hover:bg-muted",
                    on && "bg-selected font-medium text-ink hover:bg-selected",
                  )}
                >
                  <span className="flex min-w-0 grow items-center">{o.label}</span>
                  {on && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

const GAP = 4;
/** Space kept clear between the menu and the screen's edge. */
const EDGE = 8;

/** Where the menu goes: below the cell if it fits, otherwise on whichever side has more room. */
function place(cell: DOMRect, el: HTMLElement) {
  const vv = window.visualViewport;
  const screenH = vv?.height ?? window.innerHeight;
  const screenW = vv?.width ?? window.innerWidth;
  const top0 = vv?.offsetTop ?? 0;
  const left0 = vv?.offsetLeft ?? 0;
  const h = el.offsetHeight;
  const w = el.offsetWidth;
  const below = top0 + screenH - cell.bottom - GAP - EDGE;
  const above = cell.top - top0 - GAP - EDGE;
  const up = h > below && above > below;
  const maxHeight = Math.max(0, Math.min(h, up ? above : below));
  const top = up ? cell.top - GAP - maxHeight : cell.bottom + GAP;
  const left = Math.max(left0 + EDGE, Math.min(cell.left, left0 + screenW - w - EDGE));
  return { top, left, up, maxHeight };
}

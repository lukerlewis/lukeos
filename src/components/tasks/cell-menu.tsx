"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type CellOption<T extends string> = { value: T | null; label: React.ReactNode };

/**
 * A table cell you click to pick its value from a small menu, like a Notion property.
 * The menu floats over the page, so a card's rounded edge doesn't cut it off.
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
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

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
    setAt({ top: r.bottom + 4, left: r.left });
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
            style={{ top: at.top, left: at.left }}
            className="motion-pop fixed z-50 flex min-w-44 origin-top-left flex-col gap-0.5 rounded-xl border border-stroke bg-card p-1"
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
                    "press-tint flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-preview hover:bg-muted",
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

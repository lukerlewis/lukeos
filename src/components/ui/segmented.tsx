"use client";

import { cn } from "@/lib/utils";

/** A row of choices where exactly one is picked, like iOS's segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; title?: string; className?: string }[];
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("seg-track flex gap-0.5 rounded-lg p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-9 grow items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-preview font-medium text-muted-foreground",
            value === o.value && "seg-on text-foreground",
            o.className,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

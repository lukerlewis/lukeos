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
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("flex gap-0.5 rounded-[10px] bg-muted p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 grow rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground",
            value === o.value && "bg-card text-foreground shadow-xs dark:bg-background",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

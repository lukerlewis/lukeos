"use client";

import { useState } from "react";
import { duration } from "@/lib/focus";
import { cn } from "@/lib/utils";

const HOUR = 3600;
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const long = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Hours focused per day as bars. Tap or point at a bar to see that day; today
 * is picked to start with.
 */
export function FocusChart({ days, today }: { days: { date: string; seconds: number }[]; today: string }) {
  const [picked, setPicked] = useState(days.length - 1);
  const top = Math.max(1, Math.ceil(Math.max(...days.map((d) => d.seconds)) / HOUR)); // whole hours, at least 1
  const step = top <= 4 ? 1 : Math.ceil(top / 4);
  const lines = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step).filter((h) => h <= top);
  const many = days.length > 7;
  const shown = days[picked];

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex h-10 flex-col">
        <span className="text-meta text-muted-foreground">{shown.date === today ? "Today" : long.format(asDate(shown.date))}</span>
        <span className="text-control font-medium text-ink tabular-nums">{duration(shown.seconds)}</span>
      </figcaption>

      <div className="relative flex h-52 pl-8">
        {/* Hour lines, quiet, with their labels on the left. */}
        {lines.map((h) => (
          <div key={h} className="absolute inset-x-0 flex h-0 items-center" style={{ bottom: `${(h / top) * 100}%` }} aria-hidden>
            <span className="w-8 pr-2 text-right text-tag text-muted-foreground tabular-nums">{h}h</span>
            <span className={cn("grow border-t", h === 0 ? "border-stroke" : "border-dashed border-border")} />
          </div>
        ))}
        <ul className={cn("relative flex grow items-end", many ? "gap-[3px]" : "gap-2 md:gap-4")}>
          {days.map((d, i) => (
            <li key={d.date} className="flex h-full grow basis-0 items-end">
              <button
                type="button"
                aria-label={`${long.format(asDate(d.date))}: ${duration(d.seconds)}`}
                aria-pressed={i === picked}
                onClick={() => setPicked(i)}
                onPointerEnter={(e) => e.pointerType === "mouse" && setPicked(i)}
                className="flex h-full w-full items-end active:scale-100"
              >
                <span
                  className={cn(
                    "w-full rounded-t-[4px] transition-colors",
                    i === picked ? "bg-foreground" : "bg-grey-400",
                    d.seconds === 0 && "bg-transparent",
                  )}
                  style={{ height: d.seconds ? `max(3px, ${(d.seconds / (top * HOUR)) * 100}%)` : 0 }}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={cn("flex pl-8", many ? "gap-[3px]" : "gap-2 md:gap-4")} aria-hidden>
        {days.map((d, i) => (
          <span key={d.date} className="grow basis-0 text-center text-tag whitespace-nowrap text-muted-foreground">
            {many
              ? i % 7 === (days.length - 1) % 7
                ? dayMonth.format(asDate(d.date))
                : ""
              : weekday.format(asDate(d.date))}
          </span>
        ))}
      </div>
    </figure>
  );
}

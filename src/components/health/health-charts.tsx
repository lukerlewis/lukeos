"use client";

import { cn } from "@/lib/utils";

const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const longDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
export const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** A bar's parts, darkest first, stacked from the bottom. One part is a plain bar. */
export type Bar = { date: string; parts: number[]; label: string };

const shades = ["bg-foreground", "bg-grey-500", "bg-grey-300", "bg-grey-200"];
const shadesQuiet = ["bg-grey-600", "bg-grey-400", "bg-grey-300", "bg-grey-200"];

/** A nice round top for the scale: 1, 2, 2.5, 5 × 10ⁿ. */
function niceTop(max: number) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= max) ?? 10 * p);
}

/**
 * Days as bars, like Focus stats. Tap or point at a bar to pick that day.
 * `tick` labels the scale lines (e.g. 8h, 10k).
 */
export function BarChart({
  bars,
  picked,
  onPick,
  tick,
  top: fixedTop,
  goal,
}: {
  bars: Bar[];
  picked: number;
  onPick: (index: number) => void;
  tick: (value: number) => string;
  top?: number;
  /** A dashed line to beat, e.g. 10,000 steps. */
  goal?: number;
}) {
  const totals = bars.map((b) => b.parts.reduce((a, c) => a + c, 0));
  const top = fixedTop ?? niceTop(Math.max(...totals, goal ?? 0));
  const lines = [0, top / 2, top];
  const many = bars.length > 7;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex h-40 pl-9">
        {lines.map((v) => (
          <div key={v} className="absolute inset-x-0 flex h-0 items-center" style={{ bottom: `${(v / top) * 100}%` }} aria-hidden>
            <span className="w-9 pr-2 text-right text-tag text-muted-foreground tabular-nums">{tick(v)}</span>
            <span className={cn("grow border-t", v === 0 ? "border-stroke" : "border-dashed border-border")} />
          </div>
        ))}
        {goal !== undefined && goal < top && (
          <div className="absolute right-0 left-9 h-0 border-t border-dashed border-grey-500" style={{ bottom: `${(goal / top) * 100}%` }} aria-hidden />
        )}
        <ul className={cn("relative flex grow items-end", many ? "gap-[3px]" : "gap-2 md:gap-4")}>
          {bars.map((b, i) => {
            const total = totals[i];
            const on = i === picked;
            return (
              <li key={b.date} className="flex h-full grow basis-0 items-end">
                <button
                  type="button"
                  aria-label={`${longDay.format(asDate(b.date))}: ${b.label}`}
                  aria-pressed={on}
                  onClick={() => onPick(i)}
                  onPointerEnter={(e) => e.pointerType === "mouse" && onPick(i)}
                  className="flex h-full w-full flex-col justify-end active:scale-100"
                >
                  {total > 0 && (
                    <span className="flex w-full flex-col-reverse overflow-hidden rounded-t-[4px]" style={{ height: `max(3px, ${(Math.min(total, top) / top) * 100}%)` }}>
                      {b.parts.map((p, j) =>
                        p > 0 ? <span key={j} className={cn("w-full transition-colors", on ? shades[j] : b.parts.length === 1 ? "bg-grey-400" : shadesQuiet[j])} style={{ height: `${(p / total) * 100}%` }} /> : null,
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <DayLabels dates={bars.map((b) => b.date)} />
    </div>
  );
}

function DayLabels({ dates }: { dates: string[] }) {
  const many = dates.length > 7;
  return (
    <div className={cn("flex pl-9", many ? "gap-[3px]" : "gap-2 md:gap-4")} aria-hidden>
      {dates.map((d, i) => (
        <span key={d} className="grow basis-0 text-center text-tag whitespace-nowrap text-muted-foreground">
          {many ? (i % 7 === (dates.length - 1) % 7 ? dayMonth.format(asDate(d)) : "") : weekday.format(asDate(d))}
        </span>
      ))}
    </div>
  );
}

/** Days as a line with dots (resting heart rate, HRV). Gaps where nothing was recorded. */
export function LineChart({
  points,
  picked,
  onPick,
  format,
}: {
  points: { date: string; value: number | null }[];
  picked: number;
  onPick: (index: number) => void;
  format: (value: number) => string;
}) {
  const known = points.map((p) => p.value).filter((v): v is number => v !== null);
  const lo = known.length ? Math.floor(Math.min(...known) - 2) : 0;
  const hi = known.length ? Math.ceil(Math.max(...known) + 2) : 1;
  const span = Math.max(1, hi - lo);
  const n = points.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => 100 - ((v - lo) / span) * 100;

  // Runs of consecutive known days, each drawn as one line.
  const runs: { i: number; v: number }[][] = [];
  points.forEach((p, i) => {
    if (p.value === null) return;
    const last = runs.at(-1);
    if (last && last.at(-1)!.i === i - 1) last.push({ i, v: p.value });
    else runs.push([{ i, v: p.value }]);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-32 pl-9">
        {[hi, lo].map((v, k) => (
          <div key={k} className="absolute inset-x-0 flex h-0 items-center" style={{ top: k === 0 ? 0 : "100%" }} aria-hidden>
            <span className="w-9 pr-2 text-right text-tag text-muted-foreground tabular-nums">{format(v)}</span>
            <span className={cn("grow border-t", k === 1 ? "border-stroke" : "border-dashed border-border")} />
          </div>
        ))}
        <div className="relative h-full">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {runs.map((run, k) => (
              <polyline key={k} points={run.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} fill="none" className="stroke-grey-500" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {points.map((p, i) =>
            p.value === null ? null : (
              <span
                key={p.date}
                className={cn("absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full", i === picked ? "size-2.5 bg-foreground" : "bg-grey-500")}
                style={{ left: `${x(i)}%`, top: `${y(p.value)}%` }}
                aria-hidden
              />
            ),
          )}
          <div className="absolute inset-0 flex">
            {points.map((p, i) => (
              <button
                key={p.date}
                type="button"
                aria-label={`${longDay.format(asDate(p.date))}: ${p.value === null ? "nothing recorded" : format(p.value)}`}
                aria-pressed={i === picked}
                onClick={() => onPick(i)}
                onPointerEnter={(e) => e.pointerType === "mouse" && onPick(i)}
                className="h-full grow basis-0 active:scale-100"
              />
            ))}
          </div>
        </div>
      </div>
      <DayLabels dates={points.map((p) => p.date)} />
    </div>
  );
}

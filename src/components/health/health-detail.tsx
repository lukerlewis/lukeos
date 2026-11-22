"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { averageOf, hoursMinutes, thousands, type HealthDay } from "@/lib/health";
import { sectionById, sectionHref } from "@/lib/health-sections";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { asDate, BarChart, LineChart, longDay, type Bar } from "./health-charts";

type DayDetail = {
  stepsByHour: (number | null)[];
  heartRate: { time: string; bpm: number; min: number; max: number }[];
  sleepStages: { stage: string; start: string; end: string }[];
};

const shortDay = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** One number over the range, its stats, the picked day's within-the-day detail, and every day as a list. */
export function HealthDetail({ sectionId, days, today, timeZone, initialDate, range }: { sectionId: string; days: HealthDay[]; today: string; timeZone: string; initialDate?: string; range: number }) {
  const section = sectionById(sectionId)!;
  const router = useRouter();
  const values = days.map(section.value);
  const [picked, setPicked] = useState(() => {
    const asked = initialDate ? days.findIndex((d) => d.date === initialDate) : -1;
    if (asked !== -1) return asked;
    const last = values.findLastIndex((v) => v !== null);
    return last === -1 ? days.length - 1 : last;
  });
  const day = days[picked];
  const value = values[picked];

  // Keep the picked day in the address, so going back (or sharing) lands on it.
  useEffect(() => {
    router.replace(sectionHref(sectionId, day.date, range), { scroll: false });
  }, [day.date, sectionId, range, router]);

  const known = values.filter((v): v is number => v !== null);
  const stats: [string, string][] = known.length
    ? [
        ["Average", section.format(averageOf(known)!)],
        ["Lowest", section.format(Math.min(...known))],
        ["Highest", section.format(Math.max(...known))],
        ...(section.total ? ([["Total", section.format(known.reduce((a, b) => a + b, 0))]] as [string, string][]) : []),
      ]
    : [];

  const bars: Bar[] = days.map((d, i) => {
    const v = values[i];
    const s = d.sleep;
    const staged = section.id === "sleep" && s && s.deepMinutes !== null;
    return {
      date: d.date,
      parts: v === null || v === 0 ? [] : staged ? [s.deepMinutes ?? 0, s.remMinutes ?? 0, s.lightMinutes ?? 0] : [v],
      label: v === null ? "nothing recorded" : section.format(v),
    };
  });

  return (
    <>
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-col">
          <span className="text-meta text-muted-foreground">{day.date === today ? "Today" : longDay.format(asDate(day.date))}</span>
          <span className="text-heading font-medium text-ink tabular-nums">{value === null ? "—" : section.format(value)}</span>
        </div>
        {section.chart === "bar" ? (
          <BarChart
            bars={bars}
            picked={picked}
            onPick={setPicked}
            tick={section.tick ?? String}
            goal={section.goal}
            top={section.id === "sleep" ? Math.max(600, ...bars.map((b) => b.parts.reduce((a, c) => a + c, 0))) : undefined}
          />
        ) : (
          <LineChart points={days.map((d, i) => ({ date: d.date, value: values[i] }))} picked={picked} onPick={setPicked} format={(v) => (section.id === "skin-temperature" ? section.format(v) : String(Math.round(v * 10) / 10))} />
        )}
      </Card>

      {stats.length > 0 && (
        <div className={cn("grid gap-3", stats.length === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3")}>
          {stats.map(([label, v]) => (
            <Card key={label} className="flex flex-col gap-1 px-4 py-3">
              <span className="text-meta text-muted-foreground">{label}</span>
              <span className="text-control font-medium tabular-nums">{v}</span>
            </Card>
          ))}
        </div>
      )}

      {section.day && <DayCard kind={section.day} day={day} timeZone={timeZone} />}

      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-meta text-muted-foreground">By day</h2>
        <Card>
          <ul className="divide-y divide-border">
            {days
              .map((d, i) => ({ d, i }))
              .reverse()
              .map(({ d, i }) => (
                <li key={d.date}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(i);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className={cn("flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left active:scale-100", i === picked && "bg-muted")}
                  >
                    <span className="grow text-control">{d.date === today ? "Today" : shortDay.format(asDate(d.date))}</span>
                    <span className={cn("text-control tabular-nums", values[i] === null ? "text-muted-foreground" : "font-medium")}>{values[i] === null ? "—" : section.format(values[i]!)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </Card>
      </section>
    </>
  );
}

/* ---------- The picked day, within the day ---------- */

const cache = new Map<string, Promise<DayDetail>>();
const loadDay = (date: string) => {
  if (!cache.has(date)) cache.set(date, op("get_health_day", { date }).catch((err) => (cache.delete(date), Promise.reject(err))) as Promise<DayDetail>);
  return cache.get(date)!;
};

function DayCard({ kind, day, timeZone }: { kind: "sleep" | "steps" | "heart"; day: HealthDay; timeZone: string }) {
  const [state, setState] = useState<{ date: string; detail: DayDetail | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadDay(day.date).then(
      (detail) => live && setState({ date: day.date, detail, error: null }),
      (err: Error) => live && setState({ date: day.date, detail: null, error: err.message }),
    );
    return () => {
      live = false;
    };
  }, [day.date]);
  const ready = state?.date === day.date ? state : null;
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

  const title = kind === "sleep" ? "The night" : kind === "steps" ? "Through the day" : "Heart rate through the day";
  return (
    <Card className="flex flex-col gap-4 p-4">
      <span className="text-meta text-muted-foreground">{title}</span>
      {!ready ? (
        <div className="h-36 animate-pulse rounded-lg bg-muted" aria-label="Loading" />
      ) : ready.error ? (
        <span className="text-control text-muted-foreground">{ready.error}</span>
      ) : kind === "steps" ? (
        <HourBars values={ready.detail!.stepsByHour} />
      ) : kind === "heart" ? (
        <HeartDay points={ready.detail!.heartRate} timeZone={timeZone} />
      ) : (
        <SleepNight day={day} stages={ready.detail!.sleepStages} time={time} />
      )}
    </Card>
  );
}

const hourLabel = (h: number) => (h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`);

function HourBars({ values }: { values: (number | null)[] }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const total = values.reduce<number>((a, v) => a + (v ?? 0), 0);
  const busiest = values.indexOf(Math.max(...values.map((v) => v ?? 0)));
  if (!total) return <span className="text-control text-muted-foreground">No steps recorded.</span>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-32 items-end gap-[3px]">
        {values.map((v, h) => (
          <span key={h} className="flex h-full grow basis-0 items-end" title={`${hourLabel(h)}: ${v ? thousands(v) : 0} steps`}>
            {v ? <span className={cn("w-full rounded-t-[3px]", h === busiest ? "bg-foreground" : "bg-grey-400")} style={{ height: `max(3px, ${(v / max) * 100}%)` }} /> : null}
          </span>
        ))}
      </div>
      <HourAxis />
      <span className="text-meta text-muted-foreground">
        Busiest hour {hourLabel(busiest)} to {hourLabel((busiest + 1) % 24)}, {thousands(values[busiest] ?? 0)} steps
      </span>
    </div>
  );
}

function HourAxis() {
  return (
    <div className="relative h-4 text-tag text-muted-foreground" aria-hidden>
      {[0, 6, 12, 18].map((h) => (
        <span key={h} className="absolute" style={{ left: `${(h / 24) * 100}%` }}>
          {hourLabel(h)}
        </span>
      ))}
    </div>
  );
}

/** Minutes since local midnight for a moment, in Luke's time zone. */
function minuteOfDay(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function HeartDay({ points, timeZone }: { points: DayDetail["heartRate"]; timeZone: string }) {
  if (!points.length) return <span className="text-control text-muted-foreground">No heart rate recorded.</span>;
  const lo = Math.floor(Math.min(...points.map((p) => p.min)) / 10) * 10;
  const hi = Math.ceil(Math.max(...points.map((p) => p.max)) / 10) * 10;
  const span = Math.max(1, hi - lo);
  const xs = points.map((p) => (minuteOfDay(p.time, timeZone) / 1440) * 100);
  const y = (v: number) => 100 - ((v - lo) / span) * 100;
  // Break the line where the watch was off for more than 20 minutes.
  const runs: number[][] = [];
  points.forEach((_, i) => {
    if (i && xs[i] - xs[i - 1] <= (20 / 1440) * 100 && xs[i] >= xs[i - 1]) runs.at(-1)!.push(i);
    else runs.push([i]);
  });
  const lowest = points.reduce((a, b) => (b.min < a.min ? b : a));
  const highest = points.reduce((a, b) => (b.max > a.max ? b : a));
  const at = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-36 pl-9">
        {[hi, lo].map((v, k) => (
          <div key={k} className="absolute inset-x-0 flex h-0 items-center" style={{ top: k === 0 ? 0 : "100%" }} aria-hidden>
            <span className="w-9 pr-2 text-right text-tag text-muted-foreground tabular-nums">{v}</span>
            <span className={cn("grow border-t", k === 1 ? "border-stroke" : "border-dashed border-border")} />
          </div>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="relative size-full overflow-visible" aria-label={`Heart rate from ${lowest.min} to ${highest.max} bpm`}>
          {runs.map((run, k) => (
            <g key={k}>
              <polygon
                points={[...run.map((i) => `${xs[i]},${y(points[i].max)}`), ...[...run].reverse().map((i) => `${xs[i]},${y(points[i].min)}`)].join(" ")}
                className="fill-grey-200 dark:fill-grey-700"
              />
              <polyline points={run.map((i) => `${xs[i]},${y(points[i].bpm)}`).join(" ")} fill="none" className="stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
      </div>
      <div className="pl-9">
        <HourAxis />
      </div>
      <span className="text-meta text-muted-foreground tabular-nums">
        Lowest {lowest.min} bpm at {at.format(new Date(lowest.time))} · Highest {highest.max} bpm at {at.format(new Date(highest.time))}
      </span>
    </div>
  );
}

const stageOrder = ["AWAKE", "RESTLESS", "REM", "LIGHT", "ASLEEP", "DEEP"];
const stageName: Record<string, string> = { AWAKE: "Awake", RESTLESS: "Restless", REM: "REM", LIGHT: "Light", ASLEEP: "Asleep", DEEP: "Deep" };
const stageShade: Record<string, string> = { AWAKE: "bg-grey-300", RESTLESS: "bg-grey-300", REM: "bg-grey-500", LIGHT: "bg-grey-400", ASLEEP: "bg-grey-500", DEEP: "bg-foreground" };

function SleepNight({ day, stages, time }: { day: HealthDay; stages: DayDetail["sleepStages"]; time: Intl.DateTimeFormat }) {
  const s = day.sleep;
  if (!s) return <span className="text-control text-muted-foreground">No sleep recorded for this night.</span>;
  const start = Date.parse(stages[0]?.start ?? s.start);
  const end = Date.parse(stages.at(-1)?.end ?? s.end);
  const total = Math.max(1, end - start);
  const rows = stageOrder.filter((st) => stages.some((x) => x.stage === st));
  const minutes = new Map<string, number>();
  for (const x of stages) minutes.set(x.stage, (minutes.get(x.stage) ?? 0) + (Date.parse(x.end) - Date.parse(x.start)) / 60_000);
  const inBed = [...minutes.values()].reduce((a, b) => a + b, 0) || s.minutes + (s.awakeMinutes ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Fact label="Asleep" value={hoursMinutes(s.minutes)} />
        <Fact label="Fell asleep" value={time.format(new Date(s.start))} />
        <Fact label="Woke up" value={time.format(new Date(s.end))} />
      </div>
      {rows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {rows.map((st) => (
            <div key={st} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-tag text-muted-foreground">{stageName[st] ?? st}</span>
              <div className="relative h-5 grow rounded-[3px] bg-muted">
                {stages
                  .filter((x) => x.stage === st)
                  .map((x) => (
                    <span
                      key={x.start}
                      className={cn("absolute inset-y-0 rounded-[2px]", stageShade[st] ?? "bg-grey-400")}
                      style={{ left: `${((Date.parse(x.start) - start) / total) * 100}%`, width: `max(1px, ${((Date.parse(x.end) - Date.parse(x.start)) / total) * 100}%)` }}
                    />
                  ))}
              </div>
            </div>
          ))}
          <div className="flex justify-between pl-16 text-tag text-muted-foreground tabular-nums">
            <span>{time.format(new Date(start))}</span>
            <span>{time.format(new Date(end))}</span>
          </div>
        </div>
      )}
      {minutes.size > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((st) => (
            <li key={st} className="flex min-h-11 items-center gap-3">
              <span className={cn("size-2.5 shrink-0 rounded-[3px]", stageShade[st])} aria-hidden />
              <span className="grow text-control">{stageName[st] ?? st}</span>
              <span className="text-meta text-muted-foreground tabular-nums">{Math.round(((minutes.get(st) ?? 0) / inBed) * 100)}%</span>
              <span className="w-16 text-right text-control font-medium tabular-nums">{hoursMinutes(minutes.get(st) ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className="text-control font-medium tabular-nums">{value}</span>
    </div>
  );
}

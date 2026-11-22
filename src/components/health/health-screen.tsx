"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { averageOf, hoursMinutes, km, thousands, workoutLabel, type HealthDay } from "@/lib/health";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { asDate, BarChart, LineChart, longDay, type Bar } from "./health-charts";

/** Fetch a fresh copy on open when the last one is older than this. */
const STALE_MS = 20 * 60_000;

function ago(iso: string | null, now: number) {
  if (!iso) return "Not synced yet";
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "Updated just now";
  if (min < 60) return `Updated ${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `Updated ${h}h ago` : `Updated ${Math.round(h / 24)}d ago`;
}

/**
 * Luke's Fitbit numbers. Every chart picks the same day, and the tiles above show it.
 */
export function HealthScreen({ days, today, timeZone, lastSyncAt, lastError }: { days: HealthDay[]; today: string; timeZone: string; lastSyncAt: string | null; lastError: string | null }) {
  const router = useRouter();
  // Start on the latest day with anything recorded (early in the day, today can still be empty).
  const [picked, setPicked] = useState(() => {
    const i = days.findLastIndex((d) => d.sleep || d.steps || d.restingHeartRate);
    return i === -1 ? days.length - 1 : i;
  });
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const day = days[picked] ?? days.at(-1)!;

  async function sync(quiet = false) {
    setSyncing(true);
    try {
      await op("sync_health", { days: 3 });
      router.refresh();
    } catch (err) {
      if (!quiet) showToast((err as Error).message);
    } finally {
      setSyncing(false);
      setNow(Date.now());
    }
  }

  useEffect(() => {
    const stale = !lastSyncAt || Date.now() - Date.parse(lastSyncAt) > STALE_MS;
    const first = stale ? setTimeout(() => void sync(true), 0) : undefined;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sleepBars: Bar[] = days.map((d) => {
    const s = d.sleep;
    const staged = s && s.deepMinutes !== null;
    return {
      date: d.date,
      parts: !s ? [] : staged ? [s.deepMinutes ?? 0, s.remMinutes ?? 0, s.lightMinutes ?? 0] : [s.minutes],
      label: s ? hoursMinutes(s.minutes) : "no sleep recorded",
    };
  });
  const stepBars: Bar[] = days.map((d) => ({ date: d.date, parts: d.steps ? [d.steps] : [], label: d.steps === null ? "nothing recorded" : `${thousands(d.steps)} steps` }));
  const azmBars: Bar[] = days.map((d) => ({ date: d.date, parts: d.activeMinutes ? [d.activeMinutes] : [], label: d.activeMinutes === null ? "nothing recorded" : `${d.activeMinutes} active zone minutes` }));
  const shortDay = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const workouts = days.flatMap((d) => d.workouts.map((w) => ({ ...w, date: d.date }))).reverse();
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const dayName = day.date === today ? "Today" : longDay.format(asDate(day.date));

  return (
    <>
      <div className="-mt-2 flex items-center justify-between gap-3">
        <span className={cn("text-meta", lastError ? "text-danger" : "text-muted-foreground")}>{lastError && !syncing ? lastError : syncing ? "Updating…" : ago(lastSyncAt, now)}</span>
        <Button variant="ghost" size="sm" onClick={() => sync()} disabled={syncing} aria-label="Update now">
          <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden />
          Update
        </Button>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-meta text-muted-foreground">{dayName}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Sleep" value={day.sleep ? hoursMinutes(day.sleep.minutes) : null} />
          <Tile label="Steps" value={day.steps === null ? null : thousands(day.steps)} />
          <Tile label="Resting heart rate" value={day.restingHeartRate === null ? null : `${day.restingHeartRate} bpm`} />
          <Tile label="Active zone minutes" value={day.activeMinutes === null ? null : String(day.activeMinutes)} />
        </div>
      </section>

      <ChartCard
        title="Sleep"
        value={day.sleep ? hoursMinutes(day.sleep.minutes) : "—"}
        note={day.sleep ? `${time.format(new Date(day.sleep.start))} to ${time.format(new Date(day.sleep.end))}` : undefined}
        legend={day.sleep && day.sleep.deepMinutes !== null ? [["Deep", day.sleep.deepMinutes], ["REM", day.sleep.remMinutes], ["Light", day.sleep.lightMinutes], ["Awake", day.sleep.awakeMinutes]] : undefined}
      >
        <BarChart bars={sleepBars} picked={picked} onPick={setPicked} tick={(v) => `${Math.round(v / 60)}h`} top={Math.max(600, ...sleepBars.map((b) => b.parts.reduce((a, c) => a + c, 0)))} />
      </ChartCard>

      <ChartCard title="Steps" value={day.steps === null ? "—" : thousands(day.steps)} note={day.distanceMeters ? km(day.distanceMeters) : undefined} average={averageOf(days.map((d) => d.steps))} format={thousands}>
        <BarChart bars={stepBars} picked={picked} onPick={setPicked} tick={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} goal={10_000} />
      </ChartCard>

      <ChartCard title="Resting heart rate" value={day.restingHeartRate === null ? "—" : `${day.restingHeartRate} bpm`} average={averageOf(days.map((d) => d.restingHeartRate))} format={(v) => `${Math.round(v)} bpm`}>
        <LineChart points={days.map((d) => ({ date: d.date, value: d.restingHeartRate }))} picked={picked} onPick={setPicked} format={(v) => String(Math.round(v))} />
      </ChartCard>

      <ChartCard title="Heart rate variability" value={day.hrvMs === null ? "—" : `${Math.round(day.hrvMs)} ms`} average={averageOf(days.map((d) => d.hrvMs))} format={(v) => `${Math.round(v)} ms`}>
        <LineChart points={days.map((d) => ({ date: d.date, value: d.hrvMs }))} picked={picked} onPick={setPicked} format={(v) => String(Math.round(v))} />
      </ChartCard>

      <ChartCard title="Active zone minutes" value={day.activeMinutes === null ? "—" : String(day.activeMinutes)} note={day.caloriesOut ? `${thousands(day.caloriesOut)} cal burned` : undefined} average={averageOf(days.map((d) => d.activeMinutes))} format={(v) => String(Math.round(v))}>
        <BarChart bars={azmBars} picked={picked} onPick={setPicked} tick={(v) => String(Math.round(v))} />
      </ChartCard>

      <Card>
        <ul className="divide-y divide-border">
          <Row label="Breathing rate" value={day.breathingRate === null ? null : `${day.breathingRate} /min`} average={averageOf(days.map((d) => d.breathingRate))} format={(v) => `${v.toFixed(1)}`} />
          <Row label="Blood oxygen" value={day.spo2 === null ? null : `${day.spo2}%`} average={averageOf(days.map((d) => d.spo2))} format={(v) => `${v.toFixed(1)}%`} />
          <Row label="Skin temperature" value={day.skinTempDeviation === null ? null : `${day.skinTempDeviation > 0 ? "+" : ""}${day.skinTempDeviation.toFixed(1)}°C`} />
          <Row label="Cardio fitness (VO₂ max)" value={day.vo2Max === null ? null : String(day.vo2Max)} average={averageOf(days.map((d) => d.vo2Max))} format={(v) => v.toFixed(1)} />
        </ul>
      </Card>

      {workouts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-meta text-muted-foreground">Workouts</h2>
          <Card>
            <ul className="divide-y divide-border">
              {workouts.map((w) => (
                <li key={`${w.startedAt}-${w.type}`} className="flex min-h-14 items-center gap-3 px-4 py-3">
                  <span className="flex grow flex-col">
                    <span className="text-control font-medium">{workoutLabel(w)}</span>
                    <span className="text-meta text-muted-foreground">
                      {w.date === today ? "Today" : shortDay.format(asDate(w.date))} · {time.format(new Date(w.startedAt))}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-meta whitespace-nowrap text-muted-foreground tabular-nums">
                    {[`${w.minutes} min`, w.distanceMeters ? km(w.distanceMeters) : null, w.calories ? `${w.calories} cal` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string | null }) {
  return (
    <Card className="flex flex-col gap-1 px-4 py-3">
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className={cn("text-heading font-medium tabular-nums", value === null ? "text-muted-foreground" : "text-ink")}>{value ?? "—"}</span>
    </Card>
  );
}

function ChartCard({
  title,
  value,
  note,
  average,
  format,
  legend,
  children,
}: {
  title: string;
  value: string;
  note?: string;
  average?: number | null;
  format?: (v: number) => string;
  legend?: [string, number | null][];
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 px-4 pt-4 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-meta text-muted-foreground">{title}</span>
          <span className="text-control font-medium text-ink tabular-nums">
            {value}
            {note && <span className="ml-2 font-normal text-muted-foreground">{note}</span>}
          </span>
        </div>
        {average != null && format && <span className="text-meta text-muted-foreground tabular-nums">Avg {format(average)}</span>}
      </div>
      {children}
      {legend && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">
          {legend.map(([name, minutes], i) => (
            <li key={name} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[3px]", ["bg-foreground", "bg-grey-500", "bg-grey-300", "border border-grey-400"][i])} aria-hidden />
              {name} <span className="text-foreground tabular-nums">{minutes === null ? "—" : hoursMinutes(minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Row({ label, value, average, format }: { label: string; value: string | null; average?: number | null; format?: (v: number) => string }) {
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-3">
      <span className="grow text-control">{label}</span>
      {average != null && format && <span className="text-meta text-muted-foreground tabular-nums">Avg {format(average)}</span>}
      <span className={cn("w-20 text-right text-control font-medium tabular-nums", value === null && "text-muted-foreground")}>{value ?? "—"}</span>
    </li>
  );
}

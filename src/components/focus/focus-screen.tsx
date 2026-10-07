"use client";

import { AudioLines, ChartColumn, ChevronRight, Pause, Play, RotateCcw, SkipForward, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { clock, FOCUS_LIMITS, type FocusSettings } from "@/lib/focus";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { phaseLabel, useFocus } from "./focus-provider";

const HOUR = 3_600_000;

export function FocusScreen() {
  const focus = useFocus();
  if (!focus) return null;
  const { mode, setMode, pomodoro, stopwatch, settings } = focus;
  const onBreak = pomodoro.phase !== "focus";

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-8 md:mx-auto">
      <Segmented
        value={mode}
        onChange={setMode}
        className="w-full"
        options={[
          { value: "pomodoro", label: "Pomodoro" },
          { value: "timer", label: "Timer" },
        ]}
      />

      {mode === "pomodoro" ? (
        <>
          <Ring progress={1 - pomodoro.leftMs / pomodoro.lengthMs} soft={onBreak}>
            <span className="text-control text-muted-foreground">{phaseLabel[pomodoro.phase]}</span>
            <Face ms={pomodoro.leftMs} />
            <Rounds done={pomodoro.round} of={settings.roundsBeforeLongBreak} />
          </Ring>
          <Controls
            running={pomodoro.running}
            onStart={focus.startPomodoro}
            onPause={focus.pausePomodoro}
            onReset={focus.resetPomodoro}
            onSkip={focus.skipPomodoro}
            skipLabel={onBreak ? "Skip break" : "Skip to break"}
          />
        </>
      ) : (
        <>
          {/* The ring goes round once an hour. */}
          <Ring progress={(stopwatch.elapsedMs % HOUR) / HOUR}>
            <span className="text-control text-muted-foreground">Timer</span>
            <Face ms={stopwatch.elapsedMs} />
            <span className="h-2" aria-hidden />
          </Ring>
          <Controls
            running={stopwatch.running}
            onStart={focus.startStopwatch}
            onPause={focus.pauseStopwatch}
            onReset={stopwatch.running || stopwatch.elapsedMs > 0 ? focus.resetStopwatch : undefined}
          />
        </>
      )}

      <Card className="w-full">
        <div className="flex items-center gap-3 px-4 py-3">
          <AudioLines className="size-[18px] text-icon" aria-hidden />
          <span className="grow text-control text-foreground">Brown noise</span>
          <Switch on={focus.noise} label="Brown noise" onChange={focus.toggleNoise} />
        </div>
        <Link href="/focus/stats" className="press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3">
          <ChartColumn className="size-[18px] text-icon" aria-hidden />
          <span className="grow text-control text-foreground">Stats</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </Card>
    </div>
  );
}

/** A circle that fills clockwise from the top as time passes. */
function Ring({ progress, soft, children }: { progress: number; soft?: boolean; children: React.ReactNode }) {
  const r = 46;
  const length = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress || 0));
  return (
    <div className="relative aspect-square w-[min(300px,80vw)] md:w-[340px]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="3" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - p)}
          className={cn(
            "transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none",
            soft ? "stroke-muted-foreground" : "stroke-foreground",
            p === 0 && "opacity-0",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">{children}</div>
    </div>
  );
}

function Controls({
  running,
  onStart,
  onPause,
  onReset,
  onSkip,
  skipLabel,
}: {
  running: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
}) {
  const side = "size-14 rounded-full";
  return (
    <div className="flex items-center gap-6">
      <Button variant="outline" size="icon" className={side} aria-label="Restart" disabled={!onReset} onClick={onReset}>
        <RotateCcw />
      </Button>
      <Button
        className="size-[76px] rounded-full [&_svg]:size-7"
        aria-label={running ? "Pause" : "Start"}
        onClick={running ? onPause : onStart}
      >
        {running ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="translate-x-0.5" />}
      </Button>
      {onSkip ? (
        <Button variant="outline" size="icon" className={side} aria-label={skipLabel} onClick={onSkip}>
          <SkipForward />
        </Button>
      ) : (
        <span className={side} aria-hidden />
      )}
    </div>
  );
}

/** Beside the title: the pomodoro lengths, for the pomodoro only. */
export function LengthsButton() {
  const focus = useFocus();
  const [editing, setEditing] = useState(false);
  if (!focus || focus.mode !== "pomodoro") return null;
  return (
    <>
      <Button variant="outline" size="icon" aria-label="Pomodoro lengths" onClick={() => setEditing(true)}>
        <SlidersHorizontal />
      </Button>
      {editing && <LengthsDialog settings={focus.settings} onClose={() => setEditing(false)} />}
    </>
  );
}

function Face({ ms }: { ms: number }) {
  return (
    <div role="timer" className="text-[64px] leading-none font-medium tracking-[-0.04em] text-ink tabular-nums md:text-[76px]">
      {clock(ms)}
    </div>
  );
}

function Rounds({ done, of }: { done: number; of: number }) {
  return (
    <div className="flex h-2 gap-2" aria-label={`${Math.min(done, of)} of ${of} rounds done`} role="img">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={cn("size-2 rounded-full", i < done ? "bg-foreground" : "bg-grey-300")} />
      ))}
    </div>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-grey-300")}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] size-[27px] rounded-full bg-grey-0 transition-transform dark:bg-on-solid",
          on && "translate-x-5",
        )}
      />
    </button>
  );
}

const fields: { key: keyof FocusSettings; label: string }[] = [
  { key: "focusMinutes", label: "Focus (minutes)" },
  { key: "shortBreakMinutes", label: "Short break (minutes)" },
  { key: "longBreakMinutes", label: "Long break (minutes)" },
  { key: "roundsBeforeLongBreak", label: "Rounds before a long break" },
];

function LengthsDialog({ settings, onClose }: { settings: FocusSettings; onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map(({ key }) => [key, String(settings[key])])) as Record<keyof FocusSettings, string>,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await op(
        "update_focus_settings",
        Object.fromEntries(fields.map(({ key }) => [key, Number(values[key])])) as Partial<FocusSettings>,
      );
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      setSaving(false);
    }
  };

  return (
    <Dialog label="Pomodoro lengths" onClose={onClose} focusFirstField={false}>
      <form onSubmit={save} className="flex flex-col gap-5 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <h2 className="text-heading font-medium text-ink">Pomodoro lengths</h2>
        <div className="flex flex-col gap-3">
          {fields.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3">
              <span className="grow text-control text-foreground">{label}</span>
              <input
                type="number"
                inputMode="numeric"
                min={FOCUS_LIMITS[key][0]}
                max={FOCUS_LIMITS[key][1]}
                required
                value={values[key]}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                className="h-11 w-20 rounded-lg border bg-card px-3 text-right text-base tabular-nums md:text-control"
              />
            </label>
          ))}
        </div>
        {error && <p className="text-meta text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

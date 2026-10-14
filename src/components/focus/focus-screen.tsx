"use client";

import {
  AudioLines,
  Check,
  ChartColumn,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { clock, duration, FOCUS_LIMITS, type FocusSettings } from "@/lib/focus";
import { inBackground } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { phaseLabel, useFocus } from "./focus-provider";

export function FocusScreen() {
  const focus = useFocus();
  if (!focus) return null;
  const { mode, setMode, pomodoro, stopwatch, settings } = focus;
  const onBreak = pomodoro.phase !== "focus";
  // On phones a running timer takes over the whole screen: just the ring and its buttons.
  const running = mode === "pomodoro" ? pomodoro.running : stopwatch.running;

  return (
    <div
      data-no-pull={running || undefined}
      className={cn(
        "flex w-full max-w-md flex-col items-center gap-8 md:mx-auto",
        running &&
          "max-md:fixed max-md:inset-0 max-md:z-50 max-md:max-w-none max-md:justify-center max-md:bg-background max-md:px-5 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <Segmented
        value={mode}
        onChange={setMode}
        className={cn("w-full", running && "max-md:hidden")}
        options={[
          { value: "pomodoro", label: "Pomodoro" },
          { value: "timer", label: "Timer" },
        ]}
      />

      {mode === "pomodoro" ? (
        <>
          <Ring
            progress={1 - pomodoro.leftMs / pomodoro.lengthMs}
            soft={onBreak}
          >
            <span className="text-control text-muted-foreground">
              {phaseLabel[pomodoro.phase]}
            </span>
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
          {/* No ring: the timer just keeps counting. */}
          <Ring>
            <span className="text-control text-muted-foreground">Timer</span>
            <Face ms={stopwatch.elapsedMs} />
            <span className="h-2" aria-hidden />
          </Ring>
          <Controls
            running={stopwatch.running}
            onStart={focus.startStopwatch}
            onPause={focus.pauseStopwatch}
            onSkip={
              // Done shows once the timer is paused, like the rest of the screen.
              !stopwatch.running && stopwatch.elapsedMs > 0
                ? () => {
                    // Done ends the session: its time is saved and the timer clears.
                    const ms = stopwatch.elapsedMs;
                    focus.resetStopwatch();
                    if (ms >= 60_000) showToast(`Saved ${duration(ms / 1000)}`);
                  }
                : undefined
            }
            skipLabel="Done"
            skipIcon={<Check />}
            onReset={
              stopwatch.running || stopwatch.elapsedMs > 0
                ? focus.discardStopwatch
                : undefined
            }
          />
        </>
      )}

      <Card className={cn("w-full", running && "max-md:hidden")}>
        <div className="flex items-center gap-3 px-4 py-3">
          <AudioLines className="size-[18px] text-icon" aria-hidden />
          <span className="grow text-control text-foreground">Brown noise</span>
          <Switch
            on={focus.noise}
            label="Brown noise"
            onChange={focus.toggleNoise}
          />
        </div>
        <Link
          href="/focus/stats"
          className={cn(
            running && "max-md:hidden",
            "press-tint flex min-h-14 items-center gap-3 border-t px-4 py-3",
          )}
        >
          <ChartColumn className="size-[18px] text-icon" aria-hidden />
          <span className="grow text-control text-foreground">Stats</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </Card>
    </div>
  );
}

/** A circle that fills clockwise from the top as time passes. */
function Ring({
  progress,
  soft,
  children,
}: {
  /** Left out: no ring, just what's inside, at the same size. */
  progress?: number;
  soft?: boolean;
  children: React.ReactNode;
}) {
  const r = 46;
  const length = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress || 0));
  return (
    <div className="relative aspect-square w-[min(300px,80vw)] md:w-[340px]">
      {progress !== undefined && (
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 size-full -rotate-90"
          aria-hidden
        >
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="3"
            className="stroke-muted"
          />
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
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        {children}
      </div>
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
  skipIcon = <SkipForward />,
}: {
  running: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  skipIcon?: React.ReactNode;
}) {
  const side = "size-14 rounded-full";
  return (
    <div className="flex items-center gap-6">
      <Button
        variant="outline"
        size="icon"
        className={side}
        aria-label="Restart"
        disabled={!onReset}
        onClick={onReset}
      >
        <RotateCcw />
      </Button>
      <Button
        className="size-[76px] rounded-full [&_svg]:size-7"
        aria-label={running ? "Pause" : "Start"}
        onClick={running ? onPause : onStart}
      >
        {running ? (
          <Pause fill="currentColor" />
        ) : (
          <Play fill="currentColor" className="translate-x-0.5" />
        )}
      </Button>
      {onSkip ? (
        <Button
          variant="outline"
          size="icon"
          className={side}
          aria-label={skipLabel}
          onClick={onSkip}
        >
          {skipIcon}
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
      <Button
        variant="outline"
        size="icon"
        aria-label="Pomodoro lengths"
        onClick={() => setEditing(true)}
      >
        <SlidersHorizontal />
      </Button>
      {editing && (
        <LengthsDialog
          settings={focus.settings}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function Face({ ms }: { ms: number }) {
  return (
    <div
      role="timer"
      className="text-[64px] leading-none font-medium tracking-[-0.04em] text-ink tabular-nums md:text-[76px]"
    >
      {clock(ms)}
    </div>
  );
}

function Rounds({ done, of }: { done: number; of: number }) {
  return (
    <div
      className="flex h-2 gap-2"
      aria-label={`${Math.min(done, of)} of ${of} rounds done`}
      role="img"
    >
      {Array.from({ length: of }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-2 rounded-full",
            i < done ? "bg-foreground" : "bg-grey-300",
          )}
        />
      ))}
    </div>
  );
}

function Switch({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors",
        on ? "bg-primary" : "bg-grey-300",
      )}
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

function LengthsDialog({
  settings,
  onClose,
}: {
  settings: FocusSettings;
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        fields.map(({ key }) => [key, String(settings[key])]),
      ) as Record<keyof FocusSettings, string>,
  );
  const [error, setError] = useState<string | null>(null);

  // Closes at once; the new lengths save behind it.
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    onClose();
    void inBackground(
      () => op("update_focus_settings", Object.fromEntries(fields.map(({ key }) => [key, Number(values[key])])) as Partial<FocusSettings>),
      { then: () => router.refresh(), failure: "Couldn't save the lengths." },
    );
  };

  return (
    <Dialog label="Pomodoro lengths" onClose={onClose} focusFirstField={false}>
      <form
        onSubmit={save}
        className="flex flex-col gap-5 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]"
      >
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
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.value }))
                }
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
          <Button type="submit">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

"use client";

import { AudioLines, Pause, Play, RotateCcw, SkipForward, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { clock, duration, FOCUS_LIMITS, type FocusSettings } from "@/lib/focus";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { phaseLabel, useFocus, type Phase } from "./focus-provider";

export function FocusScreen({ todaySeconds, weekSeconds }: { todaySeconds: number; weekSeconds: number }) {
  const focus = useFocus();
  if (!focus) return null;
  const { mode, setMode, pomodoro, stopwatch, settings } = focus;

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 md:mx-auto">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "pomodoro", label: "Pomodoro" },
          { value: "timer", label: "Timer" },
        ]}
      />

      <Card className="flex flex-col">
        {mode === "pomodoro" ? (
          <div className="flex flex-col items-center gap-6 px-5 pt-5 pb-7">
            <Segmented<Phase>
              value={pomodoro.phase}
              onChange={focus.setPhase}
              className="w-full"
              options={(["focus", "short", "long"] as const).map((p) => ({ value: p, label: phaseLabel[p] }))}
            />
            <Face ms={pomodoro.leftMs} />
            <Rounds done={pomodoro.round} of={settings.roundsBeforeLongBreak} />
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" aria-label="Reset" onClick={focus.resetPomodoro}>
                <RotateCcw />
              </Button>
              <StartPause running={pomodoro.running} onStart={focus.startPomodoro} onPause={focus.pausePomodoro} />
              <Button variant="outline" size="icon" aria-label="Skip to next" onClick={focus.skipPomodoro}>
                <SkipForward />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 px-5 pt-12 pb-7">
            <Face ms={stopwatch.elapsedMs} />
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                aria-label="Reset"
                disabled={!stopwatch.running && stopwatch.elapsedMs === 0}
                onClick={focus.resetStopwatch}
              >
                <RotateCcw />
              </Button>
              <StartPause running={stopwatch.running} onStart={focus.startStopwatch} onPause={focus.pauseStopwatch} />
              {/* Keeps Start in the middle, as on the pomodoro. */}
              <span className="size-11" aria-hidden />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 border-t px-5 py-3">
          <AudioLines className="size-[18px] text-icon" aria-hidden />
          <span className="grow text-control text-foreground">Brown noise</span>
          <Switch on={focus.noise} label="Brown noise" onChange={focus.toggleNoise} />
        </div>
      </Card>

      {(todaySeconds > 0 || weekSeconds > 0) && (
        <p className="px-1 text-meta text-muted-foreground">
          Today {duration(todaySeconds)} · Last 7 days {duration(weekSeconds)}
        </p>
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
    <div
      role="timer"
      className="text-[72px] leading-none font-medium tracking-[-0.04em] text-ink tabular-nums md:text-[96px]"
    >
      {clock(ms)}
    </div>
  );
}

function Rounds({ done, of }: { done: number; of: number }) {
  return (
    <div className="flex gap-2" aria-label={`${Math.min(done, of)} of ${of} rounds done`} role="img">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={cn("size-2 rounded-full", i < done ? "bg-foreground" : "bg-grey-300")} />
      ))}
    </div>
  );
}

function StartPause({ running, onStart, onPause }: { running: boolean; onStart: () => void; onPause: () => void }) {
  return (
    <Button className="w-32" onClick={running ? onPause : onStart}>
      {running ? <Pause /> : <Play />}
      {running ? "Pause" : "Start"}
    </Button>
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

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { momentIn, timeIn, todayIn } from "@/lib/dates";
import { duration } from "@/lib/focus";
import { op } from "@/lib/ops-client";
import { FocusChart } from "./focus-chart";

export type FocusSession = {
  id: string;
  kind: "pomodoro" | "timer";
  label: string | null;
  startedAt: Date | string;
  endedAt: Date | string;
  seconds: number;
  day: string;
};

const kindLabel = { pomodoro: "Pomodoro", timer: "Timer" };

/**
 * The chart, and under it the sessions that make up the picked day. Tap a
 * session to fix its time or delete it.
 */
export function FocusStats({
  days,
  today,
  timeZone,
  sessions,
}: {
  days: { date: string; seconds: number }[];
  today: string;
  timeZone: string;
  sessions: FocusSession[];
}) {
  const [picked, setPicked] = useState(days.length - 1);
  const [editing, setEditing] = useState<FocusSession | null>(null);
  const day = days[picked]?.date;
  const shown = sessions.filter((s) => s.day === day);
  const at = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

  return (
    <>
      <Card className="px-4 pt-5 pb-4">
        <FocusChart days={days} today={today} picked={picked} onPick={setPicked} />
      </Card>
      {shown.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-border">
            {shown.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:scale-100"
                >
                  <span className="flex grow flex-col">
                    <span className="text-control text-foreground tabular-nums">
                      {at.format(new Date(s.startedAt))} – {at.format(new Date(s.endedAt))}
                    </span>
                    <span className="text-meta text-muted-foreground">{s.label ?? kindLabel[s.kind]}</span>
                  </span>
                  <span className="text-control font-medium text-ink tabular-nums">{duration(s.seconds)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <SessionDialog session={editing} timeZone={timeZone} onClose={() => setEditing(null)} />}
    </>
  );
}

function SessionDialog({ session, timeZone, onClose }: { session: FocusSession; timeZone: string; onClose: () => void }) {
  const router = useRouter();
  const started = new Date(session.startedAt);
  const ended = new Date(session.endedAt);
  const [minutes, setMinutes] = useState(String(Math.max(1, Math.round(session.seconds / 60))));
  const [start, setStart] = useState(timeIn(timeZone, started));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = Math.round(Number(minutes) * 60);
    // A new start time moves the whole session; more minutes than it spanned stretch its end.
    const startedAt = momentIn(timeZone, todayIn(timeZone, started), start);
    let endedAt = new Date(ended.getTime() + startedAt.getTime() - started.getTime());
    if (endedAt.getTime() < startedAt.getTime() + seconds * 1000) endedAt = new Date(startedAt.getTime() + seconds * 1000);
    setBusy(true);
    setError(null);
    try {
      await op("update_focus_session", {
        id: session.id,
        seconds,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      });
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await op("delete_focus_session", { id: session.id });
      router.refresh();
      onClose();
      showToast("Session deleted", async () => {
        await op("log_focus_session", {
          id: session.id,
          kind: session.kind,
          seconds: session.seconds,
          startedAt: started.toISOString(),
          endedAt: ended.toISOString(),
          label: session.label ?? undefined,
        });
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete.");
      setBusy(false);
    }
  };

  return (
    <Dialog label="Focus session" onClose={onClose} focusFirstField={false}>
      <form onSubmit={save} className="flex flex-col gap-5 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <h2 className="text-heading font-medium text-ink">{session.label ?? kindLabel[session.kind]}</h2>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3">
            <span className="grow text-control text-foreground">Minutes focused</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={24 * 60}
              required
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="h-11 w-24 rounded-lg border bg-card px-3 text-right text-base tabular-nums md:text-control"
            />
          </label>
          <label className="flex items-center gap-3">
            <span className="grow text-control text-foreground">Started</span>
            <input
              type="time"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-11 w-36 rounded-lg border bg-card px-3 text-right text-base tabular-nums md:text-control"
            />
          </label>
        </div>
        {error && <p className="text-meta text-danger">{error}</p>}
        <div className="flex items-center gap-2">
          <Button variant="danger" onClick={remove} disabled={busy} className="-ml-2">
            Delete
          </Button>
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

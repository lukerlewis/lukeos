"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { op } from "@/lib/ops-client";
import { clock, type FocusSettings } from "@/lib/focus";
import { MiniPlayer, openMiniWindow } from "./mini-player";

/**
 * The Focus timers and brown noise live here, in the app's frame, so they keep
 * going while Luke moves around the app. Timers count from timestamps (not
 * ticks), and are saved in the browser, so a reload or a locked phone doesn't
 * lose them: the time catches up when the app is back on screen.
 */

export type Phase = "focus" | "short" | "long";

type Pomodoro = {
  phase: Phase;
  /** Focus rounds finished since the last long break. */
  round: number;
  /** Running: when this phase ends. */
  endsAt: number | null;
  /** Paused part way: the time left. Null means the phase hasn't started. */
  leftMs: number | null;
  /** How long this phase is, fixed when it starts. */
  lengthMs: number | null;
  /** When the current focus round was first started. */
  startedAt: number | null;
};

type Stopwatch = {
  /** Running: when the current stretch started. */
  runningSince: number | null;
  /** Time counted before the current stretch. */
  elapsedMs: number;
  startedAt: number | null;
};

type Saved = { mode: "pomodoro" | "timer"; pomodoro: Pomodoro; stopwatch: Stopwatch };

const STORAGE_KEY = "lukeos:focus";
/** Shorter runs aren't worth a line in the stats. */
const MIN_LOGGED_MS = 60_000;

const freshPomodoro = (phase: Phase = "focus", round = 0): Pomodoro => ({
  phase,
  round,
  endsAt: null,
  leftMs: null,
  lengthMs: null,
  startedAt: null,
});
const freshStopwatch = (): Stopwatch => ({ runningSince: null, elapsedMs: 0, startedAt: null });
const initial: Saved = { mode: "pomodoro", pomodoro: freshPomodoro(), stopwatch: freshStopwatch() };

export const phaseLabel: Record<Phase, string> = { focus: "Focus", short: "Break", long: "Long break" };

type FocusContextValue = {
  settings: FocusSettings;
  now: number;
  mode: Saved["mode"];
  setMode: (mode: Saved["mode"]) => void;
  pomodoro: Pomodoro & { running: boolean; leftMs: number; lengthMs: number };
  startPomodoro: () => void;
  pausePomodoro: () => void;
  resetPomodoro: () => void;
  skipPomodoro: () => void;
  stopwatch: { running: boolean; elapsedMs: number };
  startStopwatch: () => void;
  pauseStopwatch: () => void;
  resetStopwatch: () => void;
  noise: boolean;
  toggleNoise: () => void;
  /** What a running timer shows, for the tab bar and sidebar. */
  runningClock: string | null;
  /** The floating window on a computer, when it's open. */
  mini: boolean;
  toggleMini: () => void;
};

const FocusContext = createContext<FocusContextValue | null>(null);

/** The Focus timers, or null outside the app's frame (e.g. while it loads). */
export function useFocus() {
  return useContext(FocusContext);
}

export function FocusProvider({ settings, children }: { settings: FocusSettings; children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<Saved>(initial);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [noise, setNoise] = useState(false);
  const [mini, setMini] = useState<Window | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const chimeRef = useRef<AudioContext | null>(null);

  // Pick up timers saved in this browser.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after mount
      if (raw) setState({ ...initial, ...(JSON.parse(raw) as Partial<Saved>) });
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, loaded]);

  const lengthOf = useCallback(
    (phase: Phase) =>
      (phase === "focus" ? settings.focusMinutes : phase === "short" ? settings.shortBreakMinutes : settings.longBreakMinutes) * 60_000,
    [settings],
  );

  /** Saves focus time for the stats. Breaks and brown noise on its own never count. */
  const log = useCallback(
    (kind: "pomodoro" | "timer", ms: number, startedAt: number | null, endedAt: number) => {
      if (ms < MIN_LOGGED_MS) return;
      op("log_focus_session", {
        kind,
        seconds: Math.round(ms / 1000),
        startedAt: new Date(startedAt ?? endedAt - ms).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
      })
        .then(() => router.refresh())
        .catch((err) => console.error("[focus] couldn't save the session", err));
    },
    [router],
  );

  /** The phase after this one: a break after focus (long every few rounds), then focus again. */
  const nextAfter = useCallback(
    (p: Pomodoro): Pomodoro => {
      if (p.phase !== "focus") return freshPomodoro("focus", p.phase === "long" ? 0 : p.round);
      const round = p.round + 1;
      return round >= settings.roundsBeforeLongBreak ? freshPomodoro("long", round) : freshPomodoro("short", round);
    },
    [settings.roundsBeforeLongBreak],
  );

  const chime = useCallback(() => {
    try {
      const ctx = chimeRef.current;
      if (ctx && ctx.state === "running") {
        // Two soft bell notes.
        [0, 0.35].forEach((delay, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = i ? 660 : 880;
          const t = ctx.currentTime + delay;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 1.3);
        });
      }
      navigator.vibrate?.([200, 100, 200]);
    } catch {}
  }, []);

  const notify = useCallback((title: string) => {
    if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(title, { tag: "focus", icon: "/icon-192.png", data: { url: "/focus" } }))
      .catch(() => {});
  }, []);

  /** The bell needs a gesture to be allowed to play, so it's woken on Start. */
  const wakeChime = () => {
    try {
      chimeRef.current ??= new AudioContext();
      void chimeRef.current.resume();
    } catch {}
  };

  // A running pomodoro reaching its end: ring, and line up the next phase, ready to start.
  const p = state.pomodoro;
  useEffect(() => {
    if (!p.endsAt || now < p.endsAt) return;
    if (p.phase === "focus") log("pomodoro", p.lengthMs ?? lengthOf("focus"), p.startedAt, p.endsAt);
    const next = nextAfter(p);
    chime();
    notify(p.phase === "focus" ? "Focus done. Time for a break." : "Break over. Back to focus.");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the phase ends when the clock says so
    setState((s) => ({ ...s, pomodoro: next }));
  }, [now, p, log, lengthOf, nextAfter, chime, notify]);

  const pomodoroRunning = p.endsAt !== null;
  const stopwatchRunning = state.stopwatch.runningSince !== null;

  // Tick while anything runs, and catch up as soon as the app is back on screen.
  useEffect(() => {
    if (!pomodoroRunning && !stopwatchRunning) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [pomodoroRunning, stopwatchRunning]);

  const left = (pp: Pomodoro, at: number) =>
    pp.endsAt !== null ? Math.max(0, pp.endsAt - at) : (pp.leftMs ?? lengthOf(pp.phase));

  const startPomodoro = () => {
    wakeChime();
    const at = Date.now();
    setNow(at);
    setState((s) => {
      const pp = s.pomodoro;
      if (pp.endsAt) return s;
      const lengthMs = pp.lengthMs ?? lengthOf(pp.phase);
      return {
        ...s,
        pomodoro: { ...pp, lengthMs, endsAt: at + (pp.leftMs ?? lengthMs), leftMs: null, startedAt: pp.startedAt ?? at },
      };
    });
  };

  const pausePomodoro = () => {
    const at = Date.now();
    setState((s) =>
      s.pomodoro.endsAt ? { ...s, pomodoro: { ...s.pomodoro, endsAt: null, leftMs: Math.max(0, s.pomodoro.endsAt - at) } } : s,
    );
  };

  const resetPomodoro = () => setState((s) => ({ ...s, pomodoro: freshPomodoro(s.pomodoro.phase, s.pomodoro.round) }));

  /** Moving on early still counts the focus done so far. */
  const skipPomodoro = () => {
    const at = Date.now();
    const pp = state.pomodoro;
    if (pp.phase === "focus" && pp.lengthMs) log("pomodoro", pp.lengthMs - left(pp, at), pp.startedAt, at);
    setState((s) => ({ ...s, pomodoro: nextAfter(s.pomodoro) }));
  };

  const startStopwatch = () => {
    const at = Date.now();
    setNow(at);
    setState((s) =>
      s.stopwatch.runningSince
        ? s
        : { ...s, stopwatch: { ...s.stopwatch, runningSince: at, startedAt: s.stopwatch.startedAt ?? at } },
    );
  };

  const pauseStopwatch = () => {
    const at = Date.now();
    setState((s) =>
      s.stopwatch.runningSince
        ? { ...s, stopwatch: { ...s.stopwatch, runningSince: null, elapsedMs: s.stopwatch.elapsedMs + at - s.stopwatch.runningSince } }
        : s,
    );
  };

  const stopwatchElapsed = (sw: Stopwatch, at: number) => sw.elapsedMs + (sw.runningSince ? at - sw.runningSince : 0);

  /** Restarting the regular timer is how a run ends, so its time is saved. */
  const resetStopwatch = () => {
    const at = Date.now();
    log("timer", stopwatchElapsed(state.stopwatch, at), state.stopwatch.startedAt, at);
    setState((s) => ({ ...s, stopwatch: freshStopwatch() }));
  };

  // Brown noise: the <audio> element below, looping. Its own events keep the
  // switch right when it's paused from the lock screen or headphones.
  const toggleNoise = () => {
    const audio = audioRef.current;
    if (!audio) return;
    // Safari: a "playback" audio session keeps the noise going when Luke leaves
    // the app or locks his phone, and plays even with the ring switch on silent.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    if (audio.paused) audio.play().catch((err) => console.error("[focus] brown noise didn't start", err));
    else audio.pause();
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      setNoise(!audio.paused);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
    };
    const onPlay = () => {
      sync();
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Brown noise",
          artist: "LukeOS",
          artwork: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
        });
        navigator.mediaSession.setActionHandler("play", () => void audio.play());
        navigator.mediaSession.setActionHandler("pause", () => audio.pause());
      }
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", sync);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", sync);
    };
  }, []);

  const toggleMini = () => {
    if (mini) return mini.close();
    openMiniWindow()
      .then((win) => {
        if (!win) return;
        win.addEventListener("pagehide", () => setMini(null));
        setMini(win);
      })
      .catch((err) => console.error("[focus] couldn't open the floating window", err));
  };

  const pomodoroLeft = left(p, now);
  const swElapsed = stopwatchElapsed(state.stopwatch, now);
  const runningClock = pomodoroRunning ? clock(pomodoroLeft) : stopwatchRunning ? clock(swElapsed) : null;

  const value: FocusContextValue = {
    settings,
    now,
    mode: state.mode,
    setMode: (mode) => setState((s) => ({ ...s, mode })),
    pomodoro: { ...p, running: pomodoroRunning, leftMs: pomodoroLeft, lengthMs: p.lengthMs ?? lengthOf(p.phase) },
    startPomodoro,
    pausePomodoro,
    resetPomodoro,
    skipPomodoro,
    stopwatch: { running: stopwatchRunning, elapsedMs: swElapsed },
    startStopwatch,
    pauseStopwatch,
    resetStopwatch,
    noise,
    toggleNoise,
    runningClock,
    mini: mini !== null,
    toggleMini,
  };

  return (
    <FocusContext value={value}>
      {children}
      {mini && <MiniPlayer win={mini} />}
      <audio ref={audioRef} src="/sounds/brown-noise.mp3" loop preload="none" />
    </FocusContext>
  );
}

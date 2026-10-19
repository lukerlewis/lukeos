"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useFocus } from "@/components/focus/focus-provider";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Episode } from "@/core/listen";
import { SPEEDS } from "@/lib/listen";

/**
 * Listen's player lives here, in the app's frame, so it keeps playing while
 * Luke moves around the app. One <audio> element plays everything, with a
 * "playback" audio session and lock-screen controls (Media Session), so it
 * goes on with the phone locked and moves to the next episode by itself.
 *
 * Where he got to is saved as he listens (every 15 seconds, and on pause or
 * leaving the app), and what was playing is remembered in the browser, so the
 * player is still there after a reload. When an episode finishes, he's asked
 * whether to delete it: nothing is deleted without asking.
 */

export type PlayerEpisode = Pick<Episode, "id" | "title" | "show" | "src" | "artworkUrl" | "durationSeconds" | "positionSeconds" | "kind">;

type Saved = {
  queue: PlayerEpisode[];
  index: number;
  speed: number;
  repeat?: boolean;
  shuffle?: boolean;
  /** With shuffle on: the list in its own order, to go back to when it's turned off. */
  original?: PlayerEpisode[] | null;
};

const STORAGE_KEY = "lukeos:listen";
const SAVE_EVERY_MS = 15_000;
/** Longer than this, the lock screen shows skip back 15 / forward 30; shorter (songs), previous / next. */
const LONG_SECONDS = 20 * 60;
const BACK = 15;
/** Playlists and All songs start over from the top when they finish; a list of only podcast episodes just stops. */
const loops = (q: PlayerEpisode[]) => q.some((e) => e.kind !== "podcast");
const FORWARD = 30;

type ListenContextValue = {
  current: PlayerEpisode | null;
  queue: PlayerEpisode[];
  index: number;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  speed: number;
  /** Plays the current track over and over until turned off. */
  repeat: boolean;
  shuffle: boolean;
  /** Plays this episode, with the list it came from as what plays next. */
  play: (episode: PlayerEpisode, queue?: PlayerEpisode[]) => void;
  /** Turns shuffle on and plays the list from a random track. */
  playShuffled: (queue: PlayerEpisode[]) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  next: () => void;
  /** Whether Next goes anywhere: there's a track after this one, or the list starts over. */
  hasNext: boolean;
  previous: () => void;
  setSpeed: (speed: number) => void;
  setRepeat: (on: boolean) => void;
  setShuffle: (on: boolean) => void;
  /** Stops and hides the player. */
  close: () => void;
  /** Forget an episode that was deleted. */
  forget: (id: string) => void;
};

const ListenContext = createContext<ListenContextValue | null>(null);

export const useListen = () => useContext(ListenContext);

/** The list with `first` at the front and everything else in a random order. */
function shuffled(list: PlayerEpisode[], first: PlayerEpisode) {
  const rest = list.filter((e) => e.id !== first.id);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (!Array.isArray(saved.queue)) return null;
    return saved;
  } catch {
    return null;
  }
}

function store(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {}
}

/** Saves without waiting, even as the app closes. */
function send(name: string, input: Record<string, unknown>) {
  return fetch(`/api/ops/${name}`, {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    if (!res.ok) throw new Error("save failed");
  });
}

export function ListenProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const focus = useFocus();
  // The Focus context changes every second while a timer runs; the player only needs its brown noise switch.
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<PlayerEpisode[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [repeat, setRepeatState] = useState(false);
  const [shuffle, setShuffleState] = useState(false);
  /** With shuffle on, the list in its own order. */
  const originalRef = useRef<PlayerEpisode[] | null>(null);
  const [finished, setFinished] = useState<PlayerEpisode | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The episode the audio element has actually started (so its time is real). */
  const startedRef = useRef<string | null>(null);
  const current = queue[index] ?? null;

  // Refs for the audio element's event handlers, which outlive renders.
  const state = useRef({ queue, index, speed, shuffle, lastSaved: 0 });
  useEffect(() => {
    state.current.queue = queue;
    state.current.index = index;
    state.current.speed = speed;
    state.current.shuffle = shuffle;
  }, [queue, index, speed, shuffle]);

  // Repeat loops the audio element itself, so it carries on with the phone locked (and never counts as finished).
  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = repeat;
  }, [repeat]);

  // What was playing last time comes back paused.
  useEffect(() => {
    const saved = load();
    if (!saved?.queue.length) return;
    const audio = audioRef.current;
    const ep = saved.queue[saved.index];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after mount
    setQueue(saved.queue);
    setIndex(saved.index);
    setSpeedState(SPEEDS.includes(saved.speed as (typeof SPEEDS)[number]) ? saved.speed : 1);
    setRepeatState(Boolean(saved.repeat));
    setShuffleState(Boolean(saved.shuffle));
    originalRef.current = saved.shuffle ? (saved.original ?? null) : null;
    if (audio && ep?.src) {
      audio.preload = "metadata";
      audio.src = ep.src;
      setPosition(ep.kind === "podcast" ? ep.positionSeconds : 0);
      setDuration(ep.durationSeconds ?? 0);
    }
  }, []);

  useEffect(() => {
    if (queue.length) store({ queue, index, speed, repeat, shuffle, original: originalRef.current });
    else
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    document.documentElement.toggleAttribute("data-player", queue.length > 0);
  }, [queue, index, speed, repeat, shuffle]);

  /** Saves where Luke is in the current episode, here and on the server. */
  const savePosition = useCallback((force = false) => {
    const audio = audioRef.current;
    const { queue: q, index: i } = state.current;
    const ep = q[i];
    // Until it's started, the audio element is at 0 whatever Luke's place is, so there's nothing to save.
    if (!audio || !ep || ep.kind !== "podcast" || startedRef.current !== ep.id || !Number.isFinite(audio.currentTime)) return;
    const now = Date.now();
    if (!force && now - state.current.lastSaved < SAVE_EVERY_MS) return;
    state.current.lastSaved = now;
    const seconds = Math.floor(audio.currentTime);
    const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration) : undefined;
    ep.positionSeconds = seconds;
    store({ queue: q, index: i, speed: state.current.speed, repeat: audio.loop, shuffle: state.current.shuffle, original: originalRef.current });
    send("update_episode", {
      id: ep.id,
      positionSeconds: seconds,
      played: true,
      ...(duration && !ep.durationSeconds ? { durationSeconds: duration } : {}),
    }).catch(() => {});
  }, []);

  /** Starts an episode on the audio element, from where Luke left off. */
  const start = useCallback(
    (ep: PlayerEpisode) => {
      const audio = audioRef.current;
      if (!audio || !ep.src) {
        if (!ep.src) showToast("That file is missing.");
        return;
      }
      // Safari: keeps playing with the phone locked or on silent.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
      // One thing playing at a time: brown noise stops when an episode starts.
      const f = focusRef.current;
      if (f?.noise) f.toggleNoise();
      if (audio.src !== new URL(ep.src, location.href).href) {
        audio.src = ep.src;
        setDuration(ep.durationSeconds ?? 0);
      }
      // A fresh start (not a resume after pause) picks up where Luke left off.
      if (startedRef.current !== ep.id) {
        startedRef.current = ep.id;
        // Songs always start from the beginning; only podcast episodes keep their place.
        const from = ep.kind !== "podcast" || (ep.durationSeconds && ep.positionSeconds > ep.durationSeconds - 10) ? 0 : ep.positionSeconds;
        if (from > 0) {
          if (audio.readyState >= 1) audio.currentTime = from;
          else
            audio.addEventListener("loadedmetadata", () => startedRef.current === ep.id && (audio.currentTime = from), { once: true });
        }
        setPosition(from);
      }
      audio.playbackRate = state.current.speed;
      setLoading(true);
      audio.play().catch((err) => {
        setLoading(false);
        if ((err as Error).name !== "AbortError") showToast("Couldn't play that. Try again.");
      });
    },
    [],
  );

  const play = useCallback(
    (ep: PlayerEpisode, list?: PlayerEpisode[]) => {
      savePosition(true);
      let q = list?.length ? list : [ep];
      let i = Math.max(0, q.findIndex((e) => e.id === ep.id));
      if (state.current.shuffle) {
        originalRef.current = q;
        q = shuffled(q, q[i]);
        i = 0;
      }
      setQueue(q);
      setIndex(i);
      state.current.queue = q;
      state.current.index = i;
      start(q[i]);
    },
    [savePosition, start],
  );

  const playShuffled = useCallback(
    (list: PlayerEpisode[]) => {
      if (!list.length) return;
      setShuffleState(true);
      state.current.shuffle = true;
      play(list[Math.floor(Math.random() * list.length)], list);
    },
    [play],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    const ep = state.current.queue[state.current.index];
    if (!audio || !ep) return;
    if (audio.paused) start(ep);
    else audio.pause();
  }, [start]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const end = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    audio.currentTime = Math.max(0, Math.min(seconds, end - 0.5));
    setPosition(audio.currentTime);
  }, []);

  const skip = useCallback((delta: number) => seek((audioRef.current?.currentTime ?? 0) + delta), [seek]);

  const goTo = useCallback(
    (i: number) => {
      const q = state.current.queue;
      if (i < 0 || i >= q.length) return false;
      savePosition(true);
      setIndex(i);
      state.current.index = i;
      start(q[i]);
      return true;
    },
    [savePosition, start],
  );

  const next = useCallback(() => {
    const { queue: q, index: i } = state.current;
    void goTo(i + 1 < q.length ? i + 1 : loops(q) ? 0 : i + 1);
  }, [goTo]);
  const previous = useCallback(() => {
    // Like a music app: back to the start first, then the one before.
    if ((audioRef.current?.currentTime ?? 0) > 5 || !goTo(state.current.index - 1)) seek(0);
  }, [goTo, seek]);

  const setShuffle = useCallback((on: boolean) => {
    const { queue: q, index: i } = state.current;
    const cur = q[i];
    setShuffleState(on);
    state.current.shuffle = on;
    if (!cur) return;
    let next: PlayerEpisode[];
    if (on) {
      originalRef.current = q;
      next = shuffled(q, cur);
    } else {
      // Back to the list's own order, without anything deleted meanwhile.
      const ids = new Set(q.map((e) => e.id));
      next = (originalRef.current ?? q).filter((e) => ids.has(e.id));
      originalRef.current = null;
    }
    const at = Math.max(0, next.findIndex((e) => e.id === cur.id));
    setQueue(next);
    setIndex(at);
    state.current.queue = next;
    state.current.index = at;
  }, []);

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
    state.current.speed = s;
    if (audioRef.current) audioRef.current.playbackRate = s;
  }, []);

  const close = useCallback(() => {
    savePosition(true);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    startedRef.current = null;
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  }, [savePosition]);

  const forget = useCallback(
    (id: string) => {
      const q = state.current.queue;
      const at = q.findIndex((e) => e.id === id);
      if (at < 0) return;
      if (at === state.current.index) {
        const rest = q.filter((e) => e.id !== id);
        const audio = audioRef.current;
        audio?.pause();
        if (!rest.length) return close();
        const i = Math.min(at, rest.length - 1);
        setQueue(rest);
        setIndex(i);
        state.current.queue = rest;
        state.current.index = i;
        startedRef.current = null;
        if (audio && rest[i].src) {
          audio.src = rest[i].src!;
          setPosition(rest[i].positionSeconds);
          setDuration(rest[i].durationSeconds ?? 0);
        }
      } else {
        setQueue(q.filter((e) => e.id !== id));
        if (at < state.current.index) setIndex(state.current.index - 1);
      }
    },
    [close],
  );

  // The audio element's own events keep the player right, including when
  // it's paused or played from the lock screen or headphones.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => {
      setPlaying(true);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    };
    const onPlaying = () => setLoading(false);
    const onPause = () => {
      setPlaying(false);
      setLoading(false);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
      savePosition(true);
    };
    const onTime = () => {
      setPosition(audio.currentTime);
      savePosition();
      if ("mediaSession" in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            position: Math.min(audio.currentTime, audio.duration),
            playbackRate: audio.playbackRate,
          });
        } catch {}
      }
    };
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      audio.playbackRate = state.current.speed;
    };
    const onWaiting = () => setLoading(true);
    const onError = () => {
      setLoading(false);
      if (audio.getAttribute("src")) showToast("That episode couldn't be loaded.");
    };
    const onEnded = () => {
      const { queue: q, index: i } = state.current;
      const done = q[i];
      if (done) {
        done.positionSeconds = 0;
        // Songs stay in the library to play again; only podcast episodes ask whether to delete.
        if (done.kind === "podcast") {
          send("update_episode", { id: done.id, finished: true }).then(() => router.refresh(), () => {});
          setFinished(done);
        } else {
          send("update_episode", { id: done.id, positionSeconds: 0 }).catch(() => {});
        }
      }
      // Straight on to the next one, while the audio session is still going (works with the phone locked).
      const nextIndex = i + 1 < q.length ? i + 1 : loops(q) ? 0 : q.length;
      if (nextIndex < q.length) {
        setIndex(nextIndex);
        state.current.index = nextIndex;
        start(q[nextIndex]);
      } else {
        setPosition(0);
      }
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    const leave = () => savePosition(true);
    const hidden = () => document.visibilityState === "hidden" && savePosition(true);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [router, savePosition, start]);

  // Lock-screen controls and what they show.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: current.title,
      artist: current.show ?? "LukeOS",
      album: current.show ?? "Music",
      artwork: current.artworkUrl
        ? [{ src: current.artworkUrl, sizes: "600x600" }]
        : [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
    const long = (current.durationSeconds ?? duration) >= LONG_SECONDS || !duration;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {}
    };
    set("play", () => toggle());
    set("pause", () => audioRef.current?.pause());
    set("seekto", (d) => d.seekTime != null && seek(d.seekTime));
    set("seekbackward", (d) => skip(-(d.seekOffset ?? BACK)));
    set("seekforward", (d) => skip(d.seekOffset ?? FORWARD));
    // iPhones show previous/next instead of skip buttons when these are set, so long episodes leave them off.
    set("previoustrack", long ? null : () => previous());
    set("nexttrack", long || (index >= queue.length - 1 && !loops(queue)) ? null : () => next());
  }, [current, duration, index, queue, toggle, seek, skip, next, previous]);

  async function decide(remove: boolean) {
    const ep = finished;
    if (!ep) return;
    setDeleting(true);
    try {
      if (remove) {
        await send("delete_episode", { id: ep.id });
        forget(ep.id);
        showToast("Deleted");
      } else {
        await send("update_episode", { id: ep.id, kept: true });
      }
      setFinished(null);
      router.refresh();
    } catch {
      showToast("Couldn't do that. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  const value: ListenContextValue = {
    current,
    queue,
    index,
    playing,
    loading,
    position,
    duration: duration || current?.durationSeconds || 0,
    speed,
    repeat,
    shuffle,
    play,
    playShuffled,
    toggle,
    seek,
    skip,
    next,
    hasNext: index < queue.length - 1 || loops(queue),
    previous,
    setSpeed,
    setRepeat: setRepeatState,
    setShuffle,
    close,
    forget,
  };

  return (
    <ListenContext value={value}>
      {children}
      <audio ref={audioRef} preload="metadata" />
      {finished && (
        <Dialog label="Finished" onClose={() => setFinished(null)} focusFirstField={false}>
          <div className="flex flex-col gap-5 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
            <div>
              <h2 className="text-heading font-medium">Finished</h2>
              <p className="mt-1 text-preview text-muted-foreground">
                Delete “{finished.title}”?{finished.kind === "upload" ? " Its file is deleted for good, freeing up storage." : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="grow" disabled={deleting} onClick={() => void decide(false)}>
                Keep
              </Button>
              <Button className="grow" disabled={deleting} onClick={() => void decide(true)}>
                Delete
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </ListenContext>
  );
}

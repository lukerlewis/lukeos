"use client";

import { Loader2, Music, Pause, Play, Repeat1, RotateCcw, RotateCw, Shuffle, SkipBack, SkipForward, X } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { DESKTOP_PLAYER_BAR_ON } from "@/lib/features";
import { playClock, SPEEDS } from "@/lib/listen";
import { cn } from "@/lib/utils";
import { useListen, type PlayerEpisode } from "./listen-provider";

/** An episode's picture, or a plain square with a music note when it has none. */
export function Artwork({ episode, className }: { episode: Pick<PlayerEpisode, "artworkUrl">; className?: string }) {
  return episode.artworkUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- podcast artwork lives on the podcast's servers
    <img src={episode.artworkUrl} alt="" className={cn("shrink-0 rounded-md bg-muted object-cover", className)} loading="lazy" />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center rounded-md bg-muted text-icon", className)} aria-hidden>
      <Music className="size-1/2" />
    </span>
  );
}

const speedLabel = (s: number) => `${s}×`;

/**
 * What's playing, along the bottom: above the tab bar on phones (tap it for
 * the full player), across the bottom of the screen on computers.
 */
export function PlayerBar() {
  const listen = useListen();
  const [open, setOpen] = useState(false);
  if (!listen?.current) return null;
  const { current, loading, position, duration } = listen;
  const progress = duration ? Math.min(1, position / duration) : 0;

  return (
    <>
      {/* Phones */}
      <div className="fixed inset-x-5 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-20 md:hidden">
        <div className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-stroke bg-card py-2 pr-1.5 pl-2">
          <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 grow items-center gap-3 text-left" aria-label="Open the player">
            <Artwork episode={current} className="size-10" />
            <span className="min-w-0 grow">
              <span className="block truncate text-preview font-medium">{current.title}</span>
              {current.show && <span className="block truncate text-meta text-muted-foreground">{current.show}</span>}
            </span>
          </button>
          <PlayButton />
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-muted" aria-hidden>
            <span className="block h-full bg-foreground" style={{ width: `${progress * 100}%` }} />
          </span>
        </div>
      </div>

      {/* Computers (on ice: hovering Music in the sidebar has the controls instead) */}
      {DESKTOP_PLAYER_BAR_ON && (
      <div className="hidden h-[72px] shrink-0 items-center gap-4 border-t border-stroke bg-sidebar px-4 md:flex">
        <button type="button" onClick={() => setOpen(true)} className="flex w-64 min-w-0 shrink-0 items-center gap-3 text-left" aria-label="Open the player">
          <Artwork episode={current} className="size-11" />
          <span className="min-w-0">
            <span className="block truncate text-preview font-medium">{current.title}</span>
            {current.show && <span className="block truncate text-meta text-muted-foreground">{current.show}</span>}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Back 15 seconds" onClick={() => listen.skip(-15)}>
            <RotateCcw />
          </IconButton>
          <PlayButton />
          <IconButton label="Forward 30 seconds" onClick={() => listen.skip(30)}>
            <RotateCw />
          </IconButton>
          {listen.hasNext && (
            <IconButton label="Next" onClick={listen.next}>
              <SkipForward />
            </IconButton>
          )}
        </div>
        <Scrubber className="grow" />
        <ShuffleButton />
        <RepeatButton />
        <SpeedButton />
        <IconButton label="Close the player" onClick={listen.close}>
          <X />
        </IconButton>
      </div>
      )}

      {open && <NowPlaying onClose={() => setOpen(false)} />}
      {loading && <span className="sr-only">Loading</span>}
    </>
  );
}

function IconButton({
  label,
  onClick,
  children,
  className,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  /** For on/off buttons (shuffle, repeat): on shows dark on a grey circle, off stays faded. */
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "press flex size-11 items-center justify-center rounded-full text-subtle-foreground hover:bg-muted [&_svg]:size-5",
        pressed === false && "text-icon",
        pressed && "bg-selected text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function PlayButton({ big }: { big?: boolean }) {
  const listen = useListen()!;
  return (
    <button
      type="button"
      aria-label={listen.playing ? "Pause" : "Play"}
      onClick={listen.toggle}
      className={cn(
        "press flex shrink-0 items-center justify-center rounded-full",
        big ? "size-16 bg-primary text-primary-foreground [&_svg]:size-7" : "size-11 text-foreground hover:bg-muted [&_svg]:size-6",
      )}
    >
      {listen.loading && listen.playing ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : listen.playing ? (
        <Pause className="fill-current" aria-hidden />
      ) : (
        <Play className={cn("fill-current", big ? "translate-x-0.5" : "translate-x-px")} aria-hidden />
      )}
    </button>
  );
}

function Scrubber({ className }: { className?: string }) {
  const listen = useListen()!;
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? listen.position;
  const max = Math.max(listen.duration, 1);
  return (
    <div className={cn("flex min-w-0 items-center gap-3 text-meta tabular-nums text-muted-foreground", className)}>
      <span className="w-14 shrink-0 text-right">{playClock(shown)}</span>
      <input
        type="range"
        aria-label="Position"
        min={0}
        max={max}
        step={1}
        value={Math.min(shown, max)}
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={() => {
          if (dragging !== null) listen.seek(dragging);
          setDragging(null);
        }}
        onKeyUp={() => {
          if (dragging !== null) listen.seek(dragging);
          setDragging(null);
        }}
        className="listen-range h-6 min-w-0 grow"
        style={{ "--fill": `${(Math.min(shown, max) / max) * 100}%` } as React.CSSProperties}
      />
      <span className="w-14 shrink-0">-{playClock(Math.max(0, listen.duration - shown))}</span>
    </div>
  );
}

function ShuffleButton() {
  const listen = useListen()!;
  return (
    <IconButton label={listen.shuffle ? "Shuffle on" : "Shuffle off"} pressed={listen.shuffle} onClick={() => listen.setShuffle(!listen.shuffle)}>
      <Shuffle />
    </IconButton>
  );
}

function RepeatButton() {
  const listen = useListen()!;
  return (
    <IconButton label={listen.repeat ? "Repeat this track: on" : "Repeat this track: off"} pressed={listen.repeat} onClick={() => listen.setRepeat(!listen.repeat)}>
      <Repeat1 />
    </IconButton>
  );
}

function SpeedButton() {
  const listen = useListen()!;
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(listen.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
  return (
    <button
      type="button"
      onClick={() => listen.setSpeed(nextSpeed)}
      aria-label={`Speed ${speedLabel(listen.speed)}. Change to ${speedLabel(nextSpeed)}`}
      className="press h-9 min-w-14 shrink-0 rounded-lg border border-stroke px-2 text-meta font-medium tabular-nums text-subtle-foreground hover:bg-muted"
    >
      {speedLabel(listen.speed)}
    </button>
  );
}

/** The full player: big artwork, the scrubber, skip buttons, speed, and what's up next. */
function NowPlaying({ onClose }: { onClose: () => void }) {
  const listen = useListen()!;
  const { current, queue, index } = listen;
  if (!current) return null;
  const upNext = queue.slice(index + 1);
  return (
    <Dialog label="Now playing" onClose={onClose} focusFirstField={false}>
      <div className="flex flex-col gap-6 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <div className="flex justify-between">
          <span className="mx-auto h-1 w-10 rounded-full bg-grey-300 sm:hidden" aria-hidden />
        </div>
        <Artwork episode={current} className="mx-auto aspect-square w-full max-w-72 rounded-xl" />
        <div className="min-w-0 text-center">
          <h2 className="text-heading font-medium break-words">{current.title}</h2>
          {current.show && <p className="mt-0.5 text-preview text-muted-foreground">{current.show}</p>}
        </div>
        <Scrubber />
        <div className="flex items-center justify-center gap-4">
          <IconButton label="Previous" onClick={listen.previous}>
            <SkipBack />
          </IconButton>
          <IconButton label="Back 15 seconds" onClick={() => listen.skip(-15)}>
            <RotateCcw />
          </IconButton>
          <PlayButton big />
          <IconButton label="Forward 30 seconds" onClick={() => listen.skip(30)}>
            <RotateCw />
          </IconButton>
          <IconButton label="Next" onClick={listen.next} className={cn(!listen.hasNext && "invisible")}>
            <SkipForward />
          </IconButton>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SpeedButton />
            <ShuffleButton />
            <RepeatButton />
          </div>
          <button type="button" onClick={() => { listen.close(); onClose(); }} className="press h-9 rounded-lg px-3 text-meta font-medium text-muted-foreground hover:bg-muted">
            Close player
          </button>
        </div>
        {upNext.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="px-1 text-sm font-medium text-muted-foreground">Up next</h3>
            <ul>
              {upNext.map((ep) => (
                <li key={ep.id}>
                  <button
                    type="button"
                    onClick={() => listen.play(ep, queue)}
                    className="press-tint flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-muted"
                  >
                    <Artwork episode={ep} className="size-9" />
                    <span className="min-w-0 grow">
                      <span className="block truncate text-preview font-medium">{ep.title}</span>
                      {ep.show && <span className="block truncate text-meta text-muted-foreground">{ep.show}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}

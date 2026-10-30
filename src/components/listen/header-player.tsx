"use client";

import { Loader2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useListen } from "./listen-provider";
import { Artwork, NowPlaying } from "./player-bar";

const button = "press flex size-8 shrink-0 items-center justify-center rounded-full text-subtle-foreground hover:bg-selected hover:text-foreground [&_svg]:size-4";

/**
 * What's playing, in the top bar on computers: artwork, title, back,
 * play/pause and skip, with a thin progress line. Click the title for the
 * full player. Nothing while nothing's in the player.
 */
export function HeaderPlayer({ className }: { className?: string }) {
  const listen = useListen();
  const [open, setOpen] = useState(false);
  if (!listen?.current) return null;
  const { current, playing, loading, position, duration } = listen;
  const progress = duration ? Math.min(1, position / duration) : 0;

  return (
    <>
      <div
        className={cn(
          "relative flex h-10 min-w-0 items-center gap-0.5 overflow-hidden rounded-lg border border-stroke bg-card py-1 pr-1 pl-1",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-w-0 items-center gap-2 rounded-md pr-1.5 text-left"
          aria-label={`Now playing: ${current.title}. Open the player`}
          title={current.show ? `${current.title} · ${current.show}` : current.title}
        >
          <Artwork episode={current} className="size-7 rounded-[5px]" />
          {playing && <Bars />}
          <span className="hidden min-w-0 max-w-52 truncate text-meta font-medium text-foreground lg:block">{current.title}</span>
        </button>
        <button type="button" aria-label="Previous" title="Previous" className={button} onClick={listen.previous}>
          <SkipBack className="fill-current" />
        </button>
        <button type="button" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} className={button} onClick={listen.toggle}>
          {loading && playing ? <Loader2 className="animate-spin" /> : playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </button>
        <button type="button" aria-label="Next" title="Next" className={cn(button, "disabled:opacity-40")} disabled={!listen.hasNext} onClick={listen.next}>
          <SkipForward className="fill-current" />
        </button>
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-muted" aria-hidden>
          <span className="block h-full bg-foreground" style={{ width: `${progress * 100}%` }} />
        </span>
      </div>
      {open && <NowPlaying onClose={() => setOpen(false)} />}
    </>
  );
}

/** Three little bouncing bars, so it's plain at a glance that something is playing. */
function Bars() {
  return (
    <span className="flex h-3 shrink-0 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="playing-bar w-[3px] rounded-full bg-foreground" style={{ animationDelay: `${i * -0.3}s` }} />
      ))}
    </span>
  );
}

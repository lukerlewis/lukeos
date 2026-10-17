"use client";

import { Loader2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useListen } from "./listen-provider";

const button = "press flex size-8 items-center justify-center rounded-full text-subtle-foreground hover:bg-selected hover:text-foreground [&_svg]:size-4";

/** Back, play/pause and skip, for Music's row in the sidebar. Nothing while nothing's in the player. */
export function MiniControls({ className }: { className?: string }) {
  const listen = useListen();
  if (!listen?.current) return null;
  const { playing, loading } = listen;
  return (
    <div className={className}>
      <button type="button" aria-label="Previous" title="Previous" className={button} onClick={listen.previous}>
        <SkipBack className="fill-current" />
      </button>
      <button type="button" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} className={button} onClick={listen.toggle}>
        {loading && playing ? <Loader2 className="animate-spin" /> : playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
      </button>
      <button
        type="button"
        aria-label="Next"
        title="Next"
        className={button}
        disabled={listen.index >= listen.queue.length - 1}
        onClick={listen.next}
      >
        <SkipForward className="fill-current" />
      </button>
    </div>
  );
}

"use client";

import { Check, CircleCheck, Ellipsis, ListPlus, Pencil, Play, Plus, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Episode } from "@/core/listen";
import { fileSize } from "@/lib/archive";
import { hide, unhide, useHidden } from "@/lib/background";
import { playLength } from "@/lib/listen";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { useListen, type PlayerEpisode } from "./listen-provider";
import { Artwork } from "./player-bar";
import { useSelection } from "./selection";

export type PlaylistSummary = { id: string; title: string };

export const toPlayer = (e: Episode): PlayerEpisode => ({
  id: e.id,
  title: e.title,
  show: e.show,
  src: e.src,
  artworkUrl: e.artworkUrl,
  durationSeconds: e.durationSeconds,
  positionSeconds: e.positionSeconds,
  kind: e.kind,
});

/** "42 min", or "23 min left" once started. */
function lengthLine(e: Episode) {
  if (!e.durationSeconds) return null;
  if (!e.finishedAt && e.positionSeconds > 30) return `${playLength(e.durationSeconds - e.positionSeconds)} left`;
  return playLength(e.durationSeconds);
}

/** One episode or song in a list: tap to play it (and the rest of the list after it). */
export function EpisodeRow({
  episode,
  queue,
  playlists,
  inPlaylist,
  extra,
}: {
  episode: Episode;
  /** What plays after it. */
  queue: Episode[];
  playlists: PlaylistSummary[];
  /** On a playlist's screen: that playlist, so the menu can take it off or move it. */
  inPlaylist?: { id: string; order: string[] };
  extra?: React.ReactNode;
}) {
  const listen = useListen();
  const selection = useSelection();
  const [menu, setMenu] = useState(false);
  const isHidden = useHidden(episode.id);
  if (isHidden) return null;
  const current = listen?.current?.id === episode.id;
  const progress = episode.durationSeconds && !episode.finishedAt ? Math.min(1, episode.positionSeconds / episode.durationSeconds) : 0;
  const line = [episode.show, lengthLine(episode)].filter(Boolean).join(" · ");
  const selecting = !!selection?.selecting;
  const on = !!selection?.picked.has(episode.id);

  return (
    <li className={cn("flex items-center gap-1 border-b pr-1 last:border-b-0", on && "bg-muted/60")}>
      <button
        type="button"
        aria-pressed={selecting ? on : undefined}
        onClick={() =>
          selecting ? selection!.toggle(episode.id) : current ? listen?.toggle() : listen?.play(toPlayer(episode), queue.map(toPlayer))
        }
        className={cn("press-tint flex min-h-16 min-w-0 grow items-center gap-3 py-2.5 pl-3 text-left hover:bg-muted/50", selecting && "pr-3")}
      >
        {selecting && (
          <span
            className={cn(
              "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border md:size-4",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-card",
            )}
            aria-hidden
          >
            {on && <Check className="size-3" />}
          </span>
        )}
        <Artwork episode={episode} className="size-12" />
        <span className="min-w-0 grow">
          <span className={cn("line-clamp-2 text-preview font-medium", episode.finishedAt && "text-muted-foreground")}>{episode.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-meta text-muted-foreground">
            {current && <span className="font-medium text-foreground">{listen?.playing ? "Playing" : "Paused"}</span>}
            {current && line && <span aria-hidden>·</span>}
            <span className="truncate">{line}</span>
            <ClaudeBadge madeBy={episode.madeBy} />
          </span>
          {progress > 0.01 && (
            <span className="mt-1.5 block h-0.5 w-24 overflow-hidden rounded-full bg-grey-300" aria-hidden>
              <span className="block h-full bg-foreground" style={{ width: `${progress * 100}%` }} />
            </span>
          )}
        </span>
      </button>
      {!selecting && (
        <>
          {extra}
          <button
            type="button"
            aria-label={`Options for ${episode.title}`}
            onClick={() => setMenu(true)}
            className="press flex size-11 shrink-0 items-center justify-center rounded-full text-icon hover:bg-muted"
          >
            <Ellipsis className="size-5" aria-hidden />
          </button>
        </>
      )}
      {menu && (
        <EpisodeMenu
          episode={episode}
          queue={queue}
          playlists={playlists}
          inPlaylist={inPlaylist}
          onSelect={selection && (() => selection.start(episode.id))}
          onClose={() => setMenu(false)}
        />
      )}
    </li>
  );
}

/** Deletes an episode for good (no Trash), hiding it at once. */
export async function deleteEpisode(episode: Pick<Episode, "id" | "title">, forget?: (id: string) => void) {
  hide(episode.id);
  try {
    await op("delete_episode", { id: episode.id });
    forget?.(episode.id);
    showToast("Deleted");
  } catch (err) {
    unhide(episode.id);
    showToast((err as Error).message);
  }
}

function EpisodeMenu({
  episode,
  queue,
  playlists,
  inPlaylist,
  onSelect,
  onClose,
}: {
  episode: Episode;
  queue: Episode[];
  playlists: PlaylistSummary[];
  inPlaylist?: { id: string; order: string[] };
  /** Starts picking several, this one first. */
  onSelect?: (() => void) | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const listen = useListen();
  const [view, setView] = useState<"menu" | "playlists" | "rename" | "delete">("menu");
  const [title, setTitle] = useState(episode.title);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await work();
      if (done) showToast(done);
      onClose();
      router.refresh();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const at = inPlaylist ? inPlaylist.order.indexOf(episode.id) : -1;
  const move = (by: number) => {
    const order = [...inPlaylist!.order];
    order.splice(at, 1);
    order.splice(at + by, 0, episode.id);
    return run(() => op("update_playlist", { id: inPlaylist!.id, episodeIds: order }));
  };

  const item = "press-tint flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-control font-medium hover:bg-muted disabled:text-disabled";

  return (
    <Dialog label={episode.title} onClose={onClose} focusFirstField={false}>
      <div className="flex flex-col gap-3 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <div className="flex items-center gap-3 px-1">
          <Artwork episode={episode} className="size-12" />
          <div className="min-w-0">
            <p className="line-clamp-2 text-preview font-medium">{episode.title}</p>
            <p className="truncate text-meta text-muted-foreground">
              {[episode.show, episode.bytes ? fileSize(episode.bytes) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        {view === "menu" && (
          <div className="flex flex-col">
            <button type="button" className={item} onClick={() => { listen?.play(toPlayer(episode), queue.map(toPlayer)); onClose(); }}>
              <Play className="size-[18px] text-muted-foreground" aria-hidden />
              Play
            </button>
            <button type="button" className={item} onClick={() => setView("playlists")}>
              <ListPlus className="size-[18px] text-muted-foreground" aria-hidden />
              Add to playlist
            </button>
            {onSelect && (
              <button type="button" className={item} onClick={() => { onSelect(); onClose(); }}>
                <CircleCheck className="size-[18px] text-muted-foreground" aria-hidden />
                Select
              </button>
            )}
            {inPlaylist && (
              <>
                <button type="button" className={item} disabled={busy || at <= 0} onClick={() => void move(-1)}>
                  <span className="w-[18px] text-center text-muted-foreground" aria-hidden>↑</span>
                  Move up
                </button>
                <button type="button" className={item} disabled={busy || at < 0 || at >= inPlaylist.order.length - 1} onClick={() => void move(1)}>
                  <span className="w-[18px] text-center text-muted-foreground" aria-hidden>↓</span>
                  Move down
                </button>
                <button
                  type="button"
                  className={item}
                  disabled={busy}
                  onClick={() => void run(() => op("remove_from_playlist", { playlistId: inPlaylist.id, episodeIds: [episode.id] }), "Taken off the playlist")}
                >
                  <Undo2 className="size-[18px] text-muted-foreground" aria-hidden />
                  Take off this playlist
                </button>
              </>
            )}
            <button
              type="button"
              className={item}
              disabled={busy}
              onClick={() => void run(() => op("update_episode", { id: episode.id, finished: !episode.finishedAt }))}
            >
              <Check className="size-[18px] text-muted-foreground" aria-hidden />
              {episode.finishedAt ? "Mark as not finished" : "Mark as finished"}
            </button>
            <button type="button" className={item} onClick={() => setView("rename")}>
              <Pencil className="size-[18px] text-muted-foreground" aria-hidden />
              Rename
            </button>
            <button type="button" className={cn(item, "hover:text-danger")} onClick={() => setView("delete")}>
              <Trash2 className="size-[18px] text-muted-foreground" aria-hidden />
              Delete
            </button>
          </div>
        )}

        {view === "playlists" && (
          <div className="flex flex-col">
            {playlists.map((p) => (
              <button
                key={p.id}
                type="button"
                className={item}
                disabled={busy}
                onClick={() => void run(() => op("add_to_playlist", { playlistId: p.id, episodeIds: [episode.id] }), `Added to ${p.title}`)}
              >
                {p.title}
              </button>
            ))}
            <NewPlaylistInline episodeIds={[episode.id]} onDone={() => { onClose(); router.refresh(); }} />
          </div>
        )}

        {view === "rename" && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) void run(() => op("update_episode", { id: episode.id, title: title.trim() }));
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Title"
              autoFocus
              className="h-11 rounded-lg border border-stroke-strong bg-card px-3 text-base md:text-control"
            />
            <Button type="submit" disabled={busy || !title.trim()}>
              Save
            </Button>
          </form>
        )}

        {view === "delete" && (
          <div className="flex flex-col gap-3 px-1">
            <p className="text-preview text-muted-foreground">
              This skips Trash, so it can&apos;t be brought back.
              {episode.kind === "upload" ? " The file is deleted, freeing up its storage." : ""}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="grow" onClick={() => setView("menu")}>
                Cancel
              </Button>
              <Button
                className="grow"
                onClick={() => {
                  onClose();
                  void deleteEpisode(episode, listen?.forget).then(() => router.refresh());
                }}
              >
                Delete for good
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** "New playlist" with a name box, used when adding to a playlist and on the Playlists tab. */
export function NewPlaylistInline({
  episodeIds,
  onDone,
  startOpen,
}: {
  episodeIds?: string[];
  onDone: (id: string) => void;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!startOpen);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press-tint flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-control font-medium text-muted-foreground hover:bg-muted"
      >
        <Plus className="size-[18px]" aria-hidden />
        New playlist
      </button>
    );
  return (
    <form
      className="flex gap-2 p-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          const p = await op("create_playlist", { title: title.trim(), ...(episodeIds?.length && { episodeIds }) });
          showToast(episodeIds?.length ? `Added to ${p.title}` : "Playlist made");
          onDone(p.id);
        } catch (err) {
          showToast((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Playlist name"
        aria-label="Playlist name"
        autoFocus
        className="h-11 min-w-0 grow rounded-lg border border-stroke-strong bg-card px-3 text-base md:text-control"
      />
      <Button type="submit" disabled={busy || !title.trim()}>
        Make
      </Button>
    </form>
  );
}

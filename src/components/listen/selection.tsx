"use client";

import { ListPlus, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Episode } from "@/core/listen";
import { hide, unhide } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { NewPlaylistInline, type PlaylistSummary } from "./episode-row";
import { useListen } from "./listen-provider";

type Selection = {
  selecting: boolean;
  picked: Set<string>;
  toggle: (id: string) => void;
  /** Starts selecting, with this song already picked. */
  start: (id: string) => void;
};

const SelectionContext = createContext<Selection | null>(null);

/** Null outside a selectable list. */
export function useSelection() {
  return useContext(SelectionContext);
}

/** Wraps a list of songs so the ⋯ menu's Select can pick several, with a bar of bulk actions below. */
export function SelectableSongs({
  episodes,
  playlists,
  inPlaylist,
  noun = "song",
  children,
}: {
  /** The songs on screen, for Select all. */
  episodes: Episode[];
  playlists: PlaylistSummary[];
  /** On a playlist's screen: that playlist, so the bar can take songs off it. */
  inPlaylist?: string;
  noun?: "song" | "podcast";
  children: React.ReactNode;
}) {
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selection: Selection = {
    selecting: !!picked,
    picked: picked ?? new Set(),
    toggle: (id) =>
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    start: (id) => setPicked(new Set([id])),
  };
  const ids = picked ? episodes.filter((e) => picked.has(e.id)).map((e) => e.id) : [];

  return (
    <SelectionContext.Provider value={selection}>
      <div className="flex w-full max-w-3xl flex-col gap-6">
        {children}
        {picked && (
          <SelectionBar
            ids={ids}
            allPicked={ids.length === episodes.length}
            onAll={() => setPicked(new Set(ids.length === episodes.length ? [] : episodes.map((e) => e.id)))}
            onDone={() => setPicked(null)}
            playlists={playlists}
            inPlaylist={inPlaylist}
            noun={noun}
          />
        )}
      </div>
    </SelectionContext.Provider>
  );
}

function SelectionBar({
  ids,
  allPicked,
  onAll,
  onDone,
  playlists,
  inPlaylist,
  noun,
}: {
  ids: string[];
  allPicked: boolean;
  onAll: () => void;
  onDone: () => void;
  playlists: PlaylistSummary[];
  inPlaylist?: string;
  noun: "song" | "podcast";
}) {
  const router = useRouter();
  const listen = useListen();
  const [open, setOpen] = useState<null | "playlists" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const songs = `${ids.length} ${noun}${ids.length === 1 ? "" : "s"}`;

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await work();
      showToast(done);
      setOpen(null);
      onDone();
      router.refresh();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll() {
    setOpen(null);
    onDone();
    hide(...ids);
    const results = await Promise.allSettled(ids.map((id) => op("delete_episode", { id })));
    results.forEach((r, i) => (r.status === "fulfilled" ? listen?.forget(ids[i]) : unhide(ids[i])));
    const failed = results.filter((r) => r.status === "rejected").length;
    showToast(failed ? `Couldn't delete ${failed} of them. Try again.` : `Deleted ${songs}`);
    router.refresh();
  }

  const item = "press-tint flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-control font-medium hover:bg-muted disabled:text-disabled";

  return (
    <>
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem+var(--player-space))] z-10 flex flex-wrap items-center gap-2 rounded-xl border border-stroke bg-card p-2 md:bottom-4">
        <span className="px-2 text-control font-medium">{ids.length} selected</span>
        <Button variant="ghost" size="sm" onClick={onAll}>
          {allPicked ? "Select none" : "Select all"}
        </Button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!ids.length} onClick={() => setOpen("playlists")}>
            <ListPlus aria-hidden />
            Add to playlist
          </Button>
          {inPlaylist && (
            <Button
              variant="outline"
              size="sm"
              disabled={!ids.length || busy}
              onClick={() => void run(() => op("remove_from_playlist", { playlistId: inPlaylist, episodeIds: ids }), `Took ${songs} off the playlist`)}
            >
              <Undo2 aria-hidden />
              Take off
            </Button>
          )}
          <Button variant="danger" size="sm" disabled={!ids.length} onClick={() => setOpen("delete")}>
            <Trash2 aria-hidden />
            Delete
          </Button>
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        </span>
      </div>
      {open && (
        <Dialog label={open === "playlists" ? `Add ${songs} to a playlist` : `Delete ${songs}?`} onClose={() => setOpen(null)} focusFirstField={false}>
          <div className="flex flex-col gap-3 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <h2 className="px-1 text-heading font-medium">{open === "playlists" ? `Add ${songs} to` : `Delete ${songs}?`}</h2>
            {open === "playlists" ? (
              <div className="flex flex-col">
                {playlists
                  .filter((p) => p.id !== inPlaylist)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={item}
                      disabled={busy}
                      onClick={() => void run(() => op("add_to_playlist", { playlistId: p.id, episodeIds: ids }), `Added ${songs} to ${p.title}`)}
                    >
                      {p.title}
                    </button>
                  ))}
                <NewPlaylistInline
                  episodeIds={ids}
                  onDone={() => {
                    setOpen(null);
                    onDone();
                    router.refresh();
                  }}
                />
              </div>
            ) : (
              <>
                <p className="px-1 text-preview text-muted-foreground">This skips Trash, so they can&apos;t be brought back. Uploaded files are deleted, freeing up storage.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="grow" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                  <Button className="grow" onClick={() => void deleteAll()}>
                    Delete for good
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

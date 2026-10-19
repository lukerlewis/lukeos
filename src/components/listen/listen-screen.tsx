"use client";

import { Check, ChevronRight, Mic, Music, Play, Plus, Search, Shuffle, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import type { Episode } from "@/core/listen";
import { useWithoutHidden } from "@/lib/background";
import { playLength } from "@/lib/listen";
import { op } from "@/lib/ops-client";
import { showToast } from "@/components/shell/toast";
import { cn } from "@/lib/utils";
import { deleteEpisode, EpisodeRow, NewPlaylistInline, toPlayer, type PlaylistSummary } from "./episode-row";
import { useListen } from "./listen-provider";
import { Artwork } from "./player-bar";
import { PlaylistCover } from "./playlist-icon";
import { SelectableSongs } from "./selection";

type Playlist = PlaylistSummary & { icon: string | null; count: number; seconds: number; artworkUrl: string | null };

/** All songs' Play and Shuffle: Luke's playlists (to pick ones to leave out) and the songs they skip because of them. */
export type ShuffleSettings = {
  playlists: (PlaylistSummary & { icon: string | null; artworkUrl: string | null; excludedFromShuffle: boolean })[];
  skip: string[];
};

/** Which tracks a list shows: everything, or just podcast episodes (not uploads, however long). */
export type TrackFilter = "songs" | "podcasts";

const pick = (episodes: Episode[], filter: TrackFilter) => episodes.filter((e) => e.kind === (filter === "podcasts" ? "podcast" : "upload"));
/** Lowercase, without accents, so "gymnopedie" finds "Gymnopédie". */
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Every word typed has to show up in the title or the artist, in any order. */
function matches(e: Episode, query: string) {
  const haystack = plain(`${e.title} ${e.show ?? ""}`);
  return plain(query).split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

const totalSeconds = (episodes: Episode[]) => episodes.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);

/** Music's screen: finished things to decide on, then a card with All songs and Podcasts, and a card of playlists. */
export function ListenScreen({ episodes: all, playlists }: { episodes: Episode[]; playlists: Playlist[] }) {
  const episodes = useWithoutHidden(all);
  const toDecide = episodes.filter((e) => e.kind === "podcast" && e.finishedAt && !e.kept);
  const shelved = episodes.filter((e) => !toDecide.includes(e));
  const songs = pick(shelved, "songs");
  const podcasts = pick(shelved, "podcasts");

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {toDecide.length > 0 && <Finished episodes={toDecide} />}
      <Card>
        <ul>
          <LibraryRow href="/listen/tracks" title="All songs" icon={<Music />} count={songs.length} seconds={totalSeconds(songs)} />
          <LibraryRow href="/listen/podcasts" title="Podcasts" icon={<Mic />} count={podcasts.length} seconds={totalSeconds(podcasts)} />
        </ul>
      </Card>
      {playlists.length > 0 && (
        <Card>
          <ul>
            {playlists.map((p) => (
              <LibraryRow
                key={p.id}
                href={`/listen/playlists/${p.id}`}
                title={p.title}
                cover={<PlaylistCover playlist={p} className="size-12" />}
                count={p.count}
                seconds={p.seconds}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function LibraryRow({
  href,
  title,
  icon,
  cover,
  count,
  seconds,
}: {
  href: string;
  title: string;
  icon?: React.ReactNode;
  cover?: React.ReactNode;
  count: number;
  seconds: number;
}) {
  return (
    <li className="border-b last:border-b-0">
      <Link href={href} className="press-tint flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
        {cover ?? (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-icon [&_svg]:size-6" aria-hidden>
            {icon}
          </span>
        )}
        <span className="min-w-0 grow">
          <span className="block truncate text-preview font-medium">{title}</span>
          <span className="block text-meta text-muted-foreground">
            {count} {count === 1 ? "item" : "items"}
            {seconds > 0 && ` · ${playLength(seconds)}`}
          </span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

/** "New playlist" at the top of Music's screen. */
export function NewPlaylistButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        New playlist
      </Button>
      {open && (
        <Dialog label="New playlist" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3 p-5">
            <h2 className="text-heading font-medium">New playlist</h2>
            <NewPlaylistInline
              startOpen
              onDone={(id) => {
                setOpen(false);
                router.refresh();
                router.push(`/listen/playlists/${id}`);
              }}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}

/** All songs (Luke's uploaded MP3s and FLACs) or podcasts: what's waiting (first added plays first), then what's finished and kept. */
export function TracksScreen({
  episodes: all,
  playlists,
  filter,
  shuffle,
}: {
  episodes: Episode[];
  playlists: PlaylistSummary[];
  filter: TrackFilter;
  /** On All songs: the settings button beside Shuffle, and the songs Play and Shuffle leave out. */
  shuffle?: ShuffleSettings;
}) {
  const listen = useListen();
  const [query, setQuery] = useState("");
  const everything = pick(useWithoutHidden(all), filter);
  const episodes = query.trim() ? everything.filter((e) => matches(e, query)) : everything;
  // Songs never count as finished (older ones may still be marked); only podcast episodes do.
  const isDone = (e: Episode) => e.kind === "podcast" && !!e.finishedAt;
  const waiting = episodes.filter((e) => !isDone(e)).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const finished = episodes.filter((e) => isDone(e) && e.kept);
  const noun = filter === "podcasts" ? "podcasts" : "songs";
  const skip = new Set(shuffle?.skip);
  // All songs' Play and Shuffle both leave out the songs in playlists Luke picked.
  const toPlay = waiting.filter((e) => !skip.has(e.id));

  return (
    <SelectableSongs episodes={[...waiting, ...finished]} playlists={playlists} noun={filter === "podcasts" ? "podcast" : "song"}>
      {everything.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {waiting.length > 0 && (
            <span className="flex gap-2">
              <Button disabled={!toPlay.length} onClick={() => listen?.play(toPlayer(toPlay[0]), toPlay.map(toPlayer))}>
                <Play className="fill-current" aria-hidden />
                Play
              </Button>
              <Button variant="outline" disabled={!toPlay.length} onClick={() => listen?.playShuffled(toPlay.map(toPlayer))}>
                <Shuffle aria-hidden />
                Shuffle
              </Button>
              {shuffle && <ShuffleSettingsButton playlists={shuffle.playlists} />}
            </span>
          )}
          <label className="relative flex min-w-0 grow items-center md:max-w-80">
            <Search className="pointer-events-none absolute left-3 size-[18px] text-icon" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${noun}`}
              aria-label={`Search ${noun}`}
              className="h-11 w-full rounded-lg border border-stroke-strong bg-card pr-10 pl-10 text-base md:text-control [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="press absolute right-1 flex size-9 items-center justify-center rounded-full text-icon hover:bg-muted"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </label>
        </div>
      )}
      <Card>
        {waiting.length === 0 ? (
          <EmptyState>
            {query.trim() ? (
              finished.length ? `Nothing waiting matches “${query.trim()}”.` : `No ${noun} match “${query.trim()}”.`
            ) : (
              <>
                {filter === "podcasts" ? "No podcasts waiting." : "No songs yet."}
                <span className="hidden md:inline">{filter === "podcasts" ? " Add one with the Add button." : " Upload MP3s or FLACs with the Add button."}</span>
              </>
            )}
          </EmptyState>
        ) : (
          <ul>
            {waiting.map((e) => (
              <EpisodeRow key={e.id} episode={e} queue={waiting} playlists={playlists} />
            ))}
          </ul>
        )}
      </Card>
      {finished.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">Finished</h2>
          <Card>
            <ul>
              {finished.map((e) => (
                <EpisodeRow key={e.id} episode={e} queue={[e]} playlists={playlists} />
              ))}
            </ul>
          </Card>
        </section>
      )}
    </SelectableSongs>
  );
}

/** Beside All songs' Shuffle: pick playlists whose songs Play and Shuffle leave out. */
function ShuffleSettingsButton({ playlists }: { playlists: ShuffleSettings["playlists"] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Ticks show at once; the server catches up behind them.
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const isOut = (p: ShuffleSettings["playlists"][number]) => excluded[p.id] ?? p.excludedFromShuffle;
  const outCount = playlists.filter(isOut).length;

  function flip(p: ShuffleSettings["playlists"][number]) {
    const next = !isOut(p);
    setExcluded((prev) => ({ ...prev, [p.id]: next }));
    op("update_playlist", { id: p.id, excludeFromShuffle: next }).then(
      () => router.refresh(),
      (err: Error) => {
        setExcluded((prev) => ({ ...prev, [p.id]: !next }));
        showToast(err.message);
      },
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label="Shuffle settings"
        title="Shuffle settings"
        className="relative"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden />
        {outCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-tag text-background" aria-hidden>
            {outCount}
          </span>
        )}
      </Button>
      {open && (
        <Dialog label="Leave out of shuffle" onClose={() => setOpen(false)} focusFirstField={false}>
          <div className="flex flex-col gap-3 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <h2 className="px-1 text-heading font-medium">Leave out of shuffle</h2>
            {playlists.length === 0 ? (
              <p className="px-1 text-preview text-muted-foreground">No playlists yet.</p>
            ) : (
              <ul className="-mx-1 max-h-[60vh] overflow-y-auto">
                {playlists.map((p) => {
                  const on = isOut(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => flip(p)}
                        className="press-tint flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                      >
                        <PlaylistCover playlist={p} className="size-9 text-[20px]" />
                        <span className="min-w-0 grow truncate text-control">{p.title}</span>
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-md border border-stroke-strong",
                            on && "border-primary bg-primary text-primary-foreground",
                          )}
                          aria-hidden
                        >
                          {on && <Check className="size-3.5" strokeWidth={3} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Finished episodes Luke hasn't said to keep or delete yet. */
function Finished({ episodes }: { episodes: Episode[] }) {
  const router = useRouter();
  const listen = useListen();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">Finished. Delete them?</h2>
      <Card>
        <ul>
          {episodes.map((e) => (
            <li key={e.id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
              <Artwork episode={e} className="size-10" />
              <span className="min-w-0 grow">
                <span className="block truncate text-preview font-medium">{e.title}</span>
                {e.show && <span className="block truncate text-meta text-muted-foreground">{e.show}</span>}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void op("update_episode", { id: e.id, kept: true }).then(
                    () => router.refresh(),
                    (err: Error) => showToast(err.message),
                  )
                }
              >
                Keep
              </Button>
              <Button size="sm" onClick={() => void deleteEpisode(e, listen?.forget).then(() => router.refresh())}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** A playlist's screen: play it all, or change its order. */
export function PlaylistScreen({
  playlist,
  playlists,
}: {
  playlist: { id: string; title: string; episodes: Episode[] };
  playlists: PlaylistSummary[];
}) {
  const listen = useListen();
  const episodes = useWithoutHidden(playlist.episodes);
  const order = episodes.map((e) => e.id);
  const firstUnfinished = episodes.find((e) => !e.finishedAt) ?? episodes[0];
  return (
    <SelectableSongs episodes={episodes} playlists={playlists} inPlaylist={playlist.id}>
      {episodes.length > 0 && (
        <span className="flex gap-2">
          <Button onClick={() => listen?.play(toPlayer(firstUnfinished), episodes.map(toPlayer))}>
            <Play className="fill-current" aria-hidden />
            Play
          </Button>
          <Button variant="outline" onClick={() => listen?.playShuffled(episodes.map(toPlayer))}>
            <Shuffle aria-hidden />
            Shuffle
          </Button>
        </span>
      )}
      <Card>
        {episodes.length === 0 ? (
          <EmptyState>Nothing on this playlist yet. Add songs or podcasts with the ⋯ button on them.</EmptyState>
        ) : (
          <ul>
            {episodes.map((e) => (
              <EpisodeRow key={e.id} episode={e} queue={episodes} playlists={playlists} inPlaylist={{ id: playlist.id, order }} />
            ))}
          </ul>
        )}
      </Card>
    </SelectableSongs>
  );
}

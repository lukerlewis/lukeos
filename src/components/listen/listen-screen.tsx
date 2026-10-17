"use client";

import { ChevronRight, Mic, Music, Play, Plus, Search, Shuffle, X } from "lucide-react";
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
import { deleteEpisode, EpisodeRow, NewPlaylistInline, toPlayer, type PlaylistSummary } from "./episode-row";
import { useListen } from "./listen-provider";
import { Artwork } from "./player-bar";
import { PlaylistCover } from "./playlist-icon";
import { SelectableSongs } from "./selection";

type Playlist = PlaylistSummary & { icon: string | null; count: number; seconds: number; artworkUrl: string | null };

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
}: {
  episodes: Episode[];
  playlists: PlaylistSummary[];
  filter: TrackFilter;
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

  return (
    <SelectableSongs episodes={[...waiting, ...finished]} playlists={playlists} noun={filter === "podcasts" ? "podcast" : "song"}>
      {everything.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {waiting.length > 0 && (
            <span className="flex gap-2">
              <Button onClick={() => listen?.play(toPlayer(waiting[0]), waiting.map(toPlayer))}>
                <Play className="fill-current" aria-hidden />
                Play
              </Button>
              <Button variant="outline" onClick={() => listen?.playShuffled(waiting.map(toPlayer))}>
                <Shuffle aria-hidden />
                Shuffle
              </Button>
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

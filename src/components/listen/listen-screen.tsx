"use client";

import { ChevronRight, Mic, Music, Play, Plus } from "lucide-react";
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

type Playlist = PlaylistSummary & { icon: string | null; count: number; seconds: number; artworkUrl: string | null };

/** Which tracks a list shows: everything, or just podcast episodes (not uploads, however long). */
export type TrackFilter = "all" | "podcasts";

const pick = (episodes: Episode[], filter: TrackFilter) => (filter === "podcasts" ? episodes.filter((e) => e.kind === "podcast") : episodes);
const totalSeconds = (episodes: Episode[]) => episodes.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);

/** Music's screen: finished things to decide on, then a card with All tracks and Podcasts, and a card of playlists. */
export function ListenScreen({ episodes: all, playlists }: { episodes: Episode[]; playlists: Playlist[] }) {
  const episodes = useWithoutHidden(all);
  const toDecide = episodes.filter((e) => e.finishedAt && !e.kept);
  const shelved = episodes.filter((e) => !e.finishedAt || e.kept);
  const podcasts = pick(shelved, "podcasts");

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {toDecide.length > 0 && <Finished episodes={toDecide} />}
      <Card>
        <ul>
          <LibraryRow href="/listen/tracks" title="All tracks" icon={<Music />} count={shelved.length} seconds={totalSeconds(shelved)} />
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

/** All tracks, or just podcasts: what's waiting (first added plays first), then what's finished and kept. */
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
  const episodes = pick(useWithoutHidden(all), filter);
  const waiting = episodes.filter((e) => !e.finishedAt).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const finished = episodes.filter((e) => e.finishedAt && e.kept);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {waiting.length > 0 && (
        <Button className="self-start" onClick={() => listen?.play(toPlayer(waiting[0]), waiting.map(toPlayer))}>
          <Play className="fill-current" aria-hidden />
          Play
        </Button>
      )}
      <Card>
        {waiting.length === 0 ? (
          <EmptyState>
            {filter === "podcasts" ? "No podcasts waiting." : "Nothing to listen to."}
            <span className="hidden md:inline"> Add a podcast episode or upload an MP3.</span>
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
    </div>
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
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {episodes.length > 0 && (
        <Button className="self-start" onClick={() => listen?.play(toPlayer(firstUnfinished), episodes.map(toPlayer))}>
          <Play className="fill-current" aria-hidden />
          Play
        </Button>
      )}
      <Card>
        {episodes.length === 0 ? (
          <EmptyState>Nothing on this playlist yet. Add things from All tracks with the ⋯ button.</EmptyState>
        ) : (
          <ul>
            {episodes.map((e) => (
              <EpisodeRow key={e.id} episode={e} queue={episodes} playlists={playlists} inPlaylist={{ id: playlist.id, order }} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

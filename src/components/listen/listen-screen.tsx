"use client";

import { ChevronRight, ListMusic, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import type { Episode } from "@/core/listen";
import { useWithoutHidden } from "@/lib/background";
import { playLength } from "@/lib/listen";
import { op } from "@/lib/ops-client";
import { showToast } from "@/components/shell/toast";
import { deleteEpisode, EpisodeRow, NewPlaylistInline, toPlayer, type PlaylistSummary } from "./episode-row";
import { useListen } from "./listen-provider";
import { Artwork } from "./player-bar";

type Playlist = PlaylistSummary & { count: number; seconds: number; artworkUrl: string | null };

/** Listen's screen: what's waiting to be listened to, what's finished, and playlists. */
export function ListenScreen({ episodes: all, playlists }: { episodes: Episode[]; playlists: Playlist[] }) {
  const [tab, setTab] = useState<"episodes" | "playlists">("episodes");
  const episodes = useWithoutHidden(all);
  // First added plays first, like a queue.
  const waiting = episodes.filter((e) => !e.finishedAt).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const toDecide = episodes.filter((e) => e.finishedAt && !e.kept);
  const finished = episodes.filter((e) => e.finishedAt && e.kept);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <Segmented
        value={tab}
        onChange={setTab}
        className="md:w-80"
        options={[
          { value: "episodes", label: "Episodes" },
          { value: "playlists", label: "Playlists" },
        ]}
      />
      {tab === "episodes" ? (
        <>
          {toDecide.length > 0 && <Finished episodes={toDecide} />}
          <Card>
            {waiting.length === 0 ? (
              <EmptyState>
                Nothing to listen to.<span className="hidden md:inline"> Add a podcast episode or upload an MP3.</span>
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
        </>
      ) : (
        <Playlists playlists={playlists} />
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

function Playlists({ playlists }: { playlists: Playlist[] }) {
  const router = useRouter();
  return (
    <Card>
      <ul>
        {playlists.map((p) => (
          <li key={p.id} className="border-b">
            <Link href={`/listen/playlists/${p.id}`} className="press-tint flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
              {p.artworkUrl ? (
                <Artwork episode={p} className="size-12" />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-icon" aria-hidden>
                  <ListMusic className="size-5" />
                </span>
              )}
              <span className="min-w-0 grow">
                <span className="block truncate text-preview font-medium">{p.title}</span>
                <span className="block text-meta text-muted-foreground">
                  {p.count} {p.count === 1 ? "item" : "items"}
                  {p.seconds > 0 && ` · ${playLength(p.seconds)}`}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
        <li className="p-1">
          <NewPlaylistInline
            onDone={(id) => {
              router.refresh();
              router.push(`/listen/playlists/${id}`);
            }}
          />
        </li>
      </ul>
    </Card>
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
          <EmptyState>Nothing on this playlist yet. Add things from Episodes with the ⋯ button.</EmptyState>
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

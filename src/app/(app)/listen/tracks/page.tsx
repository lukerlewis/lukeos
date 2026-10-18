import type { Metadata } from "next";
import Link from "next/link";
import { AddButton } from "@/components/listen/add-dialog";
import { TracksScreen } from "@/components/listen/listen-screen";
import { Page } from "@/components/shell/page";
import { listEpisodes, listPlaylists, shuffleSkippedEpisodeIds } from "@/core/listen";
import { storageUsage } from "@/lib/storage";

export const metadata: Metadata = { title: "All songs · LukeOS" };

export default async function TracksPage() {
  const [episodes, playlists, storage, skip] = await Promise.all([listEpisodes(), listPlaylists(), storageUsage(), shuffleSkippedEpisodeIds()]);
  return (
    <Page
      title="All songs"
      eyebrow={<Link href="/listen" className="hover:text-foreground">Music</Link>}
      newTask={false}
      actions={<AddButton storage={{ used: storage.used, limit: storage.limit }} />}
    >
      <TracksScreen
        episodes={episodes}
        playlists={playlists.map((p) => ({ id: p.id, title: p.title }))}
        filter="songs"
        shuffle={{
          playlists: playlists.map((p) => ({ id: p.id, title: p.title, icon: p.icon, artworkUrl: p.artworkUrl, excludedFromShuffle: p.excludedFromShuffle })),
          skip,
        }}
      />
    </Page>
  );
}

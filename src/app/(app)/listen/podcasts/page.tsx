import type { Metadata } from "next";
import Link from "next/link";
import { AddButton } from "@/components/listen/add-dialog";
import { TracksScreen } from "@/components/listen/listen-screen";
import { Page } from "@/components/shell/page";
import { listEpisodes, listPlaylists } from "@/core/listen";
import { storageUsage } from "@/lib/storage";

export const metadata: Metadata = { title: "Podcasts · LukeOS" };

export default async function PodcastsPage() {
  const [episodes, playlists, storage] = await Promise.all([listEpisodes(), listPlaylists(), storageUsage()]);
  return (
    <Page
      title="Podcasts"
      eyebrow={<Link href="/listen" className="hover:text-foreground">Music</Link>}
      newTask={false}
      actions={<AddButton storage={{ used: storage.used, limit: storage.limit }} />}
    >
      <TracksScreen episodes={episodes} playlists={playlists.map((p) => ({ id: p.id, title: p.title }))} filter="podcasts" />
    </Page>
  );
}

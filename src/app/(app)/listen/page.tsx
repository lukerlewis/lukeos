import type { Metadata } from "next";
import { AddButton } from "@/components/listen/add-dialog";
import { ListenScreen } from "@/components/listen/listen-screen";
import { Page } from "@/components/shell/page";
import { listEpisodes, listPlaylists } from "@/core/listen";
import { storageUsage } from "@/lib/storage";

export const metadata: Metadata = { title: "Listen · LukeOS" };

/** Podcast episodes and MP3s Luke picked himself, and his playlists. Adding happens on computers only. */
export default async function ListenPage() {
  const [episodes, playlists, storage] = await Promise.all([listEpisodes(), listPlaylists(), storageUsage()]);
  return (
    <Page title="Listen" newTask={false} actions={<AddButton storage={{ used: storage.used, limit: storage.limit }} />}>
      <ListenScreen episodes={episodes} playlists={playlists} />
    </Page>
  );
}

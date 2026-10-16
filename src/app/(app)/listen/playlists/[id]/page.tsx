import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlaylistScreen } from "@/components/listen/listen-screen";
import { PlaylistActions } from "@/components/listen/playlist-actions";
import { Page } from "@/components/shell/page";
import { OperationError } from "@/core/define";
import { getPlaylist, listPlaylists } from "@/core/listen";

async function load(id: string) {
  try {
    return await getPlaylist(id);
  } catch (err) {
    if (err instanceof OperationError) return null;
    throw err;
  }
}

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function generateMetadata({ params }: PageProps<"/listen/playlists/[id]">): Promise<Metadata> {
  const { id } = await params;
  const playlist = isUuid(id) ? await load(id) : null;
  return { title: `${playlist?.title ?? "Playlist"} · LukeOS` };
}

export default async function PlaylistPage({ params }: PageProps<"/listen/playlists/[id]">) {
  const { id } = await params;
  const [playlist, playlists] = await Promise.all([isUuid(id) ? load(id) : null, listPlaylists()]);
  if (!playlist) notFound();
  return (
    <Page
      title={playlist.title}
      eyebrow={<Link href="/listen" className="hover:text-foreground">Music</Link>}
      newTask={false}
      actions={<PlaylistActions id={playlist.id} title={playlist.title} />}
    >
      <PlaylistScreen playlist={playlist} playlists={playlists.map((p) => ({ id: p.id, title: p.title }))} />
    </Page>
  );
}

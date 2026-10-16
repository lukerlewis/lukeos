import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MAX_LISTEN_FILE_BYTES, PLAYLIST_ICONS } from "@/lib/listen";
import { PodcastError, readFeed, resolveLink, searchPodcasts, type Feed, type FeedEpisode } from "@/lib/podcasts";
import { adoptBlob, deleteStoredFile, storageUsage, storeFile } from "@/lib/storage";
import { defineOperation, madeByColumns, madeByOf, OperationError, type Actor } from "./define";

/**
 * Listen: Luke's own audio player, instead of Spotify. Nothing streams in on
 * its own: he uploads MP3s himself, or picks single podcast episodes, which
 * play from the podcast's servers and take no storage. Deleting is for good
 * (no Trash), so an uploaded file's space comes back at once.
 */

const { listenEpisodes: episodes, listenPlaylists: playlists, listenPlaylistItems: items } = schema;

type EpisodeRow = typeof episodes.$inferSelect;

export type Episode = ReturnType<typeof episodeOut>;

function episodeOut(r: EpisodeRow) {
  return {
    id: r.id,
    kind: r.kind as "upload" | "podcast",
    title: r.title || r.fileName || "Untitled",
    show: r.show,
    /** Where the app plays it from. */
    src: r.kind === "upload" ? (r.fileId ? `/api/stored/${r.fileId}` : null) : r.audioUrl,
    artworkUrl: r.artworkUrl,
    description: r.description,
    publishedAt: r.publishedAt,
    durationSeconds: r.durationSeconds,
    positionSeconds: r.positionSeconds,
    lastPlayedAt: r.lastPlayedAt,
    finishedAt: r.finishedAt,
    kept: r.kept,
    bytes: r.kind === "upload" ? r.bytes : null,
    madeBy: madeByOf(r),
    createdAt: r.createdAt,
  };
}

async function findEpisode(id: string) {
  const [row] = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
  if (!row) throw new OperationError("No episode with that id.", 404);
  return row;
}

async function findPlaylist(id: string) {
  const [row] = await db.select().from(playlists).where(eq(playlists.id, id)).limit(1);
  if (!row) throw new OperationError("No playlist with that id.", 404);
  return row;
}

/** Turns a problem reaching a podcast into a readable error. */
async function podcasts<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof PodcastError) throw new OperationError(err.message);
    throw err;
  }
}

/** Every episode, newest added first. Unfinished ones first unless asked otherwise. */
export async function listEpisodes(filter: { status?: "unfinished" | "finished" | "all" } = {}) {
  const status = filter.status ?? "all";
  const rows = await db
    .select()
    .from(episodes)
    .where(status === "unfinished" ? isNull(episodes.finishedAt) : status === "finished" ? isNotNull(episodes.finishedAt) : undefined)
    .orderBy(desc(episodes.createdAt));
  return rows.map(episodeOut);
}

export async function listPlaylists() {
  // Raw listen_playlists.id in the subqueries: Drizzle leaves column names unqualified there, which would pick up e.id.
  const rows = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      icon: playlists.icon,
      createdByKind: playlists.createdByKind,
      createdByName: playlists.createdByName,
      createdByRoutine: playlists.createdByRoutine,
      updatedAt: playlists.updatedAt,
      count: sql<number>`(select count(*) from listen_playlist_items i where i.playlist_id = listen_playlists.id)`.mapWith(Number),
      seconds: sql<number>`(select coalesce(sum(e.duration_seconds), 0) from listen_playlist_items i join listen_episodes e on e.id = i.episode_id where i.playlist_id = listen_playlists.id)`.mapWith(Number),
      artworkUrl: sql<string | null>`(select e.artwork_url from listen_playlist_items i join listen_episodes e on e.id = i.episode_id where i.playlist_id = listen_playlists.id and e.artwork_url is not null order by i.position limit 1)`,
    })
    .from(playlists)
    .orderBy(asc(playlists.title));
  return rows.map(({ createdByKind, createdByName, createdByRoutine, ...p }) => ({
    ...p,
    madeBy: madeByOf({ createdByKind, createdByName, createdByRoutine }),
  }));
}

export async function getPlaylist(id: string) {
  const playlist = await findPlaylist(id);
  const rows = await db
    .select({ episode: episodes })
    .from(items)
    .innerJoin(episodes, eq(episodes.id, items.episodeId))
    .where(eq(items.playlistId, id))
    .orderBy(asc(items.position));
  return { id: playlist.id, title: playlist.title, icon: playlist.icon, madeBy: madeByOf(playlist), episodes: rows.map((r) => episodeOut(r.episode)) };
}

/** Puts a playlist's episodes in this order (episodes left out are taken off it). */
async function setPlaylistOrder(playlistId: string, episodeIds: string[]) {
  const ids = [...new Set(episodeIds)];
  if (ids.length) {
    const found = await db.select({ id: episodes.id }).from(episodes).where(inArray(episodes.id, ids));
    if (found.length !== ids.length) throw new OperationError("Some of those episodes don't exist.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(items).where(eq(items.playlistId, playlistId));
    if (ids.length) await tx.insert(items).values(ids.map((episodeId, position) => ({ playlistId, episodeId, position })));
    await tx.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));
  });
}

async function playlistEpisodeIds(playlistId: string) {
  const rows = await db.select({ id: items.episodeId }).from(items).where(eq(items.playlistId, playlistId)).orderBy(asc(items.position));
  return rows.map((r) => r.id);
}

/** Which of a feed's episodes Luke already has. */
async function addedLookup() {
  const rows = await db
    .select({ guid: episodes.guid, audioUrl: episodes.audioUrl, id: episodes.id })
    .from(episodes)
    .where(eq(episodes.kind, "podcast"));
  const byGuid = new Map(rows.filter((r) => r.guid).map((r) => [r.guid!, r.id]));
  const byAudio = new Map(rows.filter((r) => r.audioUrl).map((r) => [r.audioUrl!, r.id]));
  return (e: FeedEpisode) => byGuid.get(e.guid) ?? byAudio.get(e.audioUrl) ?? null;
}

async function showWithEpisodes(feed: Feed, query?: string, limit = 100) {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matching = words.length
    ? feed.episodes.filter((e) => words.every((w) => `${e.title} ${e.description}`.toLowerCase().includes(w)))
    : feed.episodes;
  const added = await addedLookup();
  return {
    show: feed.show,
    total: matching.length,
    episodes: matching.slice(0, limit).map((e) => ({
      ...e,
      description: e.description.slice(0, 600),
      addedId: added(e),
    })),
  };
}

async function insertPodcastEpisode(show: Feed["show"], e: FeedEpisode, actor: Actor) {
  const [existing] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.kind, "podcast"), sql`(${episodes.guid} = ${e.guid} or ${episodes.audioUrl} = ${e.audioUrl})`))
    .limit(1);
  if (existing) return { ...episodeOut(existing), alreadyAdded: true };
  const [row] = await db
    .insert(episodes)
    .values({
      kind: "podcast",
      title: e.title.slice(0, 500),
      show: show.title.slice(0, 300),
      audioUrl: e.audioUrl,
      artworkUrl: e.artworkUrl ?? show.artworkUrl,
      description: e.description,
      feedUrl: show.feedUrl,
      guid: e.guid,
      publishedAt: e.publishedAt ? new Date(e.publishedAt) : null,
      durationSeconds: e.durationSeconds,
      ...madeByColumns(actor),
    })
    .returning();
  return { ...episodeOut(row), alreadyAdded: false };
}

/** Room check before an upload: the store locks for 30 days if it goes over its free allowance. */
export async function assertRoomFor(bytes: number) {
  const usage = await storageUsage();
  if (bytes > MAX_LISTEN_FILE_BYTES) throw new OperationError("That file is over 200 MB.", 413);
  if (usage.full || usage.used + bytes > usage.limit * 0.97)
    throw new OperationError("There isn't room for that file. Delete some episodes or other files to make room.", 507);
  return usage;
}

const cleanTitle = (name: string) => name.replace(/\.(mp3|m4a|aac|wav)$/i, "").replace(/[_]+/g, " ").trim().slice(0, 500) || "Untitled";

type UploadMeta = { name: string; mimeType: string; title?: string | null; artist?: string | null; durationSeconds?: number | null };

async function insertUpload(stored: { id: string; bytes: number }, meta: UploadMeta) {
  const [row] = await db
    .insert(episodes)
    .values({
      kind: "upload",
      title: (meta.title?.trim() || cleanTitle(meta.name)).slice(0, 500),
      show: meta.artist?.trim().slice(0, 300) || null,
      fileId: stored.id,
      fileName: meta.name.slice(0, 300),
      bytes: stored.bytes,
      durationSeconds: meta.durationSeconds ? Math.round(meta.durationSeconds) : null,
      ...madeByColumns({ kind: "user" }),
    })
    .returning();
  return episodeOut(row);
}

/** Keeps a small uploaded MP3 sent through the app (when there's no Blob store, or it's tiny). */
export async function saveListenFile(data: Buffer, meta: UploadMeta) {
  if (!data.length) throw new OperationError("That file is empty.");
  await assertRoomFor(data.length);
  const stored = await storeFile(data, meta.mimeType || "audio/mpeg", "listen");
  return insertUpload(stored, meta);
}

/** Keeps an MP3 the browser put straight into Blob storage. */
export async function adoptListenBlob(input: UploadMeta & { url: string; access: "private" | "public" }) {
  let stored;
  try {
    stored = await adoptBlob(input.url, input.mimeType || "audio/mpeg", input.access);
  } catch {
    throw new OperationError("That upload didn't arrive. Try again.");
  }
  if (stored.bytes > MAX_LISTEN_FILE_BYTES) {
    await deleteStoredFile(stored.id).catch(() => {});
    throw new OperationError("That file is over 200 MB.", 413);
  }
  return insertUpload(stored, input);
}

/** Deletes an episode for good, and its file with it. */
async function removeEpisode(row: EpisodeRow) {
  await db.delete(episodes).where(eq(episodes.id, row.id));
  if (row.fileId) {
    try {
      await deleteStoredFile(row.fileId);
    } catch (err) {
      // The nightly tidy-up deletes files nothing uses, so it goes then instead.
      console.error("[listen] couldn't delete the file now", err);
    }
  }
}

const iconField = z
  .enum(PLAYLIST_ICONS)
  .nullable()
  .optional()
  .describe("The playlist's icon (null: show its first item's artwork). Only change it when Luke asks.");

const episodeIds = z.array(z.uuid()).min(1).max(500);

export const listenOperations = {
  list_episodes: defineOperation({
    name: "list_episodes",
    description:
      "Luke's Listen library: MP3s he uploaded and podcast episodes he picked, newest added first, with how far he got (positionSeconds) and whether he's finished each. status filters to unfinished or finished ones.",
    input: z.object({ status: z.enum(["unfinished", "finished", "all"]).default("all") }),
    run: async ({ status }) => ({ episodes: await listEpisodes({ status }) }),
  }),

  search_podcasts: defineOperation({
    name: "search_podcasts",
    description:
      "Find podcasts by name or topic in Apple's podcast directory. Returns shows with their feedUrl; pass that to get_podcast to see episodes. Searching adds nothing.",
    input: z.object({ query: z.string().trim().min(1).max(200) }),
    run: async ({ query }) => ({ shows: await podcasts(() => searchPodcasts(query)) }),
  }),

  get_podcast: defineOperation({
    name: "get_podcast",
    description:
      "A podcast's episodes, newest first, from its feed (feedUrl from search_podcasts) or a pasted link (an Apple Podcasts show or episode link, or an RSS feed). query narrows them by words in the title or notes. addedId is set on ones already in Luke's library. Nothing is added.",
    input: z.object({
      feedUrl: z.string().max(2000).optional().describe("The show's feed, from search_podcasts."),
      url: z.string().max(2000).optional().describe("Or a pasted Apple Podcasts link or feed address."),
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    run: async ({ feedUrl, url, query, limit }) => {
      if (!feedUrl && !url) throw new OperationError("Pass feedUrl or url.");
      return podcasts(async () => {
        if (feedUrl) return showWithEpisodes(await readFeed(feedUrl), query, limit);
        const found = await resolveLink(url!);
        if (found.kind === "audio") throw new OperationError("That's a single audio file: add it with add_episode.");
        const out = await showWithEpisodes(found.feed, query, limit);
        return found.kind === "episode" ? { ...out, linked: found.episode.guid } : out;
      });
    },
  }),

  add_episode: defineOperation({
    name: "add_episode",
    description:
      "Add one podcast episode to Luke's Listen library. It plays from the podcast's own servers, so it takes no storage. Pass feedUrl and guid (from get_podcast), or a url: an Apple Podcasts episode link or a direct link to an audio file. Only add episodes Luke picked himself: Listen is where he chooses what gets his attention, so never add episodes on your own.",
    input: z.object({
      feedUrl: z.string().max(2000).optional(),
      guid: z.string().max(2000).optional(),
      url: z.string().max(2000).optional(),
      playlistId: z.uuid().optional().describe("Also put it at the end of this playlist."),
    }),
    run: async ({ feedUrl, guid, url, playlistId }, { actor }) => {
      const added = await podcasts(async () => {
        if (feedUrl && guid) {
          const feed = await readFeed(feedUrl);
          const episode = feed.episodes.find((e) => e.guid === guid);
          if (!episode) throw new OperationError("That episode isn't in the show's feed any more.");
          return insertPodcastEpisode(feed.show, episode, actor);
        }
        if (!url) throw new OperationError("Pass feedUrl and guid, or url.");
        const found = await resolveLink(url);
        if (found.kind === "show") throw new OperationError("That's a whole show. Pick an episode from it (get_podcast).");
        if (found.kind === "episode") return insertPodcastEpisode(found.feed.show, found.episode, actor);
        const audio = { guid: found.audioUrl, title: found.title, audioUrl: found.audioUrl, mimeType: null, bytes: null, publishedAt: null, durationSeconds: null, description: "", artworkUrl: null };
        return insertPodcastEpisode({ podcastId: null, title: "", author: null, artworkUrl: null, feedUrl: "" }, audio, actor);
      });
      if (playlistId) {
        await findPlaylist(playlistId);
        const ids = await playlistEpisodeIds(playlistId);
        if (!ids.includes(added.id)) await setPlaylistOrder(playlistId, [...ids, added.id]);
      }
      return added;
    },
  }),

  update_episode: defineOperation({
    name: "update_episode",
    description:
      "Change an episode in Listen: its title or show/artist, where Luke is in it (positionSeconds), whether it's finished, or kept (Luke chose to keep it after finishing). Fields left out stay as they are.",
    input: z.object({
      id: z.uuid(),
      title: z.string().trim().min(1).max(500).optional(),
      show: z.string().max(300).nullable().optional(),
      positionSeconds: z.number().min(0).max(100 * 3600).optional(),
      durationSeconds: z.number().min(1).max(100 * 3600).optional().describe("Only if it was unknown."),
      finished: z.boolean().optional(),
      kept: z.boolean().optional(),
      played: z.boolean().optional().describe("The app sets this as Luke plays it."),
    }),
    run: async (input) => {
      const row = await findEpisode(input.id);
      const [updated] = await db
        .update(episodes)
        .set({
          ...(input.title !== undefined && { title: input.title }),
          ...(input.show !== undefined && { show: input.show?.trim() || null }),
          ...(input.positionSeconds !== undefined && { positionSeconds: Math.round(input.positionSeconds) }),
          ...(input.durationSeconds !== undefined && !row.durationSeconds && { durationSeconds: Math.round(input.durationSeconds) }),
          ...(input.finished !== undefined && {
            finishedAt: input.finished ? (row.finishedAt ?? new Date()) : null,
            ...(input.finished ? {} : { kept: false }),
          }),
          ...(input.finished === true && input.positionSeconds === undefined && { positionSeconds: 0 }),
          ...(input.kept !== undefined && { kept: input.kept }),
          ...(input.played && { lastPlayedAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(episodes.id, input.id))
        .returning();
      return episodeOut(updated);
    },
  }),

  delete_episode: defineOperation({
    name: "delete_episode",
    description:
      "Delete an episode or song from Listen for good. This skips Trash: an uploaded MP3's file is deleted at once to free up storage, and can't be brought back. Only when Luke asks.",
    input: z.object({ id: z.uuid() }),
    run: async ({ id }) => {
      const row = await findEpisode(id);
      await removeEpisode(row);
      return { id, title: episodeOut(row).title, freedBytes: row.kind === "upload" ? (row.bytes ?? 0) : 0 };
    },
  }),

  list_playlists: defineOperation({
    name: "list_playlists",
    description: "Luke's Listen playlists, with how many episodes or songs each holds and their total length in seconds.",
    input: z.object({}),
    run: async () => ({ playlists: await listPlaylists() }),
  }),

  get_playlist: defineOperation({
    name: "get_playlist",
    description: "One Listen playlist with its episodes and songs in order.",
    input: z.object({ id: z.uuid() }),
    run: async ({ id }) => getPlaylist(id),
  }),

  create_playlist: defineOperation({
    name: "create_playlist",
    description: "Make a Listen playlist, optionally with episodes in it (ids from list_episodes) in that order.",
    input: z.object({ title: z.string().trim().min(1).max(200), icon: iconField, episodeIds: z.array(z.uuid()).max(500).optional() }),
    run: async ({ title, icon, episodeIds: ids }, { actor }) => {
      const [row] = await db.insert(playlists).values({ title, icon: icon ?? null, ...madeByColumns(actor) }).returning();
      if (ids?.length) await setPlaylistOrder(row.id, ids);
      return getPlaylist(row.id);
    },
  }),

  update_playlist: defineOperation({
    name: "update_playlist",
    description:
      "Rename a Listen playlist, change its icon, or set its whole order with episodeIds (anything left out is taken off the playlist, not deleted).",
    input: z.object({
      id: z.uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      icon: iconField,
      episodeIds: z.array(z.uuid()).max(500).optional(),
    }),
    run: async ({ id, title, icon, episodeIds: ids }) => {
      await findPlaylist(id);
      if (title !== undefined || icon !== undefined)
        await db
          .update(playlists)
          .set({ ...(title !== undefined && { title }), ...(icon !== undefined && { icon }), updatedAt: new Date() })
          .where(eq(playlists.id, id));
      if (ids) await setPlaylistOrder(id, ids);
      return getPlaylist(id);
    },
  }),

  add_to_playlist: defineOperation({
    name: "add_to_playlist",
    description: "Put episodes or songs at the end of a Listen playlist (ones already on it stay where they are).",
    input: z.object({ playlistId: z.uuid(), episodeIds }),
    run: async ({ playlistId, episodeIds: ids }) => {
      await findPlaylist(playlistId);
      const current = await playlistEpisodeIds(playlistId);
      await setPlaylistOrder(playlistId, [...current, ...ids.filter((i) => !current.includes(i))]);
      return getPlaylist(playlistId);
    },
  }),

  remove_from_playlist: defineOperation({
    name: "remove_from_playlist",
    description: "Take episodes or songs off a Listen playlist. They stay in the library.",
    input: z.object({ playlistId: z.uuid(), episodeIds }),
    run: async ({ playlistId, episodeIds: ids }) => {
      await findPlaylist(playlistId);
      const current = await playlistEpisodeIds(playlistId);
      await setPlaylistOrder(playlistId, current.filter((i) => !ids.includes(i)));
      return getPlaylist(playlistId);
    },
  }),

  delete_playlist: defineOperation({
    name: "delete_playlist",
    description: "Delete a Listen playlist for good. Its episodes stay in the library. Only when Luke asks.",
    input: z.object({ id: z.uuid() }),
    run: async ({ id }) => {
      const row = await findPlaylist(id);
      await db.delete(playlists).where(eq(playlists.id, id));
      return { id, title: row.title };
    },
  }),
};

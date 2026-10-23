"use client";

import { ArrowLeft, Check, Loader2, Plus, Search, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { fileSize } from "@/lib/archive";
import { flacToMp3, isFlac } from "@/lib/flac-to-mp3";
import { isAudioFile, MAX_LISTEN_FILE_BYTES, playLength, readMp3Tags } from "@/lib/listen";
import { DIRECT_UPLOAD_BYTES } from "@/lib/message-files";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { Artwork } from "./player-bar";

/** Text that is one web address (a pasted link), not search words. */
const looksLikeUrl = (text: string) => !/\s/.test(text) && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]\S*)?$/i.test(text);

type Show = Awaited<ReturnType<typeof op<"search_podcasts">>>["shows"][number];
type ShowEpisodes = Awaited<ReturnType<typeof op<"get_podcast">>>;

/** "Add" on Listen's screen, on computers only: pick podcast episodes, or upload MP3s. */
export function AddButton({ storage }: { storage: { used: number; limit: number } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="hidden md:inline-flex">
        <Plus aria-hidden />
        Add
      </Button>
      {open && <AddDialog storage={storage} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddDialog({ storage, onClose }: { storage: { used: number; limit: number }; onClose: () => void }) {
  const [tab, setTab] = useState<"podcast" | "upload">("podcast");
  return (
    <Dialog label="Add to Music" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-heading font-medium">Add to Music</h2>
          <Segmented
            value={tab}
            onChange={setTab}
            className="w-64"
            options={[
              { value: "podcast", label: "Podcast episode" },
              { value: "upload", label: "Upload audio" },
            ]}
          />
        </div>
        {tab === "podcast" ? <PodcastPicker /> : <Uploader storage={storage} />}
      </div>
    </Dialog>
  );
}

function PodcastPicker() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [shows, setShows] = useState<Show[] | null>(null);
  const [show, setShow] = useState<ShowEpisodes | null>(null);
  const [filter, setFilter] = useState("");
  /** Matches for the filter from the show's whole feed, not just the episodes loaded. */
  const [found, setFound] = useState<{ feedUrl: string; query: string; result: ShowEpisodes } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const feedUrl = show?.show.feedUrl;
  const filterQuery = filter.trim();
  useEffect(() => {
    if (!feedUrl || !filterQuery) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const result = await op("get_podcast", { feedUrl, query: filterQuery, limit: 200 });
        if (!stale) setFound({ feedUrl, query: filterQuery, result });
      } catch (err) {
        if (!stale) showToast((err as Error).message);
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [feedUrl, filterQuery]);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    try {
      if (looksLikeUrl(q)) {
        setShow(await op("get_podcast", { url: q }));
        setShows(null);
      } else {
        setShows((await op("search_podcasts", { query: q })).shows);
        setShow(null);
      }
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openShow(s: Show) {
    setBusy(true);
    try {
      const out = await op("get_podcast", { feedUrl: s.feedUrl });
      setShow({ ...out, show: { ...out.show, artworkUrl: out.show.artworkUrl ?? s.artworkUrl, title: s.title || out.show.title } });
      setFilter("");
      setFound(null);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function add(guid: string) {
    if (!show) return;
    setAdding(guid);
    try {
      const ep = await op("add_episode", { feedUrl: show.show.feedUrl, guid });
      setAdded((a) => new Set(a).add(guid));
      showToast(ep.alreadyAdded ? "Already in Music" : "Added");
      router.refresh();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setAdding(null);
    }
  }

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const searched = filterQuery && found && found.feedUrl === feedUrl && found.query === filterQuery ? found.result : null;
  // Until the whole feed answers, narrow the episodes already loaded.
  const episodes = searched?.episodes ?? show?.episodes.filter((e) => words.every((w) => `${e.title} ${e.description}`.toLowerCase().includes(w))) ?? [];
  const searching = Boolean(filterQuery) && !searched;
  const linked = show && "linked" in show ? show.linked : null;

  return (
    <div className="flex min-h-96 flex-col gap-4">
      {!show ? (
        <form onSubmit={find} className="flex gap-2">
          <div className="relative grow">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search podcasts, or paste an Apple Podcasts link"
              aria-label="Search podcasts"
              autoFocus
              className="h-11 w-full rounded-lg border border-stroke-strong bg-card pr-3 pl-9 text-control"
            />
          </div>
          <Button type="submit" disabled={busy || !query.trim()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : "Search"}
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back to search" onClick={() => setShow(null)}>
            <ArrowLeft className="size-5" aria-hidden />
          </Button>
          <Artwork episode={show.show} className="size-12" />
          <div className="min-w-0 grow">
            <p className="truncate text-control font-medium">{show.show.title}</p>
            {show.show.author && <p className="truncate text-meta text-muted-foreground">{show.show.author}</p>}
          </div>
        </div>
      )}

      {!show && shows && (
        <ul className="flex flex-col">
          {shows.length === 0 && <li className="py-6 text-center text-meta text-muted-foreground">No podcasts found.</li>}
          {shows.map((s) => (
            <li key={s.feedUrl}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void openShow(s)}
                className="press-tint flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
              >
                <Artwork episode={s} className="size-12" />
                <span className="min-w-0">
                  <span className="block truncate text-preview font-medium">{s.title}</span>
                  <span className="block truncate text-meta text-muted-foreground">{s.author}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {show && (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Find an episode in ${show.total} episodes`}
            aria-label="Find an episode"
            className="h-11 rounded-lg border border-stroke-strong bg-card px-3 text-control"
          />
          <ul className="-mx-2 flex max-h-[55dvh] flex-col overflow-y-auto">
            {episodes.length === 0 && (
              <li className="flex justify-center py-6 text-meta text-muted-foreground">
                {searching ? <Loader2 className="size-4 animate-spin" aria-label="Searching" /> : "No episodes match."}
              </li>
            )}
            {episodes.map((e) => {
              const isAdded = Boolean(e.addedId) || added.has(e.guid);
              return (
                <li key={e.guid} className={cn("flex items-start gap-3 rounded-lg px-2 py-2.5", linked === e.guid && "bg-muted")}>
                  <div className="min-w-0 grow">
                    <p className="text-preview font-medium">{e.title}</p>
                    <p className="text-meta text-muted-foreground">
                      {[e.publishedAt ? new Date(e.publishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null, e.durationSeconds ? playLength(e.durationSeconds) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {e.description && <p className="mt-1 line-clamp-2 text-meta text-muted-foreground">{e.description}</p>}
                  </div>
                  <Button variant={isAdded ? "ghost" : "outline"} size="sm" disabled={isAdded || adding === e.guid} onClick={() => void add(e.guid)}>
                    {isAdded ? <Check aria-hidden /> : adding === e.guid ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
                    {isAdded ? "Added" : "Add"}
                  </Button>
                </li>
              );
            })}
            {searched && searched.total > searched.episodes.length && (
              <li className="py-3 text-center text-meta text-muted-foreground">
                Showing {searched.episodes.length} of {searched.total}. Add more words to narrow it down.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/** How long an audio file is, read in the browser. */
function audioLength(file: File) {
  return new Promise<number | null>((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const done = (seconds: number | null) => {
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    audio.src = url;
  });
}

async function post(body: unknown) {
  const res = await fetch("/api/listen/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "Something went wrong. Try again.");
  return out;
}

/** Sends one audio file to LukeOS: straight into Blob storage when there's a store, through the app otherwise. FLACs become MP3s first. */
async function uploadAudio(original: File, onProgress: (share: number) => void, onConvert: (share: number) => void) {
  const label = original.name || "That file";
  const tags = await readMp3Tags(original);
  const converted = isFlac(original) ? await flacToMp3(original, onConvert) : null;
  const file = converted?.file ?? original;
  if (file.size > MAX_LISTEN_FILE_BYTES) throw new Error(`${label} is over 200 MB.`);
  const durationSeconds = converted?.durationSeconds ?? (await audioLength(file));
  const mimeType = file.type || (/\.m4a$/i.test(file.name) ? "audio/mp4" : "audio/mpeg");
  const meta = { name: file.name || "Audio.mp3", mimeType, title: tags.title, artist: tags.artist, durationSeconds };

  const { mode } = await fetch("/api/messages/upload/blob").then((r) => r.json()).catch(() => ({ mode: "none" }));
  if (mode !== "token" && mode !== "presigned") {
    if (file.size > DIRECT_UPLOAD_BYTES) throw new Error(`${label} is over 4 MB, and big files can't be uploaded yet.`);
    const res = await fetch("/api/listen/upload", {
      method: "POST",
      headers: {
        "content-type": mimeType,
        "x-file-name": encodeURIComponent(meta.name),
        ...(tags.title && { "x-title": encodeURIComponent(tags.title) }),
        ...(tags.artist && { "x-artist": encodeURIComponent(tags.artist) }),
        ...(durationSeconds && { "x-duration": String(durationSeconds) }),
      },
      body: file,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `Couldn't upload ${label}.`);
    onProgress(1);
    return out;
  }

  await post({ check: file.size });
  const { upload, uploadPresigned } = await import("@vercel/blob/client");
  const send = mode === "token" ? upload : uploadPresigned;
  const ext = file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? "mp3";
  const pathname = `listen/${crypto.randomUUID()}.${ext}`;
  let lastError: unknown;
  // The store is private or public, and only accepts its own kind.
  for (const access of ["private", "public"] as const) {
    try {
      const blob = await send(pathname, file, {
        access,
        handleUploadUrl: "/api/messages/upload/blob",
        contentType: mimeType,
        multipart: file.size > 20 * 1024 * 1024,
        onUploadProgress: (p) => onProgress(p.percentage / 100),
      });
      return await post({ url: blob.url, access, ...meta });
    } catch (err) {
      lastError = err;
    }
  }
  console.error("[listen] upload failed", lastError);
  throw new Error(`Couldn't upload ${label}. Try again.`);
}

type Pending = { key: string; name: string; bytes: number; share: number; converting: number | null; done: boolean; error: string | null };

/** Upload songs straight onto a playlist (they show in All songs too). Desktop only, like Add. */
export function PlaylistUploadDialog({
  playlist,
  storage,
  onClose,
}: {
  playlist: { id: string; title: string };
  storage: { used: number; limit: number };
  onClose: () => void;
}) {
  return (
    <Dialog label={`Upload to ${playlist.title}`} onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-heading font-medium">Upload to {playlist.title}</h2>
        <Uploader storage={storage} playlistId={playlist.id} />
      </div>
    </Dialog>
  );
}

function Uploader({ storage, playlistId }: { storage: { used: number; limit: number }; playlistId?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);

  function take(files: FileList | File[]) {
    const list = Array.from(files);
    const audio = list.filter(isAudioFile);
    if (audio.length < list.length) showToast("Only MP3 and other audio files can go in Music.");
    // One at a time, so a big batch doesn't fight over the connection.
    void audio.reduce(async (before, file) => {
      await before;
      const key = crypto.randomUUID();
      const set = (change: Partial<Pending>) => setPending((p) => p.map((x) => (x.key === key ? { ...x, ...change } : x)));
      setPending((p) => [...p, { key, name: file.name, bytes: file.size, share: 0, converting: null, done: false, error: null }]);
      try {
        const episode: { id: string } = await uploadAudio(
          file,
          (share) => set({ share, converting: null }),
          (converting) => set({ converting }),
        );
        if (playlistId) await op("add_to_playlist", { playlistId, episodeIds: [episode.id] });
        set({ share: 1, done: true });
        router.refresh();
      } catch (err) {
        set({ error: (err as Error).message });
      }
    }, Promise.resolve());
  }

  return (
    <div className="flex min-h-96 flex-col gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          "flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stroke-strong text-preview text-muted-foreground hover:bg-muted",
          over && "bg-muted text-foreground",
        )}
      >
        <Upload className="size-6 text-icon" aria-hidden />
        Drop MP3s or FLACs here, or click to pick
      </button>
      <input ref={input} type="file" accept="audio/*,.mp3,.m4a,.flac" multiple hidden onChange={(e) => e.target.files && take(e.target.files)} />
      {pending.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pending.map((p) => (
            <li key={p.key} className="flex flex-col gap-1.5 rounded-lg border border-stroke px-3 py-2.5">
              <div className="flex items-center gap-2 text-preview">
                <span className="min-w-0 grow truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-meta text-muted-foreground">
                  {p.error
                    ? ""
                    : p.done
                      ? "Added"
                      : p.converting !== null
                        ? `Converting to MP3 · ${Math.round(p.converting * 100)}%`
                        : `${fileSize(p.bytes)} · ${Math.round(p.share * 100)}%`}
                </span>
              </div>
              {p.error ? (
                <p className="text-meta text-danger">{p.error}</p>
              ) : (
                !p.done && (
                  <span className="block h-1 overflow-hidden rounded-full bg-grey-300" aria-hidden>
                    <span className="block h-full bg-foreground transition-[width]" style={{ width: `${(p.converting ?? p.share) * 100}%` }} />
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto text-meta text-muted-foreground">
        Storage: {fileSize(storage.used)} of {fileSize(storage.limit)} used
      </p>
    </div>
  );
}

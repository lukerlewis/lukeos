import "server-only";
import { safeWebUrl } from "./link-preview";

/**
 * Finding podcast episodes for Listen. Shows are found with Apple's podcast
 * directory (free, no key), and their episodes read from the show's own RSS
 * feed, which is where the audio lives. Nothing is subscribed to: Luke picks
 * single episodes, and only those are kept.
 */

const TIMEOUT_MS = 10_000;
/** Some long-running shows have feeds of several MB. */
const MAX_FEED_BYTES = 25 * 1024 * 1024;
const UA = "LukeOS/1.0 (+https://lukeos-kappa.vercel.app)";

export type PodcastShow = {
  podcastId: string | null;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  feedUrl: string;
  episodeCount?: number | null;
};

export type FeedEpisode = {
  guid: string;
  title: string;
  audioUrl: string;
  mimeType: string | null;
  bytes: number | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  description: string;
  artworkUrl: string | null;
};

export type Feed = { show: PodcastShow; episodes: FeedEpisode[] };

export class PodcastError extends Error {}

async function fetchText(url: string, accept: string, maxBytes: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": UA, accept } });
    if (!res.ok) throw new PodcastError(`That address answered ${res.status}.`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > maxBytes) throw new PodcastError("That feed is too big to read.");
    const text = await res.text();
    if (text.length > maxBytes) throw new PodcastError("That feed is too big to read.");
    return { text, type: res.headers.get("content-type") ?? "", url: res.url || url };
  } catch (err) {
    if (err instanceof PodcastError) throw err;
    throw new PodcastError("Couldn't reach that address. Try again.");
  } finally {
    clearTimeout(timer);
  }
}

async function itunes(path: string) {
  const { text } = await fetchText(`https://itunes.apple.com/${path}`, "application/json", 5 * 1024 * 1024);
  try {
    return JSON.parse(text) as { results?: Record<string, unknown>[] };
  } catch {
    throw new PodcastError("Apple's podcast directory didn't answer properly. Try again.");
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function showFrom(r: Record<string, unknown>): PodcastShow | null {
  const feedUrl = str(r.feedUrl);
  if (!feedUrl) return null;
  return {
    podcastId: r.collectionId != null ? String(r.collectionId) : null,
    title: str(r.collectionName) ?? str(r.trackName) ?? "Podcast",
    author: str(r.artistName),
    artworkUrl: str(r.artworkUrl600) ?? str(r.artworkUrl100),
    feedUrl,
    episodeCount: typeof r.trackCount === "number" ? r.trackCount : null,
  };
}

/** Shows matching some words, best first. */
export async function searchPodcasts(term: string, limit = 20): Promise<PodcastShow[]> {
  const data = await itunes(`search?media=podcast&entity=podcast&limit=${limit}&term=${encodeURIComponent(term)}`);
  return (data.results ?? []).map(showFrom).filter((s): s is PodcastShow => s !== null);
}

/** A show in Apple's directory, by its id (the number in an Apple Podcasts link). */
export async function lookupPodcast(podcastId: string): Promise<PodcastShow> {
  const data = await itunes(`lookup?id=${encodeURIComponent(podcastId)}`);
  const show = (data.results ?? []).map(showFrom).find(Boolean);
  if (!show) throw new PodcastError("Couldn't find that podcast.");
  return show;
}

/**
 * The episode an Apple Podcasts link points at (…/id123?i=1000…): its guid in
 * the show's feed, or its audio address, so it can be found there.
 */
async function lookupAppleEpisode(podcastId: string, episodeId: string) {
  const data = await itunes(`lookup?id=${encodeURIComponent(podcastId)}&entity=podcastEpisode&limit=300`);
  const match = (data.results ?? []).find((r) => String(r.trackId) === episodeId);
  if (!match) return null;
  return { guid: str(match.episodeGuid), audioUrl: str(match.episodeUrl), title: str(match.trackName) };
}

export type AppleLink = { podcastId: string; episodeId: string | null };

/** podcasts.apple.com/us/podcast/some-show/id1291423644?i=1000634728153 */
export function parseAppleLink(raw: string): AppleLink | null {
  const url = safeWebUrl(raw);
  if (!url || !/(^|\.)podcasts\.apple\.com$|(^|\.)itunes\.apple\.com$/.test(url.hostname)) return null;
  const id = url.pathname.match(/\/id(\d+)/)?.[1];
  if (!id) return null;
  return { podcastId: id, episodeId: url.searchParams.get("i") };
}

// --- Reading an RSS feed ----------------------------------------------------

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return entities[e.toLowerCase()] ?? m;
    });
}

/** Plain text from a feed's HTML show notes. */
function plain(html: string) {
  return decode(
    decode(html)
      .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

const escapeTag = (tag: string) => tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text inside the first <tag>…</tag>. */
function tagText(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, "i"));
  return m ? decode(m[1]).trim() : null;
}

/** An attribute of the first <tag …>. */
function tagAttr(xml: string, tag: string, attr: string) {
  const el = xml.match(new RegExp(`<${escapeTag(tag)}\\s[^>]*>`, "i"))?.[0];
  if (!el) return null;
  const m = el.match(new RegExp(`\\s${escapeTag(attr)}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decode(m[2] ?? m[3] ?? "").trim() || null : null;
}

/** "1:02:03", "62:03" or "3723" as seconds. */
export function parseDuration(raw: string | null): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  const seconds = parts.reduce((total, n) => total * 60 + n, 0);
  return seconds > 0 ? Math.round(seconds) : null;
}

/** Reads a podcast's RSS feed: the show, and its episodes newest first. */
export function parseFeed(xml: string, feedUrl: string): Feed {
  if (!/<rss[\s>]|<channel[\s>]/i.test(xml)) throw new PodcastError("That isn't a podcast feed.");
  const channelStart = xml.search(/<channel[\s>]/i);
  const firstItem = xml.search(/<item[\s>]/i);
  const head = xml.slice(channelStart, firstItem > 0 ? firstItem : undefined);
  const showArt = tagAttr(head, "itunes:image", "href") ?? tagText(tagText(head, "image") ?? "", "url");
  const show: PodcastShow = {
    podcastId: null,
    title: tagText(head, "title") ?? "Podcast",
    author: tagText(head, "itunes:author"),
    artworkUrl: showArt,
    feedUrl,
  };
  const episodes: FeedEpisode[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const item = m[0];
    const audioUrl = tagAttr(item, "enclosure", "url");
    if (!audioUrl) continue;
    const pub = tagText(item, "pubDate");
    const published = pub ? new Date(pub) : null;
    const length = Number(tagAttr(item, "enclosure", "length"));
    const notes = tagText(item, "content:encoded") ?? tagText(item, "description") ?? tagText(item, "itunes:summary") ?? "";
    episodes.push({
      guid: tagText(item, "guid") ?? audioUrl,
      title: tagText(item, "title") ?? "Episode",
      audioUrl,
      mimeType: tagAttr(item, "enclosure", "type"),
      bytes: Number.isFinite(length) && length > 0 ? length : null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      durationSeconds: parseDuration(tagText(item, "itunes:duration")),
      description: plain(notes).slice(0, 4000),
      artworkUrl: tagAttr(item, "itunes:image", "href") ?? showArt,
    });
  }
  episodes.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return { show, episodes };
}

/** Fetches and reads a feed. */
export async function readFeed(feedUrl: string): Promise<Feed> {
  const url = safeWebUrl(feedUrl);
  if (!url) throw new PodcastError("That isn't a web address.");
  const { text, url: finalUrl } = await fetchText(url.toString(), "application/rss+xml, application/xml, text/xml, */*", MAX_FEED_BYTES);
  return parseFeed(text, finalUrl);
}

export type Resolved =
  | { kind: "episode"; feed: Feed; episode: FeedEpisode }
  | { kind: "show"; feed: Feed }
  | { kind: "audio"; audioUrl: string; title: string };

const looksLikeAudio = (url: URL) => /\.(mp3|m4a|aac|mp4|wav|ogg|opus)$/i.test(url.pathname);

/**
 * What a pasted link is: an Apple Podcasts episode or show, a show's RSS
 * feed, or a plain audio file.
 */
export async function resolveLink(raw: string): Promise<Resolved> {
  const apple = parseAppleLink(raw);
  if (apple) {
    const show = await lookupPodcast(apple.podcastId);
    const feed = { ...(await readFeed(show.feedUrl)), show: { ...show } };
    feed.show.artworkUrl ??= show.artworkUrl;
    if (!apple.episodeId) return { kind: "show", feed };
    const wanted = await lookupAppleEpisode(apple.podcastId, apple.episodeId);
    const episode =
      wanted &&
      (feed.episodes.find((e) => wanted.guid && e.guid === wanted.guid) ??
        feed.episodes.find((e) => wanted.audioUrl && sameAudio(e.audioUrl, wanted.audioUrl)) ??
        feed.episodes.find((e) => wanted.title && e.title.trim().toLowerCase() === wanted.title.toLowerCase()));
    if (!episode) throw new PodcastError("Couldn't find that episode in the show's feed. Try searching for the show instead.");
    return { kind: "episode", feed, episode };
  }
  const url = safeWebUrl(raw);
  if (!url) throw new PodcastError("That isn't a web address.");
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname))
    throw new PodcastError("YouTube links can't play here. Save it as an MP3 and upload that instead.");
  if (/(^|\.)spotify\.com$/.test(url.hostname))
    throw new PodcastError("Spotify links can't play here. Search for the show by name instead.");
  if (looksLikeAudio(url)) return { kind: "audio", audioUrl: url.toString(), title: decodeURIComponent(url.pathname.split("/").pop() ?? "Audio").replace(/\.[a-z0-9]+$/i, "") };
  return { kind: "show", feed: await readFeed(url.toString()) };
}

/** Feeds often add tracking redirects to the audio address; compare the file itself. */
function sameAudio(a: string, b: string) {
  const file = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.pathname.split("/").pop()}`;
    } catch {
      return u;
    }
  };
  return a === b || file(a) === file(b);
}

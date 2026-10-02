import "server-only";

/**
 * Reads a web page's preview (title, description, picture), the way a chat
 * app shows a link. Videos (YouTube, Vimeo, TikTok, Instagram reels) are
 * recognised so they show as videos.
 */

export type LinkPreview = {
  url: string;
  kind: "link" | "video" | "image";
  title: string | null;
  description: string | null;
  site: string | null;
  imageUrl: string | null;
};

const TIMEOUT_MS = 7000;
const MAX_HTML_BYTES = 1_500_000;
/** The largest picture we'll download for a preview. */
export const MAX_REMOTE_PICTURE_BYTES = 12 * 1024 * 1024;

const UA =
  "Mozilla/5.0 (compatible; LukeOS/1.0; +https://lukeos-kappa.vercel.app) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

/** Only plain web addresses on the open internet (not this computer or a home network). */
export function safeWebUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.startsWith("[")) return null;
  return url;
}

/** Text that is nothing but one web address. */
export function looksLikeUrl(text: string) {
  const t = text.trim();
  return !/\s/.test(t) && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i.test(t);
}

export function youTubeId(url: URL) {
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const m = url.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
    if (m) return m[2];
  }
  return null;
}

function isVideoUrl(url: URL) {
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  return (
    youTubeId(url) !== null ||
    host === "vimeo.com" ||
    host === "player.vimeo.com" ||
    host.endsWith("tiktok.com") ||
    (host === "instagram.com" && /^\/(reel|reels|tv)\//.test(url.pathname)) ||
    host === "loom.com"
  );
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8", "accept-language": "en", ...init.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Reads at most `max` bytes of a response. */
async function readCapped(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();

function metaContent(html: string, names: string[]) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name.replace(/[:.]/g, "\\$&")}["'][^>]*>|<meta[^>]+content=["'][^"']*["'][^>]+(?:property|name)=["']${name.replace(/[:.]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decode(content);
  }
  return null;
}

async function oEmbed(endpoint: string) {
  try {
    const res = await fetchWithTimeout(endpoint, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string; provider_name?: string; html?: string };
  } catch {
    return null;
  }
}

/** The post's id and author on X (Twitter): x.com/<user>/status/<id>. */
export function xPost(url: URL) {
  const host = url.hostname.replace(/^(www\.|mobile\.)/, "");
  if (!["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com"].includes(host)) return null;
  const m = url.pathname.match(/^\/(?:([A-Za-z0-9_]{1,15})|i\/web)\/status(?:es)?\/(\d+)/);
  return m ? { user: m[1] ?? null, id: m[2] } : null;
}

/**
 * X doesn't give its pages a preview, so posts are read through FxTwitter
 * (the service chat apps use to show X posts), or X's own embed as a fallback.
 */
async function xPreview(post: { user: string | null; id: string }, base: LinkPreview): Promise<LinkPreview> {
  const href = `https://x.com/${post.user ?? "i"}/status/${post.id}`;
  base = { ...base, url: href, site: "X" };
  try {
    const res = await fetchWithTimeout(`https://api.fxtwitter.com/${post.user ?? "i"}/status/${post.id}`, { headers: { accept: "application/json" } });
    if (res.ok) {
      const { tweet } = (await res.json()) as {
        tweet?: {
          text?: string;
          author?: { name?: string; screen_name?: string; avatar_url?: string };
          media?: { photos?: { url: string }[]; videos?: { thumbnail_url?: string }[]; mosaic?: { formats?: { jpeg?: string } } };
        };
      };
      if (tweet) {
        const who = tweet.author?.name ?? tweet.author?.screen_name ?? null;
        const video = tweet.media?.videos?.[0];
        return {
          ...base,
          url: tweet.author?.screen_name ? `https://x.com/${tweet.author.screen_name}/status/${post.id}` : href,
          kind: video && !tweet.media?.photos?.length ? "video" : "link",
          title: who ? `${who} on X` : null,
          description: tweet.text?.trim().slice(0, 500) || null,
          imageUrl: tweet.media?.photos?.[0]?.url ?? video?.thumbnail_url ?? tweet.author?.avatar_url?.replace("_normal.", "_400x400.") ?? null,
        };
      }
    }
  } catch {}
  const info = await oEmbed(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(href)}`);
  const text = info?.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  return {
    ...base,
    title: info?.author_name ? `${info.author_name} on X` : null,
    description: text ? decode(text.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).slice(0, 500) : null,
  };
}

export async function fetchPreview(raw: string): Promise<LinkPreview> {
  const url = safeWebUrl(raw);
  if (!url) throw new Error("That doesn't look like a web address.");
  const href = url.toString();
  const video = isVideoUrl(url);
  const base: LinkPreview = { url: href, kind: video ? "video" : "link", title: null, description: null, site: url.hostname.replace(/^www\./, ""), imageUrl: null };

  const post = xPost(url);
  if (post) return xPreview(post, base);

  const yt = youTubeId(url);
  if (yt) {
    const info = await oEmbed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(href)}`);
    return { ...base, site: "YouTube", title: info?.title ?? null, description: info?.author_name ?? null, imageUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` };
  }
  if (url.hostname.replace(/^www\./, "").endsWith("vimeo.com")) {
    const info = await oEmbed(`https://vimeo.com/api/oembed.json?width=1280&url=${encodeURIComponent(href)}`);
    if (info) return { ...base, site: "Vimeo", title: info.title ?? null, description: info.author_name ?? null, imageUrl: info.thumbnail_url ?? null };
  }

  try {
    const res = await fetchWithTimeout(href);
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.startsWith("image/")) return { ...base, kind: "image", imageUrl: res.url || href };
    if (!res.ok || !type.includes("html")) return base;
    const html = (await readCapped(res, MAX_HTML_BYTES))?.toString("utf8") ?? "";
    const head = html.slice(0, 300_000);
    const title =
      metaContent(head, ["og:title", "twitter:title"]) ?? (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]) : null);
    const description = metaContent(head, ["og:description", "twitter:description", "description"]);
    const site = metaContent(head, ["og:site_name", "application-name"]);
    const image = metaContent(head, ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
    let imageUrl: string | null = null;
    if (image) {
      try {
        imageUrl = new URL(image, res.url || href).toString();
      } catch {}
    }
    return { ...base, title: title || null, description: description?.slice(0, 500) || null, site: site || base.site, imageUrl };
  } catch {
    return base;
  }
}

/** Downloads a picture from the web, or null if it can't. */
export async function downloadPicture(raw: string): Promise<Buffer | null> {
  const url = safeWebUrl(raw);
  if (!url) return null;
  try {
    const res = await fetchWithTimeout(url.toString(), { headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    return await readCapped(res, MAX_REMOTE_PICTURE_BYTES);
  } catch {
    return null;
  }
}

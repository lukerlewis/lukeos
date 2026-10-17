/** Limits and helpers for Listen, shared by the app and the server. */

/** The biggest MP3 Listen takes (a long episode at high quality). */
export const MAX_LISTEN_FILE_BYTES = 200 * 1024 * 1024;

/** Audio files Listen takes, by type or by name. */
export const isAudioFile = (file: { type: string; name: string }) =>
  /^audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav)$/.test(file.type) || /\.(mp3|m4a|aac|wav)$/i.test(file.name);

/** 3723 seconds as "1:02:03"; 125 as "2:05". */
export function playClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "1 hr 5 min", "42 min" or "3 min left". */
export function playLength(seconds: number) {
  const mins = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h} hr ${m} min` : `${h} hr`) : `${m} min`;
}

/** 20 minutes or longer counts as a podcast; so does a podcast episode whose length isn't known yet. */
export const isPodcastLength = (e: { durationSeconds: number | null; kind: string }) =>
  e.durationSeconds ? e.durationSeconds >= 20 * 60 : e.kind === "podcast";

export const SPEEDS = [0.8, 1, 1.2, 1.5, 1.75, 2] as const;

/**
 * The title and artist written inside an MP3 (its ID3 tags), read in the
 * browser before upload. Null fields when there aren't any.
 */
export async function readMp3Tags(file: Blob): Promise<{ title: string | null; artist: string | null }> {
  const none = { title: null, artist: null };
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return none; // "ID3"
    const version = head[3];
    const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    const tag = new Uint8Array(await file.slice(10, 10 + Math.min(size, 512 * 1024)).arrayBuffer());
    const out: { title: string | null; artist: string | null } = { ...none };
    let i = 0;
    const idLength = version === 2 ? 3 : 4;
    const headerLength = version === 2 ? 6 : 10;
    while (i + headerLength < tag.length) {
      const id = String.fromCharCode(...tag.subarray(i, i + idLength));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const b = tag.subarray(i + idLength);
      const frameSize =
        version === 2
          ? (b[0] << 16) | (b[1] << 8) | b[2]
          : version === 4
            ? ((b[0] & 0x7f) << 21) | ((b[1] & 0x7f) << 14) | ((b[2] & 0x7f) << 7) | (b[3] & 0x7f)
            : ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
      if (frameSize <= 0 || i + headerLength + frameSize > tag.length) break;
      const body = tag.subarray(i + headerLength, i + headerLength + frameSize);
      const key = id === "TIT2" || id === "TT2" ? "title" : id === "TPE1" || id === "TP1" ? "artist" : null;
      if (key) out[key] = textFrame(body);
      i += headerLength + frameSize;
    }
    return out;
  } catch {
    return none;
  }
}

function textFrame(body: Uint8Array) {
  const encoding = body[0];
  const bytes = body.subarray(1);
  const label = encoding === 1 ? "utf-16" : encoding === 2 ? "utf-16be" : encoding === 3 ? "utf-8" : "latin1";
  const text = new TextDecoder(label).decode(bytes).replace(/\0+$/g, "").replace(/\0/g, " / ").trim();
  return text || null;
}

/** One emoji (flags, skin tones and joined ones like 👨‍👩‍👧 count as one). */
export function isEmoji(text: string) {
  const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];
  return parts.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text);
}

/** Icons a playlist could have before emojis (lucide names); old ones still show. */
export const PLAYLIST_ICONS = [
  "list-music", "music", "headphones", "mic", "radio", "disc", "guitar", "piano", "drum",
  "heart", "star", "sparkles", "flame", "zap", "sun", "moon", "coffee", "brain",
  "book-open", "briefcase", "dumbbell", "footprints", "car", "plane", "leaf", "mountain", "waves", "house",
] as const;

export type PlaylistIcon = (typeof PLAYLIST_ICONS)[number];

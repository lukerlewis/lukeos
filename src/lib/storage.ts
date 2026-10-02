import "server-only";
import { randomUUID } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { storedFiles } = schema;

/**
 * Where Inspiration and Messages keep their pictures and files. Vercel Blob when a Blob
 * store is connected to the project (it sets BLOB_STORE_ID or
 * BLOB_READ_WRITE_TOKEN); the database otherwise, so the app still works
 * before one is set up. Everything is served through /api/stored/<id>, which
 * checks Luke is signed in, so it doesn't matter whether the store is private.
 */

/** The free plan's Blob allowance. Going over it locks the store for 30 days, so the app warns early. */
export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
/** Above this share of the allowance, the app warns; above the second, it stops taking new files. */
export const STORAGE_WARN_AT = 0.8;
export const STORAGE_STOP_AT = 0.97;

export const blobConfigured = () => Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

const extensions: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** The store is either private or public; we find out on the first upload and remember. */
let blobAccess: "private" | "public" | undefined;

async function putBlob(data: Buffer, mimeType: string, folder: string) {
  const pathname = `${folder}/${randomUUID()}.${extensions[mimeType] ?? "bin"}`;
  const options = { contentType: mimeType, cacheControlMaxAge: 60 * 60 * 24 * 365 };
  const order: ("private" | "public")[] = blobAccess ? [blobAccess] : ["private", "public"];
  let lastError: unknown;
  for (const access of order) {
    try {
      const blob = await put(pathname, data, { ...options, access });
      blobAccess = access;
      return { url: blob.url, access };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export type Stored = { id: string; bytes: number };

/** Keeps a file and returns its id. */
export async function storeFile(data: Buffer, mimeType: string, folder = "inspiration"): Promise<Stored> {
  if (blobConfigured()) {
    const blob = await putBlob(data, mimeType, folder);
    const [row] = await db
      .insert(storedFiles)
      .values({ backend: "blob", blobUrl: blob.url, access: blob.access, mimeType, bytes: data.length })
      .returning({ id: storedFiles.id });
    return { id: row.id, bytes: data.length };
  }
  const [row] = await db
    .insert(storedFiles)
    .values({ backend: "db", mimeType, bytes: data.length, data })
    .returning({ id: storedFiles.id });
  return { id: row.id, bytes: data.length };
}

/**
 * Keeps a file the browser put straight into Blob (too big to pass through
 * the app), once it's checked the file is really there.
 */
export async function adoptBlob(url: string, mimeType: string, access: "private" | "public"): Promise<Stored> {
  if (!blobConfigured()) throw new Error("No Blob store.");
  // Only finds files in our own store, so a stranger's address can't be kept.
  const info = await head(url);
  blobAccess ??= access;
  const [row] = await db
    .insert(storedFiles)
    .values({ backend: "blob", blobUrl: info.url, access, mimeType, bytes: info.size })
    .returning({ id: storedFiles.id });
  return { id: row.id, bytes: info.size };
}

export type ByteRange = { start: number; end: number };

/** "bytes=0-1023" as a range within a file, or null when there isn't a usable one. */
export function parseRange(header: string | null, size: number): ByteRange | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * A kept file's contents, as a stream, or null if it's gone. With a range,
 * only that part (videos on iPhone only play when they can ask for parts).
 */
export async function readStoredFile(id: string, range?: ByteRange | null) {
  const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, id)).limit(1);
  if (!row) return null;
  if (row.backend === "db") {
    if (!row.data) return null;
    const bytes = new Uint8Array(row.data);
    return {
      mimeType: row.mimeType,
      bytes: row.bytes,
      body: (range ? bytes.subarray(range.start, range.end + 1) : bytes) as BodyInit,
      range: range ?? null,
    };
  }
  const result = await get(row.blobUrl!, {
    access: (row.access as "private" | "public") ?? "private",
    ...(range && { headers: { range: `bytes=${range.start}-${range.end}` } }),
  });
  if (!result || result.statusCode !== 200) return null;
  // Blob answers a range with just that part (and says so).
  const partial = range && result.headers.get("content-range") ? range : null;
  return { mimeType: row.mimeType, bytes: row.bytes, body: result.stream as BodyInit, range: partial };
}

/** A kept file's bytes, e.g. to show Claude a picture. */
export async function readStoredBytes(id: string) {
  const file = await readStoredFile(id);
  if (!file) return null;
  return { mimeType: file.mimeType, data: Buffer.from(await new Response(file.body).arrayBuffer()) };
}

/** How much is kept in Blob (or the database, before Blob is set up), against the free allowance. */
export async function storageUsage() {
  const [row] = await db
    .select({ bytes: sql<number>`coalesce(sum(${storedFiles.bytes}), 0)`.mapWith(Number) })
    .from(storedFiles);
  const used = row.bytes;
  const share = used / STORAGE_LIMIT_BYTES;
  return { used, limit: STORAGE_LIMIT_BYTES, share, warn: share >= STORAGE_WARN_AT, full: share >= STORAGE_STOP_AT, blob: blobConfigured() };
}

/**
 * Deletes kept files nothing points at any more (their item was deleted for
 * good). Only ones over a day old, so a file being uploaded right now is safe.
 */
export async function deleteUnusedStoredFiles() {
  const unused = await db
    .select({ id: storedFiles.id, backend: storedFiles.backend, blobUrl: storedFiles.blobUrl })
    .from(storedFiles)
    .where(
      and(
        lt(storedFiles.createdAt, sql`now() - interval '1 day'`),
        sql`not exists (select 1 from inspiration_items i where ${storedFiles.id} in (i.image_id, i.thumb_id, i.file_id))`,
        sql`not exists (
          select 1 from messages m, jsonb_array_elements(m.attachments) a
          where ${storedFiles.id}::text in (a->>'fileId', a->>'thumbId')
        )`,
      ),
    )
    .limit(500);
  if (!unused.length) return 0;
  const blobUrls = unused.filter((f) => f.backend === "blob" && f.blobUrl).map((f) => f.blobUrl!);
  if (blobUrls.length) {
    try {
      await del(blobUrls);
    } catch (err) {
      // Keep the rows so the next tidy-up tries again.
      console.error("[storage] couldn't delete from Blob", err);
      return 0;
    }
  }
  await db.delete(storedFiles).where(inArray(storedFiles.id, unused.map((f) => f.id)));
  return unused.length;
}

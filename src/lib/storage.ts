import "server-only";
import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { storedFiles } = schema;

/**
 * Where Inspiration keeps its pictures and files. Vercel Blob when a Blob
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
};

/** The store is either private or public; we find out on the first upload and remember. */
let blobAccess: "private" | "public" | undefined;

async function putBlob(data: Buffer, mimeType: string) {
  const pathname = `inspiration/${randomUUID()}.${extensions[mimeType] ?? "bin"}`;
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
export async function storeFile(data: Buffer, mimeType: string): Promise<Stored> {
  if (blobConfigured()) {
    const blob = await putBlob(data, mimeType);
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

/** A kept file's contents, as a stream, or null if it's gone. */
export async function readStoredFile(id: string) {
  const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, id)).limit(1);
  if (!row) return null;
  if (row.backend === "db") {
    if (!row.data) return null;
    return { mimeType: row.mimeType, bytes: row.bytes, body: new Uint8Array(row.data) as BodyInit };
  }
  const result = await get(row.blobUrl!, { access: (row.access as "private" | "public") ?? "private" });
  if (!result || result.statusCode !== 200) return null;
  return { mimeType: row.mimeType, bytes: row.bytes, body: result.stream as BodyInit };
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

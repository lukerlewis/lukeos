import { getSession } from "@/lib/auth/session";
import { parseRange, readStoredFile } from "@/lib/storage";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

/** Kinds of file that open in the browser. Anything else (web pages, SVGs, documents) downloads, so it can't run in the app. */
const opensInline = /^(application\/pdf|image\/(jpeg|png|webp|gif|avif)|video\/(mp4|quicktime|webm))$/;

/**
 * A picture or file kept for Inspiration or Messages. Only for the signed-in
 * owner. Files never change (a new one gets a new id), so browsers keep them.
 * Answers requests for part of a file, which iPhones need to play videos.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/stored/[id]">) {
  if (!(await getSession())) return new Response("Not signed in.", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });
  const rangeHeader = req.headers.get("range");
  let range = null;
  if (rangeHeader) {
    const [row] = await db.select({ bytes: schema.storedFiles.bytes }).from(schema.storedFiles).where(eq(schema.storedFiles.id, id)).limit(1);
    if (!row) return new Response("Not found.", { status: 404 });
    range = parseRange(rangeHeader, row.bytes);
    if (!range) return new Response("Can't send that part.", { status: 416, headers: { "content-range": `bytes */${row.bytes}` } });
  }
  const file = await readStoredFile(id, range);
  if (!file) return new Response("Not found.", { status: 404 });
  const inline = opensInline.test(file.mimeType);
  const name = new URL(req.url).searchParams.get("name");
  const part = file.range;
  return new Response(file.body, {
    status: part ? 206 : 200,
    headers: {
      "content-type": inline ? file.mimeType : "application/octet-stream",
      "content-length": String(part ? part.end - part.start + 1 : file.bytes),
      "accept-ranges": "bytes",
      ...(part && { "content-range": `bytes ${part.start}-${part.end}/${file.bytes}` }),
      ...((name || !inline) && {
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name ?? "file")}`,
      }),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
}

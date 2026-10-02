import { getSession } from "@/lib/auth/session";
import { readStoredFile } from "@/lib/storage";

/** Kinds of file that open in the browser. Anything else (web pages, SVGs, documents) downloads, so it can't run in the app. */
const opensInline = /^(application\/pdf|image\/(jpeg|png|webp|gif|avif))$/;

/**
 * A picture or file kept for Inspiration. Only for the signed-in owner. Files
 * never change (a new one gets a new id), so browsers keep them.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/stored/[id]">) {
  if (!(await getSession())) return new Response("Not signed in.", { status: 401 });
  const { id } = await ctx.params;
  const file = /^[0-9a-f-]{36}$/i.test(id) ? await readStoredFile(id) : null;
  if (!file) return new Response("Not found.", { status: 404 });
  const inline = opensInline.test(file.mimeType);
  const name = new URL(req.url).searchParams.get("name");
  return new Response(file.body, {
    headers: {
      "content-type": inline ? file.mimeType : "application/octet-stream",
      "content-length": String(file.bytes),
      ...((name || !inline) && {
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name ?? "file")}`,
      }),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
}

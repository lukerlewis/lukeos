import { getEntryFile } from "@/core/archive";
import { getSession } from "@/lib/auth/session";

/** Kinds of file that open in the browser. Anything else (web pages, SVGs, documents) downloads, so it can't run in the app. */
const opensInline = /^(application\/pdf|image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|wav|webm))$/;

/** A file kept with a Work archive entry. Only for the signed-in owner. */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  if (!(await getSession())) return new Response("Not signed in.", { status: 401 });
  const { id } = await ctx.params;
  const file = /^[0-9a-f-]{36}$/i.test(id) ? await getEntryFile(id) : null;
  if (!file) return new Response("Not found.", { status: 404 });
  const type = file.mimeType ?? "application/octet-stream";
  const inline = opensInline.test(type);
  return new Response(new Uint8Array(file.data!), {
    headers: {
      "content-type": inline ? type : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
}

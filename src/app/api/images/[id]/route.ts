import { getImage } from "@/core/notes";
import { getSession } from "@/lib/auth/session";

/** A photo from a note. Only for the signed-in owner; photos never change, so browsers keep them. */
export async function GET(_req: Request, ctx: RouteContext<"/api/images/[id]">) {
  if (!(await getSession())) return new Response("Not signed in.", { status: 401 });
  const { id } = await ctx.params;
  const image = /^[0-9a-f-]{36}$/i.test(id) ? await getImage(id) : null;
  if (!image) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "content-type": image.mimeType,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

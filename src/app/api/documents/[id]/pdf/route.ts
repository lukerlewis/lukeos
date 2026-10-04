import { OperationError } from "@/core/define";
import { getDocument } from "@/core/documents";
import { getSession } from "@/lib/auth/session";
import { documentPdf } from "@/lib/document-pdf";

/** A document as a PDF, for Export PDF. Only for the signed-in owner. */
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/pdf">) {
  if (!(await getSession())) return new Response("Not signed in.", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });
  let doc;
  try {
    doc = await getDocument(id);
  } catch (err) {
    if (err instanceof OperationError) return new Response("Not found.", { status: 404 });
    throw err;
  }
  const pdf = await documentPdf({
    title: doc.title,
    content: doc.content,
    author: doc.madeBy.kind === "agent" ? (doc.madeBy.name ?? "Claude") : "Luke",
  });
  const name = `${(doc.title.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120)}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { OperationError } from "@/core/define";
import { adoptMessageBlob, saveMessageFile } from "@/core/messages";
import { getSession } from "@/lib/auth/session";
import { DIRECT_UPLOAD_BYTES } from "@/lib/message-files";

const bigFile = z.object({
  url: z.url(),
  access: z.enum(["private", "public"]),
  name: z.string().max(300),
  mimeType: z.string().max(200),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

/**
 * Keeps a photo or file picked in Messages, before the message is sent.
 * Small ones come as the request body (name in x-file-name); big ones were
 * put straight into Blob storage, and come as JSON saying where.
 */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    if (req.headers.get("content-type")?.startsWith("application/json") && req.headers.get("x-blob") === "1") {
      const input = bigFile.safeParse(await req.json().catch(() => null));
      if (!input.success) return NextResponse.json({ error: "That upload didn't arrive. Try again." }, { status: 400 });
      return NextResponse.json(await adoptMessageBlob(input.data));
    }
    if (Number(req.headers.get("content-length") ?? 0) > DIRECT_UPLOAD_BYTES)
      return NextResponse.json({ error: "That file is too big to send this way." }, { status: 413 });
    let name = "File";
    try {
      name = decodeURIComponent(req.headers.get("x-file-name") ?? "File");
    } catch {}
    const data = Buffer.from(await req.arrayBuffer());
    const mimeType = req.headers.get("content-type") ?? "application/octet-stream";
    return NextResponse.json(await saveMessageFile({ data, name, mimeType }));
  } catch (err) {
    if (err instanceof OperationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

import { NextResponse } from "next/server";
import { addEntryFile, MAX_FILE_BYTES } from "@/core/archive";
import { OperationError } from "@/core/define";
import { getSession } from "@/lib/auth/session";

/**
 * Adds a file to a Work archive entry. The file is the request body as it is
 * (not JSON), with its name in x-file-name, so a 4 MB file fits in one upload.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/archive/[id]/files">) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES)
    return NextResponse.json({ error: "That file is over 4 MB. Add a link to it instead." }, { status: 413 });
  const data = Buffer.from(await req.arrayBuffer());
  let name = "File";
  try {
    name = decodeURIComponent(req.headers.get("x-file-name") ?? "File");
  } catch {}
  try {
    const file = await addEntryFile(id, { name, mimeType: req.headers.get("content-type") ?? "", data }, { kind: "user" });
    return NextResponse.json(file);
  } catch (err) {
    if (err instanceof OperationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

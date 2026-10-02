import { NextResponse } from "next/server";
import { OperationError } from "@/core/define";
import { addUpload } from "@/core/inspiration";
import { getSession } from "@/lib/auth/session";
import { MAX_UPLOAD_BYTES } from "@/lib/inspiration";

/**
 * Saves one thing dropped or chosen in the app: the file is the request body
 * as it is (pictures already shrunk in the browser), with its name in
 * x-file-name and an optional project in x-project-id.
 */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES)
    return NextResponse.json({ error: "That file is over 4 MB." }, { status: 413 });
  const data = Buffer.from(await req.arrayBuffer());
  let name = "File";
  try {
    name = decodeURIComponent(req.headers.get("x-file-name") ?? "File");
  } catch {}
  const projectId = req.headers.get("x-project-id") || null;
  try {
    const item = await addUpload(
      { data, name, mimeType: req.headers.get("content-type") ?? "application/octet-stream" },
      { projectId },
      { kind: "user" },
    );
    return NextResponse.json(item);
  } catch (err) {
    if (err instanceof OperationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

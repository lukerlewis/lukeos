import { NextResponse } from "next/server";
import { OperationError } from "@/core/define";
import { addUpload } from "@/core/inspiration";
import { MAX_UPLOAD_BYTES } from "@/lib/inspiration";
import { checkShortcutKey } from "@/lib/shortcut-key";

/**
 * Where the iPhone Shortcut ("Save to LukeOS" in the share menu) sends
 * things. It signs with the key from Settings. It sends a form with one field,
 * "item": a picture or file, or text (a web address or a quote).
 */
export async function POST(req: Request) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!(await checkShortcutKey(key))) return NextResponse.json({ error: "That key isn't right. Make a new one in LukeOS Settings." }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024)
    return NextResponse.json({ error: "That's over 4 MB. Resize it first." }, { status: 413 });

  try {
    const type = req.headers.get("content-type") ?? "";
    let upload: Parameters<typeof addUpload>[0] | null = null;
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      const value = form.get("item") ?? form.get("file") ?? form.get("text") ?? form.get("url");
      if (value instanceof File) upload = { data: Buffer.from(await value.arrayBuffer()), name: value.name || "Picture", mimeType: value.type || "application/octet-stream" };
      else if (typeof value === "string") upload = { text: value };
    } else if (type.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as { item?: string; url?: string; text?: string };
      const text = body.item ?? body.url ?? body.text;
      if (text) upload = { text };
    } else if (type.startsWith("text/")) {
      upload = { text: await req.text() };
    } else {
      upload = { data: Buffer.from(await req.arrayBuffer()), name: "Picture", mimeType: type || "application/octet-stream" };
    }
    if (!upload) return NextResponse.json({ error: "Nothing came through to save." }, { status: 400 });
    const item = await addUpload(upload, {}, { kind: "user" });
    return NextResponse.json({ saved: true, id: item.id, title: item.title || null });
  } catch (err) {
    if (err instanceof OperationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

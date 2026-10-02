import { NextResponse } from "next/server";
import { OperationError } from "@/core/define";
import { addUpload } from "@/core/inspiration";
import { checkShortcutKey } from "@/lib/shortcut-key";

/** As much as one request to Vercel can carry. */
const MAX_BYTES = 4.4 * 1024 * 1024;

/**
 * Where the iPhone Shortcut ("Save to LukeOS" in the share menu) sends
 * things. The key is in the address (?key=) or an Authorization header. The
 * Shortcut sends whatever was shared, as it is: a form field "item", or the
 * whole body. Photos (HEIC too), files, links and text all work, so the
 * Shortcut itself needs no steps to sort them.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!(await checkShortcutKey(key))) return NextResponse.json({ error: "That key isn't right. Make a new one in LukeOS Settings." }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES)
    return NextResponse.json({ error: "That's too big to send (over 4 MB)." }, { status: 413 });

  try {
    const type = req.headers.get("content-type") ?? "";
    let upload: Parameters<typeof addUpload>[0] | null = null;
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      const value = form.get("item") ?? form.get("file") ?? form.get("text") ?? form.get("url") ?? [...form.values()][0];
      if (value instanceof File) upload = fromBytes(Buffer.from(await value.arrayBuffer()), value.type, value.name);
      else if (typeof value === "string") upload = { text: value };
    } else if (type.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as { item?: string; url?: string; text?: string };
      const text = body.item ?? body.url ?? body.text;
      if (text) upload = { text };
    } else {
      upload = fromBytes(Buffer.from(await req.arrayBuffer()), type, "");
    }
    if (!upload || ("text" in upload && !upload.text.trim()) || ("data" in upload && !upload.data.length))
      return NextResponse.json({ error: "Nothing came through to save." }, { status: 400 });
    const item = await addUpload(upload, {}, { kind: "user" });
    return NextResponse.json({ saved: true, id: item.id, title: item.title || null });
  } catch (err) {
    if (err instanceof OperationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/**
 * Shared links and text arrive as small text files, so read those as text.
 * Everything else is a picture or a file.
 */
function fromBytes(data: Buffer, type: string, name: string): Parameters<typeof addUpload>[0] {
  const mimeType = type.split(";")[0].trim().toLowerCase();
  const isMedia = /^(image|video|audio)\//.test(mimeType) || mimeType === "application/pdf" || data.subarray(0, 5).toString() === "%PDF-";
  if (!isMedia && data.length < 64 * 1024 && !data.includes(0)) {
    const text = data.toString("utf8").trim();
    // A .webloc or similar wraps the address; pull it out.
    const link = text.match(/https?:\/\/[^\s<>"]+/)?.[0];
    return { text: link && text.length > link.length && /^</.test(text) ? link : text };
  }
  return { data, name: name || "Picture", mimeType: mimeType && mimeType !== "application/octet-stream" ? mimeType : sniff(data) };
}

/** What a file is from its first bytes, when the Shortcut doesn't say. */
function sniff(data: Buffer) {
  const head = data.subarray(0, 12);
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (head.subarray(4, 8).toString() === "ftyp") return "image/heic";
  if (head.subarray(0, 4).toString() === "RIFF") return "image/webp";
  if (head.subarray(0, 3).toString() === "GIF") return "image/gif";
  return "application/octet-stream";
}

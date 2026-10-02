import { NextResponse } from "next/server";
import { OperationError } from "@/core/define";
import { addUpload } from "@/core/inspiration";
import { looksLikeUrl } from "@/lib/link-preview";
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
      // The Shortcut's "link" field: the shared address as text. The phone
      // turns a link into the web page itself when it's sent as a file, so
      // this is the reliable way to get the address.
      const link = form.get("link");
      if (typeof link === "string" && looksLikeUrl(link) && (!upload || "text" in upload || !isMedia(upload.mimeType)))
        upload = { text: link.trim() };
    } else if (type.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as { item?: string; url?: string; text?: string };
      const text = body.item ?? body.url ?? body.text;
      if (text) upload = { text };
    } else {
      upload = fromBytes(Buffer.from(await req.arrayBuffer()), type, "");
    }
    if (upload && "text" in upload) upload = { text: linkIn(upload.text) ?? upload.text };
    console.log("[shortcut]", type.split(";")[0], upload && ("text" in upload ? `text: ${upload.text.slice(0, 120)}` : `${upload.mimeType} ${upload.data.length} bytes "${upload.name}"`));
    if (upload && "data" in upload && upload.mimeType === "text/html")
      return NextResponse.json({ error: "LukeOS got the web page instead of its address. Add the link field to the Shortcut (see the guide)." }, { status: 400 });
    if (!upload || ("text" in upload && !upload.text.trim()) || ("data" in upload && !upload.data.length))
      return NextResponse.json({ error: "Nothing came through to save." }, { status: 400 });
    const item = await addUpload(upload, {}, { kind: "user" });
    return NextResponse.json({ saved: true, id: item.id, title: item.title || null });
  } catch (err) {
    if (err instanceof OperationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

const isMedia = (mimeType: string) => /^(image|video|audio)\//.test(mimeType) || mimeType === "application/pdf";

/**
 * Apps often share a link with a few words around it ("Check this out
 * https://x.com/..."): that's the link. Longer text is a quote.
 */
function linkIn(text: string) {
  const t = text.trim();
  if (looksLikeUrl(t)) return t;
  const links = t.match(/https?:\/\/[^\s<>"]+/g);
  return links?.length === 1 && t.length - links[0].length <= 200 ? links[0] : null;
}

/**
 * The address of a web page, from the page itself. The phone sends the page
 * instead of its address when a link goes into a file field.
 */
function pageAddress(html: string) {
  const head = html.slice(0, 500_000);
  for (const re of [
    /<meta[^>]+(?:property|name)=["'](?:og:url|twitter:url)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:url|twitter:url)["']/i,
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i,
    /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/,
  ]) {
    const found = head.match(re);
    const url = (found?.[1] ?? found?.[0])?.replace(/&amp;/g, "&");
    if (url && /^https?:\/\//.test(url) && looksLikeUrl(url)) return url;
  }
  return null;
}

/**
 * Shared links and text arrive as small text files, so read those as text.
 * A web page becomes its address. Everything else is a picture or a file.
 */
function fromBytes(data: Buffer, type: string, name: string): Parameters<typeof addUpload>[0] {
  const mimeType = type.split(";")[0].trim().toLowerCase();
  const head = data.subarray(0, 600).toString("utf8").trimStart().toLowerCase();
  if (mimeType === "text/html" || mimeType === "application/xhtml+xml" || head.startsWith("<!doctype html") || head.startsWith("<html")) {
    const address = pageAddress(data.toString("utf8"));
    return address ? { text: address } : { data, name, mimeType: "text/html" };
  }
  const media = isMedia(mimeType) || data.subarray(0, 5).toString() === "%PDF-";
  if (!media && data.length < 64 * 1024 && !data.includes(0)) {
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

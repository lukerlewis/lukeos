import { NextResponse } from "next/server";
import { z } from "zod";
import { OperationError } from "@/core/define";
import { adoptListenBlob, assertRoomFor, saveListenFile } from "@/core/listen";
import { getSession } from "@/lib/auth/session";
import { DIRECT_UPLOAD_BYTES } from "@/lib/message-files";

const meta = {
  name: z.string().max(300),
  mimeType: z.string().max(200),
  title: z.string().max(500).nullable().optional(),
  artist: z.string().max(300).nullable().optional(),
  durationSeconds: z.number().positive().max(100 * 3600).nullable().optional(),
};
const bigFile = z.object({ url: z.url(), access: z.enum(["private", "public"]), ...meta });
const check = z.object({ check: z.number().int().positive() });

/**
 * Keeps an MP3 uploaded in Listen. MP3s are usually too big to pass through
 * the app, so the browser puts them straight into Blob storage first (asking
 * here with { check: bytes } whether there's room), then says where as JSON.
 * Small ones, or any when there's no Blob store, come as the request body.
 */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    if (req.headers.get("content-type")?.startsWith("application/json")) {
      const body = await req.json().catch(() => null);
      const room = check.safeParse(body);
      if (room.success) {
        await assertRoomFor(room.data.check);
        return NextResponse.json({ ok: true });
      }
      const input = bigFile.safeParse(body);
      if (!input.success) return NextResponse.json({ error: "That upload didn't arrive. Try again." }, { status: 400 });
      return NextResponse.json(await adoptListenBlob(input.data));
    }
    if (Number(req.headers.get("content-length") ?? 0) > DIRECT_UPLOAD_BYTES)
      return NextResponse.json({ error: "That file is too big to upload this way." }, { status: 413 });
    const header = (name: string) => {
      try {
        return decodeURIComponent(req.headers.get(name) ?? "") || null;
      } catch {
        return null;
      }
    };
    const duration = Number(req.headers.get("x-duration"));
    return NextResponse.json(
      await saveListenFile(Buffer.from(await req.arrayBuffer()), {
        name: header("x-file-name") ?? "Audio.mp3",
        mimeType: req.headers.get("content-type") ?? "audio/mpeg",
        title: header("x-title"),
        artist: header("x-artist"),
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
      }),
    );
  } catch (err) {
    if (err instanceof OperationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

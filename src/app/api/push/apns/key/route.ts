import { NextResponse } from "next/server";
import { z } from "zod";
import { apnsKeyInfo, saveApnsKey } from "@/core/apns";
import { getSession } from "@/lib/auth/session";

/**
 * The key from Luke's Apple developer account that lets LukeOS send notifications
 * to the iPhone app. Added once in Settings; only whether there is one is ever read back.
 */

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ key: await apnsKeyInfo() });
}

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = z
    .object({
      keyId: z.string().trim().regex(/^[A-Z0-9]{10}$/, "The Key ID is 10 letters and numbers."),
      p8: z.string().min(100).max(5000),
      teamId: z.string().trim().regex(/^[A-Z0-9]{10}$/).optional(),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The Key ID is 10 letters and numbers, and the file is the .p8 Apple gave you." }, { status: 400 });
  try {
    await saveApnsKey(parsed.data);
  } catch {
    return NextResponse.json({ error: "That file isn't an Apple push key (.p8)." }, { status: 400 });
  }
  return NextResponse.json({ key: await apnsKeyInfo() });
}

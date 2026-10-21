import { NextResponse } from "next/server";
import { consumeInvite } from "@/lib/auth/device-invite";
import { createSession } from "@/lib/auth/session";

/**
 * Signs the Mac app in with a code from Settings > Devices. The app can't make
 * passkeys, so the code stands in for one (it works once, for 10 minutes).
 */
export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: unknown };
  const invite = await consumeInvite(code);
  if (!invite) return NextResponse.json({ error: "That code didn't work. Make a new one in Settings." }, { status: 403 });
  await createSession({ passkeyId: invite.by, userAgent: req.headers.get("user-agent") });
  return NextResponse.json({ ok: true });
}

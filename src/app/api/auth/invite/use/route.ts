import { NextResponse } from "next/server";
import { consumeInvite } from "@/lib/auth/device-invite";
import { createSession } from "@/lib/auth/session";

/**
 * Signs the Mac app or the iPhone app in with a code from Settings > Devices. They
 * can't make passkeys, so the code stands in for one (it works once, for 10 minutes).
 * The iPhone app says who it is and is handed its sign-in token to keep in the Keychain.
 */
export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: unknown };
  const invite = await consumeInvite(code);
  if (!invite) return NextResponse.json({ error: "That code didn't work. Make a new one in Settings." }, { status: 403 });
  const token = await createSession({ passkeyId: invite.by, userAgent: req.headers.get("user-agent") });
  const fromIPhoneApp = req.headers.get("x-lukeos-client") === "ios";
  return NextResponse.json(fromIPhoneApp ? { ok: true, token } : { ok: true });
}

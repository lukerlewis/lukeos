import { NextResponse } from "next/server";
import { listMessages, unreadMessageCount } from "@/core/messages";
import { nextCheckIn } from "@/core/routines";
import { getSession } from "@/lib/auth/session";

/**
 * The Messages chain as the app shows it: like list_messages, but with a quiet
 * placeholder where a message was unsent (unsent: true, no text), how many of
 * Claude's messages are unread, and when Claude next reads the chain.
 */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const asked = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 500) : 200;
  const [messages, unread, next] = await Promise.all([listMessages({ limit, withUnsent: true }), unreadMessageCount(), nextCheckIn()]);
  return NextResponse.json({ messages, unread, nextCheckIn: next });
}

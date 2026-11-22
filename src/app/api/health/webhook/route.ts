import { after, NextResponse } from "next/server";
import { shouldSyncAfterNotice, syncHealth, webhookAuthorized } from "@/core/health-google";

export const maxDuration = 60;

/**
 * Google Health calls this when new Fitbit data lands (and twice when it's first set up,
 * to check it: once with LukeOS's secret, wanting 200, and once without, wanting 401).
 */
export async function POST(req: Request) {
  if (!(await webhookAuthorized(req.headers.get("authorization")))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { type?: string } | unknown[] | null;
  if (Array.isArray(body) && body.length && (await shouldSyncAfterNotice())) {
    // Answer at once (Google retries slow replies), then fetch the last few days.
    after(() => syncHealth({ days: 3 }).catch((err) => console.error("[health] sync after notice failed", err)));
  }
  return NextResponse.json({ ok: true });
}

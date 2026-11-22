import { NextResponse } from "next/server";
import { healthStatus, syncHealth } from "@/core/health-google";

export const maxDuration = 60;

/**
 * Once a day (vercel.json), a catch-up fetch of the last week, in case a change notice
 * from Google went missing. Vercel signs the call with CRON_SECRET when that's set.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? req.headers.get("authorization") === `Bearer ${secret}`
    : (req.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
  if (!authorized) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  if (!(await healthStatus()).connected) return NextResponse.json({ skipped: "Fitbit isn't connected." });
  try {
    return NextResponse.json(await syncHealth({ days: 7 }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

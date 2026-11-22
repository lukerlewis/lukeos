import { NextResponse } from "next/server";
import { authorizeUrl, HealthError } from "@/core/health-google";
import { getSession } from "@/lib/auth/session";
import { originOf } from "@/lib/auth/oauth";

/** Sends Luke to Google to let LukeOS read his Fitbit. */
export async function GET(req: Request) {
  const origin = originOf(req);
  if (!(await getSession())) return NextResponse.redirect(new URL("/sign-in?next=/health/connect", origin));
  try {
    return NextResponse.redirect(await authorizeUrl(origin));
  } catch (err) {
    if (!(err instanceof HealthError)) throw err;
    return NextResponse.redirect(new URL(`/health/connect?error=${encodeURIComponent(err.message)}`, origin));
  }
}

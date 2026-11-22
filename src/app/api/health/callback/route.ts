import { NextResponse } from "next/server";
import { finishAuthorize, HealthError } from "@/core/health-google";
import { getSession } from "@/lib/auth/session";
import { originOf } from "@/lib/auth/oauth";

// The first sign-in fetches 90 days of numbers before coming back.
export const maxDuration = 60;

/** Google sends Luke back here after he says yes (or no). */
export async function GET(req: Request) {
  const origin = originOf(req);
  const back = (error: string) => NextResponse.redirect(new URL(`/health/connect?error=${encodeURIComponent(error)}`, origin));
  if (!(await getSession())) return NextResponse.redirect(new URL("/sign-in?next=/health/connect", origin));
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error")) return back(params.get("error") === "access_denied" ? "Google sign-in was cancelled." : `Google said: ${params.get("error")}.`);
  if (!code || !state) return back("Google didn't send a sign-in code. Try again.");
  try {
    await finishAuthorize(origin, code, state);
  } catch (err) {
    if (!(err instanceof HealthError)) throw err;
    return back(err.message);
  }
  return NextResponse.redirect(new URL("/health/connected", origin));
}

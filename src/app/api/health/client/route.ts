import { NextResponse } from "next/server";
import { HealthError, saveClient } from "@/core/health-google";
import { getSession } from "@/lib/auth/session";

/** Saves the client ID and secret from Luke's Google Cloud project (Health > Connect). */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { clientId?: unknown; clientSecret?: unknown };
  if (typeof body.clientId !== "string" || typeof body.clientSecret !== "string") {
    return NextResponse.json({ error: "Paste both the client ID and the client secret." }, { status: 400 });
  }
  try {
    await saveClient({ clientId: body.clientId, clientSecret: body.clientSecret });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HealthError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

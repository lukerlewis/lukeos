import { NextResponse } from "next/server";
import { runOperation } from "@/core/operations";
import { getSession } from "@/lib/auth/session";

/** Sends a test notification to every device that has them on. Same as the send_test_notification operation. */
export async function POST() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const outcome = await runOperation("send_test_notification", {}, { kind: "user" });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(outcome.result);
}

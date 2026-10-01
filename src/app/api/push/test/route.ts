import { NextResponse } from "next/server";
import { sendPush } from "@/core/push";
import { getSession } from "@/lib/auth/session";

/** Sends a test notification to every device that has them on. */
export async function POST() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const reached = await sendPush({
    title: "LukeOS",
    body: "Notifications are working. Claude's messages will show up like this.",
    url: "/messages",
    tag: "lukeos-test",
  });
  return NextResponse.json({ reached });
}

import { NextResponse } from "next/server";
import { createDeviceInvite } from "@/lib/auth/device-invite";
import { getSession } from "@/lib/auth/session";

/** Make a one-time link for adding a new device. Only from a signed-in device. */
export async function POST() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { code, expiresAt } = await createDeviceInvite();
  return NextResponse.json({ code, expiresAt: expiresAt.toISOString() });
}

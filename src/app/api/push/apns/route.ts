import { NextResponse } from "next/server";
import { z } from "zod";
import { apnsEnvironments, removeApnsDevice, saveApnsDevice } from "@/core/apns";
import { getSession } from "@/lib/auth/session";

/** Turning notifications on and off for the iPhone app. Only for the signed-in user. */

const deviceToken = z.string().regex(/^[0-9a-fA-F]{32,200}$/, "That isn't a device token.");

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = z
    .object({ deviceToken, deviceName: z.string().trim().min(1).max(100), environment: z.enum(apnsEnvironments).default("sandbox") })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That isn't a notification sign-up." }, { status: 400 });
  await saveApnsDevice(parsed.data.deviceToken.toLowerCase(), parsed.data.deviceName, parsed.data.environment);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = z.object({ deviceToken }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing the device's token." }, { status: 400 });
  await removeApnsDevice(parsed.data.deviceToken.toLowerCase());
  return NextResponse.json({ ok: true });
}

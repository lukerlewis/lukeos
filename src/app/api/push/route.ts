import { NextResponse } from "next/server";
import { z } from "zod";
import { removePushSubscription, savePushSubscription, vapidPublicKey } from "@/core/push";
import { getSession } from "@/lib/auth/session";

/** Turning notifications on and off for this device. Only for the signed-in user. */

const subscription = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ publicKey: await vapidPublicKey() });
}

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = z
    .object({ subscription, deviceName: z.string().trim().min(1).max(100) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That isn't a notification sign-up." }, { status: 400 });
  await savePushSubscription(parsed.data.subscription, parsed.data.deviceName);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = z.object({ endpoint: z.url() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing the device's address." }, { status: 400 });
  await removePushSubscription(parsed.data.endpoint);
  return NextResponse.json({ ok: true });
}

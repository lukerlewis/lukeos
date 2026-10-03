import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { consumeChallenge } from "@/lib/auth/challenge";
import { consumeInvite, isValidInvite } from "@/lib/auth/device-invite";
import { canRegister } from "@/lib/auth/passkeys";
import { deviceNameFromUserAgent, relyingParty } from "@/lib/auth/relying-party";
import { createSession, getSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  // A new device with no passkey yet sends the one-time code from Settings alongside its passkey.
  const { invite, ...body } = (await req.json()) as RegistrationResponseJSON & { invite?: unknown };
  const allowed = await canRegister();
  if (!allowed && !(await isValidInvite(invite))) {
    return NextResponse.json({ error: "Sign in first to add another device." }, { status: 403 });
  }
  const expectedChallenge = await consumeChallenge("register");
  if (!expectedChallenge) {
    return NextResponse.json({ error: "That took too long. Please try again." }, { status: 400 });
  }
  const { rpID, origin } = relyingParty(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    console.error("[register] verification failed", err);
    return NextResponse.json({ error: "Couldn't verify that passkey. Please try again." }, { status: 400 });
  }
  if (!verification.verified) {
    return NextResponse.json({ error: "Couldn't verify that passkey. Please try again." }, { status: 400 });
  }
  // Use the code up only now, so a cancelled or failed passkey doesn't waste it.
  if (!allowed && !(await consumeInvite(invite))) {
    return NextResponse.json({ error: "This link has expired. Make a new one in Settings." }, { status: 403 });
  }

  const { credential } = verification.registrationInfo;
  const userAgent = req.headers.get("user-agent");
  await db.insert(schema.passkeys).values({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports?.join(",") ?? null,
    deviceName: deviceNameFromUserAgent(userAgent),
  });

  // First-time setup and a new device from a link sign straight in. Adding from Settings keeps the current session.
  if (!(await getSession())) await createSession({ passkeyId: credential.id, userAgent });
  return NextResponse.json({ ok: true });
}

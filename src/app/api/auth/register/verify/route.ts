import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { consumeChallenge } from "@/lib/auth/challenge";
import { canRegister } from "@/lib/auth/passkeys";
import { deviceNameFromUserAgent, relyingParty } from "@/lib/auth/relying-party";
import { createSession, getSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  if (!(await canRegister())) {
    return NextResponse.json({ error: "Sign in first to add another device." }, { status: 403 });
  }
  const expectedChallenge = await consumeChallenge("register");
  if (!expectedChallenge) {
    return NextResponse.json({ error: "That took too long. Please try again." }, { status: 400 });
  }
  const body = (await req.json()) as RegistrationResponseJSON;
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

  const { credential } = verification.registrationInfo;
  const userAgent = req.headers.get("user-agent");
  await db.insert(schema.passkeys).values({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports?.join(",") ?? null,
    deviceName: deviceNameFromUserAgent(userAgent),
  });

  // First-time setup signs you straight in. Adding a device keeps the current session.
  if (!(await getSession())) await createSession({ passkeyId: credential.id, userAgent });
  return NextResponse.json({ ok: true });
}

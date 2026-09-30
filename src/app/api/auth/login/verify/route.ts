import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { consumeChallenge } from "@/lib/auth/challenge";
import { relyingParty } from "@/lib/auth/relying-party";
import { createSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  const expectedChallenge = await consumeChallenge("login");
  if (!expectedChallenge) {
    return NextResponse.json({ error: "That took too long. Please try again." }, { status: 400 });
  }
  const body = (await req.json()) as AuthenticationResponseJSON;
  const [passkey] = await db.select().from(schema.passkeys).where(eq(schema.passkeys.id, body.id)).limit(1);
  if (!passkey) {
    return NextResponse.json({ error: "This passkey isn't recognised by LukeOS." }, { status: 400 });
  }

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
        counter: passkey.counter,
        transports: passkey.transports?.split(","),
      },
    });
  } catch (err) {
    console.error("[login] verification failed", err);
    return NextResponse.json({ error: "Couldn't sign you in. Please try again." }, { status: 400 });
  }
  if (!verification.verified) {
    return NextResponse.json({ error: "Couldn't sign you in. Please try again." }, { status: 400 });
  }

  await db
    .update(schema.passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(schema.passkeys.id, passkey.id));
  await createSession({ passkeyId: passkey.id, userAgent: req.headers.get("user-agent") });
  return NextResponse.json({ ok: true });
}

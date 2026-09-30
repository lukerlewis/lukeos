import { generateRegistrationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { saveChallenge } from "@/lib/auth/challenge";
import { canRegister, OWNER_USER_ID } from "@/lib/auth/passkeys";
import { relyingParty, RP_NAME } from "@/lib/auth/relying-party";

export async function POST(req: Request) {
  if (!(await canRegister())) {
    return NextResponse.json({ error: "Sign in first to add another device." }, { status: 403 });
  }
  const { rpID } = relyingParty(req);
  const existing = await db.select({ id: schema.passkeys.id, transports: schema.passkeys.transports }).from(schema.passkeys);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: OWNER_USER_ID,
    userName: "Luke",
    userDisplayName: "Luke",
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports?.split(",") })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await saveChallenge("register", options.challenge);
  return NextResponse.json(options);
}

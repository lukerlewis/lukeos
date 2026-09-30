import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { saveChallenge } from "@/lib/auth/challenge";
import { relyingParty } from "@/lib/auth/relying-party";

export async function POST(req: Request) {
  const { rpID } = relyingParty(req);
  // No allowCredentials: the device offers whichever LukeOS passkey it has,
  // or lets you use your phone to sign in on a computer.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  await saveChallenge("login", options.challenge);
  return NextResponse.json(options);
}

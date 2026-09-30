import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "@/db";

const CHALLENGE_COOKIE = "lukeos_challenge";
const TTL_MS = 5 * 60 * 1000;

type Purpose = "register" | "login";

export async function saveChallenge(purpose: Purpose, challenge: string) {
  const id = randomBytes(16).toString("base64url");
  await db.delete(schema.authChallenges).where(lt(schema.authChallenges.expiresAt, new Date()));
  await db.insert(schema.authChallenges).values({
    id,
    challenge,
    purpose,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  (await cookies()).set(CHALLENGE_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth",
    maxAge: TTL_MS / 1000,
  });
}

/** Returns the pending challenge for this browser and deletes it, so it can only be used once. */
export async function consumeChallenge(purpose: Purpose) {
  const jar = await cookies();
  const id = jar.get(CHALLENGE_COOKIE)?.value;
  if (!id) return null;
  jar.delete({ name: CHALLENGE_COOKIE, path: "/api/auth" });
  const [row] = await db
    .delete(schema.authChallenges)
    .where(
      and(
        eq(schema.authChallenges.id, id),
        eq(schema.authChallenges.purpose, purpose),
        gt(schema.authChallenges.expiresAt, new Date()),
      ),
    )
    .returning();
  return row?.challenge ?? null;
}

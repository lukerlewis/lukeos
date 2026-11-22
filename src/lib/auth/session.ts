import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";

export const SESSION_COOKIE = "lukeos_session";
const SESSION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(opts: { passkeyId: string | null; userAgent: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db.insert(schema.sessions).values({
    id: hash(token),
    passkeyId: opts.passkeyId,
    userAgent: opts.userAgent,
    expiresAt,
  });
  // Clear out old expired sessions while we're here.
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

/**
 * The sign-in token this request came with: the browser's cookie, or, from the
 * iPhone app (which keeps its token in the Keychain), an Authorization header.
 */
async function presentedToken(): Promise<{ token: string; fromApp: boolean } | null> {
  // The app's header comes first: the app also carries the cookie (for its web views and files),
  // and its requests have to count as the app's so it stays signed in.
  const bearer = (await headers()).get("authorization")?.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/i)?.[1];
  if (bearer) return { token: bearer, fromApp: true };
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return cookie ? { token: cookie, fromApp: false } : null;
}

/** The current session, or null if this browser isn't signed in. Checked once per page. */
export const getSession = cache(async () => {
  const presented = await presentedToken();
  if (!presented) return null;
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, hash(presented.token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  // The iPhone app stays signed in for as long as it's used: each week or so of use
  // pushes its end date back out. (A browser's cookie has its own end date, so it's left alone.)
  if (presented.fromApp && session.expiresAt.getTime() - Date.now() < (SESSION_DAYS - 7) * DAY_MS) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    await db.update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.id, session.id));
    return { ...session, expiresAt };
  }
  return session;
});

/** For pages: send signed-out visitors to the sign-in screen. */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function endSession() {
  const jar = await cookies();
  const token = (await presentedToken())?.token;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hash(token)));
  jar.delete(SESSION_COOKIE);
}

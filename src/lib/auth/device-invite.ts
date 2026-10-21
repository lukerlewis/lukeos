import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * A one-time link that lets a brand-new device (one with no passkey yet) add
 * its own passkey. Made from a signed-in device in Settings. Only one exists
 * at a time, it lasts 10 minutes and works once. The Mac app, which can't make
 * passkeys, can also sign in with the code directly; that session belongs to
 * the passkey that made the code, so removing that device signs it out too.
 */
const KEY = "device_invite";
export const INVITE_TTL_MS = 10 * 60 * 1000;
// No 0/O or 1/I/L, so it's easy to read and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

/** Upper-cases and drops anything that isn't a code character, so "abcde 23456" works. */
function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function createDeviceInvite(byPasskeyId: string | null) {
  const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const value = JSON.stringify({ hash: hash(raw), expiresAt: expiresAt.toISOString(), by: byPasskeyId });
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  return { code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expiresAt };
}

type Stored = { hash: string; expiresAt: string; by?: string | null };

function matches(value: string | undefined, code: string): Stored | null {
  if (!value || !code) return null;
  try {
    const stored = JSON.parse(value) as Stored;
    if (new Date(stored.expiresAt) <= new Date()) return null;
    const a = Buffer.from(stored.hash, "hex");
    const b = Buffer.from(hash(normalizeCode(code)), "hex");
    return a.length === b.length && timingSafeEqual(a, b) ? stored : null;
  } catch {
    return null;
  }
}

/** Checks a code without using it up. */
export async function isValidInvite(code: unknown) {
  if (typeof code !== "string" || !code) return false;
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  return matches(row?.value, code) !== null;
}

/**
 * Uses the code up. Only the one request that took it while it was still valid
 * gets back who made it; everyone else gets null.
 */
export async function consumeInvite(code: unknown): Promise<{ by: string | null } | null> {
  if (typeof code !== "string" || !code) return null;
  const [row] = await db.delete(schema.appSettings).where(eq(schema.appSettings.key, KEY)).returning();
  const stored = matches(row?.value, code);
  if (stored) return { by: stored.by ?? null };
  // A wrong code mustn't cancel a real one that's still waiting to be used.
  if (row) await db.insert(schema.appSettings).values(row).onConflictDoNothing();
  return null;
}

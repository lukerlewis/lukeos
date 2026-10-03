import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * A one-time link that lets a brand-new device (one with no passkey yet) add
 * its own passkey. Made from a signed-in device in Settings. Only one exists
 * at a time, it lasts 10 minutes and works once.
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

export async function createDeviceInvite() {
  const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const value = JSON.stringify({ hash: hash(raw), expiresAt: expiresAt.toISOString() });
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  return { code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expiresAt };
}

function matches(value: string | undefined, code: string) {
  if (!value || !code) return false;
  try {
    const stored = JSON.parse(value) as { hash: string; expiresAt: string };
    if (new Date(stored.expiresAt) <= new Date()) return false;
    const a = Buffer.from(stored.hash, "hex");
    const b = Buffer.from(hash(normalizeCode(code)), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Checks a code without using it up. */
export async function isValidInvite(code: unknown) {
  if (typeof code !== "string" || !code) return false;
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  return matches(row?.value, code);
}

/** Uses the code up. True only for the one request that took it while it was still valid. */
export async function consumeInvite(code: unknown) {
  if (typeof code !== "string" || !code) return false;
  const [row] = await db.delete(schema.appSettings).where(eq(schema.appSettings.key, KEY)).returning();
  if (matches(row?.value, code)) return true;
  // A wrong code mustn't cancel a real one that's still waiting to be used.
  if (row) await db.insert(schema.appSettings).values(row).onConflictDoNothing();
  return false;
}

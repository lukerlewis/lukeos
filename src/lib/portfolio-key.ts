import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * The key Luke's portfolio site uses to send visitors' questions to LukeOS.
 * It can only add visitor prompts. Only its hash is kept; making a new one
 * stops the old one.
 */

const KEY = "portfolio_key_hash";
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function hasPortfolioKey() {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  return Boolean(row);
}

export async function newPortfolioKey() {
  const key = `lkp_${randomBytes(24).toString("base64url")}`;
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value: hash(key) })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: hash(key) } });
  return key;
}

export async function checkPortfolioKey(key: string | null | undefined) {
  if (!key) return false;
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  if (!row) return false;
  const a = Buffer.from(row.value);
  const b = Buffer.from(hash(key));
  return a.length === b.length && timingSafeEqual(a, b);
}

import "server-only";
import { count } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "./session";

export async function passkeyCount() {
  const [row] = await db.select({ n: count() }).from(schema.passkeys);
  return row.n;
}

/** LukeOS has one owner. Until the first passkey exists, anyone reaching the site can claim it. */
export async function isSetUp() {
  return (await passkeyCount()) > 0;
}

// The one owner of LukeOS. Every passkey belongs to this same account.
export const OWNER_USER_ID = new TextEncoder().encode("lukeos-owner");

/** Creating a passkey is allowed for first-time setup, or from a signed-in device. */
export async function canRegister() {
  return !(await isSetUp()) || (await getSession()) !== null;
}

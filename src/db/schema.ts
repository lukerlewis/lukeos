import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** A passkey (Face ID, Touch ID, Windows Hello...) that can sign in to LukeOS. */
export const passkeys = pgTable("passkeys", {
  id: text("id").primaryKey(), // credential ID, base64url
  publicKey: text("public_key").notNull(), // base64url
  counter: integer("counter").notNull().default(0),
  transports: text("transports"), // comma separated
  deviceName: text("device_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

/** A signed-in browser. The cookie holds a random token; we only store its hash. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256(token), hex
  passkeyId: text("passkey_id"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** One-time WebAuthn challenges, valid for a few minutes. */
export const authChallenges = pgTable("auth_challenges", {
  id: text("id").primaryKey(),
  challenge: text("challenge").notNull(),
  purpose: text("purpose").notNull(), // "register" | "login"
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

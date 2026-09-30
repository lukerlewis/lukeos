import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

/**
 * Who made something: Luke in the app, or Claude (with the routine's name if
 * a routine did it). Shared by everything Luke and Claude can create.
 */
const madeBy = {
  createdByKind: text("created_by_kind").notNull().default("user"), // "user" | "agent"
  createdByName: text("created_by_name"), // e.g. "Claude"
  createdByRoutine: text("created_by_routine"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when moved to Trash; items are kept for 30 days.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/** A piece of work that holds tasks (and, from step 5, notes). */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  ...madeBy,
});

/** A task. Everything except the title is optional. */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("todo"), // "todo" | "doing" | "done"
    dueDate: date("due_date"), // YYYY-MM-DD, no time of day
    priority: text("priority"), // "low" | "medium" | "high"
    effort: text("effort"), // "small" | "medium" | "large"
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...madeBy,
  },
  (t) => [index("tasks_project_idx").on(t.projectId), index("tasks_due_idx").on(t.dueDate)],
);

/** Small app-wide settings, such as Luke's time zone (so "today" is his today). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

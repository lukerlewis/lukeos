import { customType, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

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

/** A piece of work that holds tasks and notes. */
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

/**
 * A note: a page of writing, inside a project or on its own. Luke's notes
 * are Markdown (headings, lists, checklists, links, photos). Claude can also
 * save a finished HTML page (an artifact), which the app shows as it is.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    format: text("format").notNull().default("markdown"), // "markdown" | "html"
    ...madeBy,
  },
  (t) => [index("notes_project_idx").on(t.projectId), index("notes_updated_idx").on(t.updatedAt)],
);

/** A photo pasted into a note, kept in the database and shown at /api/images/<id>. */
export const images = pgTable("images", {
  id: uuid("id").primaryKey().defaultRandom(),
  mimeType: text("mime_type").notNull(),
  bytes: integer("bytes").notNull(),
  data: bytea("data").notNull(),
  ...madeBy,
});

/** Small app-wide settings, such as Luke's time zone (so "today" is his today). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * An app that registered itself to connect to LukeOS (Claude on the web,
 * Claude Code...). Registering alone grants nothing: Luke still has to
 * approve a connection while signed in.
 */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(), // client_id
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").notNull(), // JSON array
  secretHash: text("secret_hash"), // only for clients that asked for a secret
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-time codes handed back to Claude after Luke approves, valid for a few minutes. */
export const oauthCodes = pgTable("oauth_codes", {
  id: text("id").primaryKey(), // sha256(code), hex
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * A Claude connection Luke approved: Claude's own key into LukeOS. Luke can
 * disconnect it from Settings, which stops it working straight away.
 */
export const agentConnections = pgTable("agent_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(), // e.g. "Claude" or "Claude Code"
  refreshTokenHash: text("refresh_token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Short-lived keys Claude sends with each request, renewed with the connection's refresh token. */
export const agentAccessTokens = pgTable(
  "agent_access_tokens",
  {
    id: text("id").primaryKey(), // sha256(token), hex
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => agentConnections.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("agent_access_tokens_connection_idx").on(t.connectionId)],
);

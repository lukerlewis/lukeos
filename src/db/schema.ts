import { customType, date, index, integer, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
    repeat: text("repeat"), // "daily" | "weekly" | "monthly"
    /** A repeating task that's done: the next one it made, so un-ticking it can take that back. */
    repeatNextId: uuid("repeat_next_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...madeBy,
  },
  (t) => [index("tasks_project_idx").on(t.projectId), index("tasks_due_idx").on(t.dueDate)],
);

/**
 * A note: Luke's own page of writing, inside a project or on its own.
 * Markdown (headings, lists, checklists, links, photos), or occasionally a
 * finished HTML page. What Claude makes on its own goes in artifacts instead.
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

/**
 * An artifact: something an agent made for Luke, such as a report or a web
 * page. It's a bundle of parts (a report, its data, a page...) with photos
 * inside them, and it keeps every version: an update adds a version rather
 * than overwriting. Luke reads and comments; he doesn't edit it.
 */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull().default(""),
    /** The latest version's number. */
    version: integer("version").notNull().default(1),
    ...madeBy,
  },
  (t) => [index("artifacts_project_idx").on(t.projectId), index("artifacts_updated_idx").on(t.updatedAt)],
);

/** One version of an artifact. Versions are never changed once made. */
export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    /** What changed from the version before, e.g. "Charts now weekly, as Luke asked". */
    note: text("note"),
    createdByKind: text("created_by_kind").notNull().default("agent"),
    createdByName: text("created_by_name"),
    createdByRoutine: text("created_by_routine"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("artifact_versions_number_unique").on(t.artifactId, t.number)],
);

/** A part of one version: a Markdown document or an HTML page, shown as a tab when there are several. */
export const artifactParts = pgTable(
  "artifact_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => artifactVersions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull().default(""),
    format: text("format").notNull().default("markdown"), // "markdown" | "html"
    content: text("content").notNull().default(""),
  },
  (t) => [index("artifact_parts_version_idx").on(t.versionId)],
);

/**
 * A comment on a note or an artifact, by Luke or Claude. It can quote the
 * words it's about, and on an artifact it records which version it was
 * made on. Replies point at the comment they answer. Resolving closes it.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(), // "note" | "artifact"
    targetId: uuid("target_id").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    /** Artifacts only: the version number it was made on. */
    version: integer("version"),
    /** The words it's about, if Luke picked some. */
    quote: text("quote"),
    body: text("body").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...madeBy,
  },
  (t) => [index("comments_target_idx").on(t.targetType, t.targetId)],
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

/**
 * A short line for each change Claude made through the connector ("Added task
 * "Call Mum""), shown as the activity log in the Agents section.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    agentName: text("agent_name").notNull(), // e.g. "Claude"
    routine: text("routine"),
    tool: text("tool").notNull(),
    summary: text("summary").notNull(),
    itemType: text("item_type"), // "task" | "note" | "artifact" | "project", when it's about one thing
    itemId: uuid("item_id"),
  },
  (t) => [index("activity_log_at_idx").on(t.at)],
);

import { sql } from "drizzle-orm";
import { boolean, customType, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
    /** Which list it's in: "today" | "tomorrow" | "this_week" | "later". Set by hand, separate from the due date. */
    bucket: text("bucket").notNull().default("today"),
    priority: text("priority"), // "low" | "medium" | "high"
    effort: text("effort"), // "small" | "medium" | "large"
    notes: text("notes"),
    repeat: text("repeat"), // "daily" | "weekdays" | "weekly" | "monthly" | "yearly"
    /** A repeating task that's done: the next one it made, so un-ticking it can take that back. */
    repeatNextId: uuid("repeat_next_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...madeBy,
  },
  (t) => [index("tasks_project_idx").on(t.projectId), index("tasks_due_idx").on(t.dueDate)],
);

/**
 * A folder in Notes. One level only (no folders inside folders), and a note
 * sits in at most one. A folder can be attached to a project, so its notes
 * show on that project too. Deleting a folder keeps its notes: they become
 * unfiled.
 */
export const noteFolders = pgTable("note_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  createdByKind: madeBy.createdByKind,
  createdByName: madeBy.createdByName,
  createdByRoutine: madeBy.createdByRoutine,
  createdAt: madeBy.createdAt,
  updatedAt: madeBy.updatedAt,
});

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
    /** The folder it's filed in, if any. */
    folderId: uuid("folder_id").references(() => noteFolders.id, { onDelete: "set null" }),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    format: text("format").notNull().default("markdown"), // "markdown" | "html"
    /** "note", or "scratchpad" for the one scratch pad on the dashboard, which stays out of Notes. */
    kind: text("kind").notNull().default("note"),
    /** When Luke pinned it to the top of his notes; null when it isn't pinned. */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    ...madeBy,
  },
  (t) => [index("notes_project_idx").on(t.projectId), index("notes_folder_idx").on(t.folderId), index("notes_updated_idx").on(t.updatedAt)],
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
 * A comment on a note, an artifact or a task, by Luke or Claude. It can quote the
 * words it's about, and on an artifact it records which version it was
 * made on. Replies point at the comment they answer. Resolving closes it.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(), // "note" | "artifact" | "task"
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

/**
 * An @claude request: somewhere Luke wrote "@claude" (a note, a task, a
 * comment), so Claude knows what he asked, where and when, and whether it's
 * been dealt with. In a note the tag carries this row's id, so editing the
 * words around it doesn't make a new request; elsewhere it's matched by the
 * line it's on.
 */
export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(), // "note" | "task" | "comment"
    targetId: uuid("target_id").notNull(),
    /** The line the tag is on: what Luke is asking. */
    context: text("context").notNull(),
    /** True when the tag in the text carries this row's id (notes). */
    anchored: boolean("anchored").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"), // e.g. "Claude", or null for Luke
    /** What Claude says it did. */
    reply: text("reply"),
    /** Set when a request that was already dealt with is taken out of the text; kept as history. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [index("mentions_target_idx").on(t.targetType, t.targetId)],
);

/**
 * An SOP: written instructions telling Claude how Luke wants something done,
 * like a skill. Only the title and description are shown to Claude up front;
 * it reads the body when a request matches, which keeps every call cheap.
 */
export const sops = pgTable(
  "sops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default(""),
    /** What it covers and when to use it. Claude always sees this, so it stays short. */
    description: text("description").notNull().default(""),
    /** The full instructions, in Markdown. */
    body: text("body").notNull().default(""),
    ...madeBy,
  },
  (t) => [index("sops_title_idx").on(t.title)],
);

/**
 * A context file: background Claude should know, like who Luke is or who his
 * audience is. Like an SOP, only the title and description are shown up front;
 * Claude reads the body when it's relevant to what it's doing.
 */
export const contextFiles = pgTable(
  "context_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default(""),
    /** What it covers and when it's relevant. Claude always sees this, so it stays short. */
    description: text("description").notNull().default(""),
    /** The context itself, in Markdown. */
    body: text("body").notNull().default(""),
    ...madeBy,
  },
  (t) => [index("context_files_title_idx").on(t.title)],
);

/**
 * A routine: something Luke wants an agent to do on a schedule, like an end
 * of day recap. It lives here rather than in Claude, so any agent that checks
 * in (get_inbox) can see what's due and do it.
 */
export const routines = pgTable("routines", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default(""),
  /** What to do, in Markdown. */
  instructions: text("instructions").notNull().default(""),
  /** An SOP to follow while doing it, if any. */
  sopId: uuid("sop_id"),
  frequency: text("frequency").notNull().default("daily"), // "daily" | "weekly" | "monthly"
  /** Time of day in Luke's time zone, "HH:MM". */
  time: text("time").notNull().default("20:00"),
  /** Weekly only: which days, 0 = Sunday ... 6 = Saturday. */
  days: integer("days").array().notNull().default([1, 2, 3, 4, 5]),
  /** Monthly only: the day of the month. Past the end of a short month, it runs on the last day. */
  dayOfMonth: integer("day_of_month").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  /** When the schedule last changed or it was turned on, so times before then aren't counted as due or missed. */
  scheduledFrom: timestamp("scheduled_from", { withTimezone: true }).notNull().defaultNow(),
  ...madeBy,
});

/** One time a routine was due: who picked it up, and how it went. One row per routine per due time. */
export const routineRuns = pgTable(
  "routine_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    /** The scheduled time this run is for. */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(), // "running" | "done" | "failed" | "missed"
    agentName: text("agent_name"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** What the agent says it did. */
    summary: text("summary"),
    /** What it made, if anything. */
    artifactId: uuid("artifact_id"),
  },
  (t) => [unique("routine_runs_once").on(t.routineId, t.dueAt), index("routine_runs_due_idx").on(t.dueAt)],
);

/**
 * An entry in Luke's Work archive: a piece of work he's done, kept as raw
 * material for case studies, his portfolio and content. Anything from a quick
 * win to a multi-year project. The story is Markdown with photos in it; the
 * first photo is the cover.
 */
export const archiveEntries = pgTable(
  "archive_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default(""),
    size: text("size").notNull().default("win"), // "win" | "story" | "project"
    stage: text("stage").notNull().default("raw"), // "raw" | "drafted" | "published"
    story: text("story").notNull().default(""),
    company: text("company"),
    role: text("role"),
    /** When it happened, in Luke's words, e.g. "2021 to 2024" or "March 2025". */
    period: text("period"),
    /** The result, in a line. */
    outcome: text("outcome"),
    /** Names a client or has internal numbers, so it needs disguising before it's shared. */
    confidential: boolean("confidential").notNull().default(false),
    ...madeBy,
  },
  (t) => [index("archive_entries_updated_idx").on(t.updatedAt)],
);

/**
 * A file (a PDF, a short video...) or a link (Figma, a live site, a video)
 * kept with a Work archive entry. Files are stored in the database, like
 * photos, and shown at /api/files/<id>.
 */
export const archiveFiles = pgTable(
  "archive_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => archiveEntries.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "file" | "link"
    name: text("name").notNull().default(""),
    /** Links only. */
    url: text("url"),
    /** Files only. */
    mimeType: text("mime_type"),
    bytes: integer("bytes"),
    data: bytea("data"),
    createdByKind: madeBy.createdByKind,
    createdByName: madeBy.createdByName,
    createdByRoutine: madeBy.createdByRoutine,
    createdAt: madeBy.createdAt,
  },
  (t) => [index("archive_files_entry_idx").on(t.entryId)],
);

/**
 * A file kept in storage: Vercel Blob when it's set up (backend "blob"), or
 * the database otherwise ("db", bytes in `data`). Shown at /api/stored/<id>.
 * Used by Inspiration for its pictures and PDFs.
 */
export const storedFiles = pgTable("stored_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  backend: text("backend").notNull(), // "blob" | "db"
  /** Blob only: where it lives, and whether the store is "private" or "public". */
  blobUrl: text("blob_url"),
  access: text("access"),
  mimeType: text("mime_type").notNull(),
  bytes: integer("bytes").notNull(),
  data: bytea("data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Something saved to Inspiration: a picture, a link (with its preview), a
 * video link, a quote or a PDF. Shown in a gallery and tagged by Claude.
 */
export const inspirationItems = pgTable(
  "inspiration_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // "image" | "link" | "video" | "text" | "file"
    title: text("title").notNull().default(""),
    /** Links and videos: the address. Pictures: where it came from, if known. */
    url: text("url"),
    /** Quotes and text snippets. */
    body: text("body").notNull().default(""),
    /** Luke's own note about it. */
    note: text("note").notNull().default(""),
    /** Claude's short description, so search finds it by what's in it. */
    summary: text("summary"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** The picture (about 2000px) and its small copy for the gallery. */
    imageId: uuid("image_id").references(() => storedFiles.id, { onDelete: "set null" }),
    thumbId: uuid("thumb_id").references(() => storedFiles.id, { onDelete: "set null" }),
    width: integer("width"),
    height: integer("height"),
    /** PDFs and other files. */
    fileId: uuid("file_id").references(() => storedFiles.id, { onDelete: "set null" }),
    fileName: text("file_name"),
    /** When Claude last tagged and described it. Empty means it's waiting for the next check-in. */
    taggedAt: timestamp("tagged_at", { withTimezone: true }),
    ...madeBy,
  },
  (t) => [index("inspiration_items_created_idx").on(t.createdAt), index("inspiration_items_project_idx").on(t.projectId)],
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
    itemType: text("item_type"), // "task" | "note" | "artifact" | "project" | "sop" | "routine" | "entry" | "inspiration" | "context", when it's about one thing
    itemId: uuid("item_id"),
  },
  (t) => [index("activity_log_at_idx").on(t.at)],
);

export type MessageAttachmentRow = {
  fileId: string;
  /** Photos: a small copy for the chain. */
  thumbId?: string | null;
  kind: "image" | "video" | "file";
  name: string;
  mimeType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
};

/**
 * One text in the Messages chain between Luke and Claude. Luke's messages
 * wait until Claude answers them at a check-in; Claude's messages are unread
 * until Luke opens Messages.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    body: text("body").notNull(),
    /** Something in LukeOS the message is about, shown as a card under it. */
    linkType: text("link_type"), // "task" | "note" | "artifact" | "project" | "routine" | "entry"
    linkId: uuid("link_id"),
    /** Photos, videos and files sent with it, kept in stored_files. */
    attachments: jsonb("attachments").$type<MessageAttachmentRow[]>().notNull().default([]),
    /** Claude's messages: when Luke saw it. */
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Luke's messages: when Claude dealt with it, and the reply that did. */
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    answeredBy: uuid("answered_by"),
    createdByKind: text("created_by_kind").notNull().default("user"), // "user" | "agent"
    createdByName: text("created_by_name"),
    createdByRoutine: text("created_by_routine"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_created_idx").on(t.createdAt)],
);

/** A browser or phone that has said yes to notifications. */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: text("device_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
});

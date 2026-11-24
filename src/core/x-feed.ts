import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { defineOperation, madeByColumns, madeByOf, OperationError, type Actor, type MadeBy } from "./define";

const { xPeople, xPosts, xReplies, appSettings } = schema;

/**
 * Luke's X feed: posts from the people he picks, and his replies to them.
 * LukeOS never talks to X itself. A Claude routine reads the posts in Luke's
 * own signed-in browser and saves them here, and posts his queued replies
 * on X exactly as he wrote them.
 */

const SEEN_KEY = "x_feed_seen_at";

export type XPerson = {
  id: string;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  url: string;
  checkedAt: Date | null;
  createdAt: Date;
};

export type XReplyStatus = "draft" | "queued" | "sent" | "failed";

export type XReply = {
  id: string;
  postId: string;
  text: string;
  status: XReplyStatus;
  error: string | null;
  replyUrl: string | null;
  sentAt: Date | null;
  madeBy: MadeBy;
  createdAt: Date;
  updatedAt: Date;
};

export type XPost = {
  id: string;
  xId: string;
  url: string;
  text: string;
  kind: "post" | "quote" | "reply";
  context: { author: string | null; text: string | null; url: string | null } | null;
  media: string[];
  postedAt: Date;
  /** Saved since Luke last opened the feed. */
  isNew: boolean;
  person: Pick<XPerson, "id" | "handle" | "name" | "avatarUrl">;
  replies: XReply[];
};

function toPerson(row: typeof xPeople.$inferSelect): XPerson {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    avatarUrl: row.avatarUrl,
    url: `https://x.com/${row.handle}`,
    checkedAt: row.checkedAt,
    createdAt: row.createdAt,
  };
}

function toReply(row: typeof xReplies.$inferSelect): XReply {
  return {
    id: row.id,
    postId: row.postId,
    text: row.text,
    status: row.status as XReplyStatus,
    error: row.error,
    replyUrl: row.replyUrl,
    sentAt: row.sentAt,
    madeBy: madeByOf(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** "@Name", "x.com/Name" or "https://twitter.com/Name/status/1" all give "Name". */
export function cleanHandle(raw: string) {
  const s = raw.trim();
  const fromUrl = s.match(/(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i);
  const handle = fromUrl ? fromUrl[1] : s.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new OperationError("That doesn't look like an X username.");
  return handle;
}

export async function seenAt() {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SEEN_KEY)).limit(1);
  return row ? new Date(row.value) : new Date(0);
}

async function markSeen() {
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key: SEEN_KEY, value: now }).onConflictDoUpdate({ target: appSettings.key, set: { value: now } });
  return { seenAt: now };
}

export async function listPeople(): Promise<XPerson[]> {
  const rows = await db.select().from(xPeople).orderBy(sql`lower(coalesce(${xPeople.name}, ${xPeople.handle}))`);
  return rows.map(toPerson);
}

async function getPerson(id: string) {
  const [row] = await db.select().from(xPeople).where(eq(xPeople.id, id)).limit(1);
  if (!row) throw new OperationError("Luke doesn't follow that person in his X feed.", 404);
  return toPerson(row);
}

async function personByHandle(handle: string) {
  const [row] = await db
    .select()
    .from(xPeople)
    .where(sql`lower(${xPeople.handle}) = ${handle.toLowerCase()}`)
    .limit(1);
  return row ? toPerson(row) : null;
}

/** The feed, newest first: everyone's posts, or one person's, each with Luke's replies. */
export async function getFeed(filter: { personId?: string; before?: string; limit?: number } = {}) {
  const limit = filter.limit ?? 50;
  const [seen, people] = await Promise.all([seenAt(), listPeople()]);
  const conditions = [
    filter.personId ? eq(xPosts.personId, filter.personId) : undefined,
    filter.before ? lt(xPosts.postedAt, new Date(filter.before)) : undefined,
  ].filter((c) => c !== undefined);
  const rows = await db
    .select()
    .from(xPosts)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(xPosts.postedAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const replies = page.length
    ? await db.select().from(xReplies).where(inArray(xReplies.postId, page.map((p) => p.id))).orderBy(xReplies.createdAt)
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const posts: XPost[] = page.map((row) => {
    const p = byId.get(row.personId)!;
    return {
      id: row.id,
      xId: row.xId,
      url: row.url,
      text: row.text,
      kind: row.kind as XPost["kind"],
      context: row.context ?? null,
      media: row.media,
      postedAt: row.postedAt,
      isNew: row.createdAt > seen,
      person: { id: p.id, handle: p.handle, name: p.name, avatarUrl: p.avatarUrl },
      replies: replies.filter((r) => r.postId === row.id).map(toReply),
    };
  });
  const checks = people.map((p) => p.checkedAt?.getTime() ?? 0);
  return {
    people,
    posts,
    /** Pass as "before" to get the next, older page. */
    more: rows.length > limit ? page[page.length - 1].postedAt.toISOString() : null,
    /** When Claude last checked X for new posts. */
    checkedAt: checks.length && Math.max(...checks) > 0 ? new Date(Math.max(...checks)) : null,
    seenAt: seen,
    /** When this was read, for showing how long ago things happened. */
    now: new Date(),
  };
}

/** How many posts arrived since Luke last opened the feed. */
export async function newPostCount() {
  const seen = await seenAt();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(xPosts).where(sql`${xPosts.createdAt} > ${seen}`);
  return row?.n ?? 0;
}

async function getReply(id: string) {
  const [row] = await db.select().from(xReplies).where(eq(xReplies.id, id)).limit(1);
  if (!row) throw new OperationError("That reply doesn't exist.", 404);
  return toReply(row);
}

async function assertPost(id: string) {
  const [row] = await db.select({ id: xPosts.id }).from(xPosts).where(eq(xPosts.id, id)).limit(1);
  if (!row) throw new OperationError("That post isn't in Luke's X feed.", 404);
}

/** Only Luke can send a reply to X. Anything Claude writes stays a draft until he sends it himself. */
function assertLuke(actor: Actor, what: string) {
  if (actor.kind !== "user") throw new OperationError(`Only Luke can ${what}, from the app. Replies go out on X only as he wrote them.`, 403);
}

const replyText = z.string().trim().min(1, "Write a reply.").max(4000).describe("The reply, exactly as it should appear on X.");
const personId = z.uuid().describe("The followed person's id (from list_x_people).");
const replyId = z.uuid().describe("The reply's id.");

const postInput = z.object({
  xId: z
    .string()
    .regex(/^\d{1,30}$/, "X's post id is the number at the end of its address.")
    .describe("X's id for the post: the number at the end of its address (x.com/<handle>/status/<id>)."),
  text: z.string().max(25000).default("").describe("The post's full text, exactly as on X."),
  postedAt: z.iso.datetime({ offset: true }).describe("When it was posted, as an ISO time (the datetime on the post's <time> element)."),
  kind: z
    .enum(["post", "quote", "reply"])
    .default("post")
    .describe("post: their own post. quote: they quote someone else's post. reply: they replied to someone else."),
  context: z
    .object({
      author: z.string().max(200).nullable().optional(),
      text: z.string().max(5000).nullable().optional(),
      url: z.string().max(2000).nullable().optional(),
    })
    .nullable()
    .optional()
    .describe("For a quote or reply: the other post (author's @handle, its text, its address), when it's shown."),
  media: z.array(z.url().max(2000)).max(4).default([]).describe("Addresses of the post's pictures (pbs.twimg.com), up to 4."),
});

export const xFeedOperations = {
  list_x_people: defineOperation({
    name: "list_x_people",
    description: "List the people Luke follows in his X feed (handle, name, picture, and when Claude last checked their profile on X).",
    input: z.object({}),
    run: async () => listPeople(),
  }),

  follow_x_person: defineOperation({
    name: "follow_x_person",
    description:
      "Add someone to Luke's X feed, by their X username (with or without the @, or their profile address). Their new posts show up after the next X feed run. Following here doesn't follow them on X.",
    input: z.object({
      handle: z.string().trim().min(1, "Add a username.").max(200).describe("Their X username, e.g. @AnthropicAI, or their profile address."),
      name: z.string().trim().max(200).optional().describe("Their display name, if known."),
    }),
    run: async ({ handle: raw, name }, { actor }) => {
      const handle = cleanHandle(raw);
      const existing = await personByHandle(handle);
      if (existing) return existing;
      const [row] = await db
        .insert(xPeople)
        .values({ handle, name: name || null, ...madeByColumns(actor) })
        .returning();
      return toPerson(row);
    },
  }),

  update_x_person: defineOperation({
    name: "update_x_person",
    description: "Change a followed person's handle, display name or profile picture address (e.g. when they've changed it on X). Fields left out stay as they are.",
    input: z.object({
      id: personId,
      handle: z.string().trim().min(1).max(200).optional(),
      name: z.string().trim().max(200).nullable().optional(),
      avatarUrl: z.url().max(2000).nullable().optional(),
    }),
    run: async ({ id, handle, name, avatarUrl }) => {
      await getPerson(id);
      await db
        .update(xPeople)
        .set({
          ...(handle !== undefined && { handle: cleanHandle(handle) }),
          ...(name !== undefined && { name: name || null }),
          ...(avatarUrl !== undefined && { avatarUrl }),
          updatedAt: new Date(),
        })
        .where(eq(xPeople.id, id));
      return getPerson(id);
    },
  }),

  unfollow_x_person: defineOperation({
    name: "unfollow_x_person",
    description: "Take someone out of Luke's X feed, with their saved posts and Luke's replies to them (for good). Only when Luke asks. Doesn't unfollow them on X.",
    input: z.object({ id: personId }),
    run: async ({ id }) => {
      const person = await getPerson(id);
      await db.delete(xPeople).where(eq(xPeople.id, id));
      return { unfollowed: id, handle: person.handle };
    },
  }),

  get_x_feed: defineOperation({
    name: "get_x_feed",
    description:
      "Luke's X feed, newest first: posts from the people he follows, each with his replies and their state (draft: written by Claude, waits for Luke; queued: waiting to be posted on X; sent; failed). Also when Claude last checked X.",
    input: z.object({
      personId: personId.optional().describe("Only this person's posts."),
      before: z.iso.datetime({ offset: true }).optional().describe("Only posts older than this (the 'more' value from the previous page)."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => getFeed(filter),
  }),

  save_x_posts: defineOperation({
    name: "save_x_posts",
    description:
      "For the X feed routine: save posts read from a followed person's profile on X. Posts already saved are skipped (matched by xId), so it's safe to pass everything visible. Also records that their profile was checked, and can update their name and picture. Copy text exactly; never summarise or rewrite it.",
    input: z.object({
      personId,
      name: z.string().trim().max(200).optional().describe("Their display name as shown on X."),
      avatarUrl: z.url().max(2000).optional().describe("Their profile picture address."),
      posts: z.array(postInput).max(100).describe("Their posts, as shown on their profile. Leave out reposts of other people's posts."),
    }),
    run: async ({ personId: id, name, avatarUrl, posts }, { actor }) => {
      const person = await getPerson(id);
      const now = new Date();
      await db
        .update(xPeople)
        .set({ checkedAt: now, ...(name && { name }), ...(avatarUrl && { avatarUrl }), updatedAt: now })
        .where(eq(xPeople.id, id));
      if (posts.length === 0) return { added: 0, skipped: 0 };
      const inserted = await db
        .insert(xPosts)
        .values(
          posts.map((p) => ({
            personId: id,
            xId: p.xId,
            url: `https://x.com/${person.handle}/status/${p.xId}`,
            text: p.text,
            kind: p.kind,
            context: p.context ? { author: p.context.author ?? null, text: p.context.text ?? null, url: p.context.url ?? null } : null,
            media: p.media,
            postedAt: new Date(p.postedAt),
            ...madeByColumns(actor),
          })),
        )
        .onConflictDoNothing({ target: xPosts.xId })
        .returning({ id: xPosts.id });
      return { added: inserted.length, skipped: posts.length - inserted.length };
    },
  }),

  delete_x_post: defineOperation({
    name: "delete_x_post",
    description: "Remove a post from Luke's X feed (only in LukeOS, never on X), with any replies to it that haven't been posted. Only when Luke asks.",
    input: z.object({ id: z.uuid().describe("The post's id in LukeOS.") }),
    run: async ({ id }) => {
      await assertPost(id);
      await db.delete(xPosts).where(eq(xPosts.id, id));
      return { deleted: id };
    },
  }),

  write_x_reply: defineOperation({
    name: "write_x_reply",
    description:
      "Write a reply to a post in Luke's X feed. When Luke writes one it's queued, and the X feed routine posts it on X exactly as written. When Claude writes one it's only a draft: it shows in the app for Luke to edit and send, and is never posted until he does.",
    input: z.object({ postId: z.uuid().describe("The post's id in LukeOS."), text: replyText }),
    run: async ({ postId, text }, { actor }) => {
      await assertPost(postId);
      const [row] = await db
        .insert(xReplies)
        .values({ postId, text, status: actor.kind === "user" ? "queued" : "draft", ...madeByColumns(actor) })
        .returning();
      return toReply(row);
    },
  }),

  update_x_reply: defineOperation({
    name: "update_x_reply",
    description:
      "Change a reply that hasn't been posted yet. Claude can only change its own drafts. send: true (Luke only, from the app) queues a draft, or a reply that couldn't be posted, to go out on the next X feed run.",
    input: z.object({ id: replyId, text: replyText.optional(), send: z.boolean().optional().describe("Luke only: queue it to be posted on X.") }),
    run: async ({ id, text, send }, { actor }) => {
      const reply = await getReply(id);
      if (reply.status === "sent") throw new OperationError("That reply is already on X, so it can't be changed here.");
      if (actor.kind !== "user" && reply.status !== "draft") throw new OperationError("Claude can only change its own drafts. Luke's replies go out exactly as he wrote them.", 403);
      if (send) assertLuke(actor, "send a reply");
      await db
        .update(xReplies)
        .set({
          ...(text !== undefined && { text }),
          // Luke editing Claude's draft makes it his words.
          ...(text !== undefined && actor.kind === "user" && reply.madeBy.kind === "agent" && madeByColumns(actor)),
          ...(send && { status: "queued", error: null }),
          updatedAt: new Date(),
        })
        .where(eq(xReplies.id, id));
      return getReply(id);
    },
  }),

  delete_x_reply: defineOperation({
    name: "delete_x_reply",
    description: "Cancel a reply that hasn't been posted on X yet (a draft, or one still waiting). Claude can only delete its own drafts, or Luke's when he asks.",
    input: z.object({ id: replyId }),
    run: async ({ id }) => {
      const reply = await getReply(id);
      if (reply.status === "sent") throw new OperationError("That reply is already on X. Delete it there.");
      await db.delete(xReplies).where(eq(xReplies.id, id));
      return { deleted: id, postId: reply.postId, text: reply.text };
    },
  }),

  list_x_replies_to_send: defineOperation({
    name: "list_x_replies_to_send",
    description:
      "For the X feed routine: Luke's replies waiting to be posted on X, oldest first, each with the post to reply to. Post each one's text exactly as given, character for character, then call mark_x_reply_sent (or mark_x_reply_failed).",
    input: z.object({}),
    run: async () => {
      const rows = await db
        .select({ reply: xReplies, post: xPosts, person: xPeople })
        .from(xReplies)
        .innerJoin(xPosts, eq(xReplies.postId, xPosts.id))
        .innerJoin(xPeople, eq(xPosts.personId, xPeople.id))
        .where(and(eq(xReplies.status, "queued"), eq(xReplies.createdByKind, "user")))
        .orderBy(xReplies.createdAt);
      return rows.map(({ reply, post, person }) => ({
        id: reply.id,
        text: reply.text,
        replyTo: { url: post.url, handle: person.handle, text: post.text, postedAt: post.postedAt },
        queuedAt: reply.updatedAt,
      }));
    },
  }),

  mark_x_reply_sent: defineOperation({
    name: "mark_x_reply_sent",
    description: "For the X feed routine: record that a queued reply is now posted on X, with its address if you have it. Call it straight after posting, so it's never posted twice.",
    input: z.object({ id: replyId, replyUrl: z.url().max(2000).optional().describe("The reply's own address on X.") }),
    run: async ({ id, replyUrl }) => {
      const reply = await getReply(id);
      if (reply.status !== "queued" && reply.status !== "failed") throw new OperationError(`That reply is ${reply.status}, not waiting to be posted.`);
      await db
        .update(xReplies)
        .set({ status: "sent", sentAt: new Date(), replyUrl: replyUrl ?? null, error: null, updatedAt: new Date() })
        .where(eq(xReplies.id, id));
      return getReply(id);
    },
  }),

  mark_x_reply_failed: defineOperation({
    name: "mark_x_reply_failed",
    description: "For the X feed routine: record that a queued reply couldn't be posted on X, and why in a few plain words. Luke sees the reason and can try again.",
    input: z.object({ id: replyId, error: z.string().trim().min(1).max(500).describe("Why, in plain words, e.g. 'The post was deleted.'") }),
    run: async ({ id, error }) => {
      const reply = await getReply(id);
      if (reply.status !== "queued") throw new OperationError(`That reply is ${reply.status}, not waiting to be posted.`);
      await db.update(xReplies).set({ status: "failed", error, updatedAt: new Date() }).where(eq(xReplies.id, id));
      return getReply(id);
    },
  }),

  mark_x_feed_seen: defineOperation({
    name: "mark_x_feed_seen",
    description: "Clear the New markers on X feed posts, as if Luke had opened the feed.",
    input: z.object({}),
    run: async () => markSeen(),
  }),
};

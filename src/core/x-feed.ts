import "server-only";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { defineOperation, madeByColumns, madeByOf, OperationError, type Actor, type MadeBy } from "./define";

const { xPeople, xPosts, xReplies, xActions, xEngagements, appSettings } = schema;

/**
 * Luke's X feed: posts from the people he picks, and his replies to them.
 * LukeOS never talks to X itself. A Claude routine reads the posts in Luke's
 * own signed-in browser and saves them here, and posts his queued replies
 * on X exactly as he wrote them.
 */

const SEEN_KEY = "x_feed_seen_at";

/** Luke only wants recent posts: anything posted more than 2 days ago drops out of the feed. */
const KEEP_MS = 2 * 24 * 60 * 60 * 1000;
const keepFrom = () => new Date(Date.now() - KEEP_MS);
/** A post with one of Luke's replies still waiting to go out stays, so the reply isn't lost. */
const pendingReply = sql`exists (select 1 from ${xReplies} where ${xReplies.postId} = ${xPosts.id} and ${xReplies.status} <> 'sent')`;

/** Deletes posts older than 2 days (keeping any with a reply still to post). */
async function clearOldPosts() {
  const gone = await db
    .delete(xPosts)
    .where(and(lt(xPosts.postedAt, keepFrom()), sql`not ${pendingReply}`))
    .returning({ id: xPosts.id });
  return gone.length;
}

export type XPerson = {
  id: string;
  handle: string;
  name: string | null;
  company: string | null;
  avatarUrl: string | null;
  url: string;
  checkedAt: Date | null;
  /** Following them on X (pending until Claude does it at the next check-in). */
  follow: XActionState;
  /** They've replied to or mentioned Luke on X: how often, and the latest. Null if never. */
  engaged: XEngaged | null;
  createdAt: Date;
};

/**
 * How someone engages with Luke on X. The badge and filter count replies, mentions and messages
 * in the last 30 days (count, last*); likes and the all-time totals are for his records.
 */
export type XEngaged = {
  count: number;
  lastAt: Date;
  lastUrl: string;
  lastText: string;
  replies: number;
  mentions: number;
  likes: number;
  dms: number;
  /** The latest anything, likes included. */
  lastAnyAt: Date;
};

export const engagementKinds = ["reply", "mention", "like", "dm"] as const;

/** How long a reply to Luke keeps someone marked as talking with him. */
const ENGAGED_DAYS = 30;

export type XReplyStatus = "draft" | "queued" | "sent" | "failed";
/** reply: under their post. quote: Luke's own post quoting theirs. */
export type XReplyKind = "reply" | "quote";

export type XReply = {
  id: string;
  postId: string;
  kind: XReplyKind;
  text: string;
  status: XReplyStatus;
  error: string | null;
  replyUrl: string | null;
  sentAt: Date | null;
  madeBy: MadeBy;
  createdAt: Date;
  updatedAt: Date;
};

export type XContext = { author: string | null; text: string | null; url: string | null; media?: string[] };

export const actionKinds = ["like", "repost", "bookmark"] as const;
export type XActionKind = (typeof actionKinds)[number];
/** on: what Luke wants. pending: not done on X yet (Claude does it at the next check-in). */
export type XActionState = { on: boolean; pending: boolean; error: string | null; /** What it is on X now. */ done: boolean };

export type XPost = {
  id: string;
  xId: string;
  url: string;
  text: string;
  kind: "post" | "quote" | "reply";
  /** The post it quotes or replies to: who wrote it, its text, its address, its pictures. */
  context: XContext | null;
  media: string[];
  postedAt: Date;
  /** Saved since Luke last opened the feed. */
  isNew: boolean;
  person: Pick<XPerson, "id" | "handle" | "name" | "company" | "avatarUrl" | "follow" | "engaged">;
  replies: XReply[];
  actions: Record<XActionKind, XActionState>;
};

function toPerson(row: typeof xPeople.$inferSelect, engaged: XEngaged | null = null): XPerson {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    company: row.company,
    avatarUrl: row.avatarUrl,
    url: `https://x.com/${row.handle}`,
    checkedAt: row.checkedAt,
    follow: followState(row),
    engaged,
    createdAt: row.createdAt,
  };
}

function followState(row: typeof xPeople.$inferSelect): XActionState {
  const done = row.following ?? false;
  const on = row.followWant ?? done;
  return { on, pending: row.followWant !== null && row.followWant !== done, error: row.followError, done };
}

function toReply(row: typeof xReplies.$inferSelect): XReply {
  return {
    id: row.id,
    postId: row.postId,
    kind: row.kind === "quote" ? "quote" : "reply",
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

/** How each person has engaged with Luke, by person id. Only people who replied, mentioned or messaged him in the last 30 days. */
async function engagedByPerson(personId?: string) {
  const since = new Date(Date.now() - ENGAGED_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(xEngagements)
    .where(personId ? eq(xEngagements.personId, personId) : undefined)
    .orderBy(desc(xEngagements.at));
  const totals = new Map<string, Pick<XEngaged, "replies" | "mentions" | "likes" | "dms" | "lastAnyAt">>();
  const recent = new Map<string, Pick<XEngaged, "count" | "lastAt" | "lastUrl" | "lastText">>();
  for (const r of rows) {
    const t = totals.get(r.personId) ?? { replies: 0, mentions: 0, likes: 0, dms: 0, lastAnyAt: r.at };
    if (r.kind === "reply") t.replies++;
    else if (r.kind === "mention") t.mentions++;
    else if (r.kind === "like") t.likes++;
    else if (r.kind === "dm") t.dms++;
    totals.set(r.personId, t);
    if (r.kind !== "like" && r.at > since) {
      const e = recent.get(r.personId);
      if (e) e.count++;
      else recent.set(r.personId, { count: 1, lastAt: r.at, lastUrl: r.url ?? `https://x.com/messages`, lastText: r.text });
    }
  }
  const out = new Map<string, XEngaged>();
  for (const [id, e] of recent) out.set(id, { ...e, ...totals.get(id)! });
  return { engaged: out, totals };
}

export async function listPeople(): Promise<XPerson[]> {
  const [rows, engaged] = await Promise.all([
    db.select().from(xPeople).orderBy(sql`lower(coalesce(${xPeople.name}, ${xPeople.handle}))`),
    engagedByPerson(),
  ]);
  return rows.map((r) => toPerson(r, engaged.engaged.get(r.id) ?? null));
}

async function getPerson(id: string) {
  const [row] = await db.select().from(xPeople).where(eq(xPeople.id, id)).limit(1);
  if (!row) throw new OperationError("Luke doesn't follow that person in his X feed.", 404);
  return toPerson(row, (await engagedByPerson(id)).engaged.get(id) ?? null);
}

async function personByHandle(handle: string) {
  const [row] = await db
    .select()
    .from(xPeople)
    .where(sql`lower(${xPeople.handle}) = ${handle.toLowerCase()}`)
    .limit(1);
  return row ? toPerson(row) : null;
}

export const feedViews = ["day", "engaged", "unreplied", "replied", "pictures"] as const;
export type FeedView = (typeof feedViews)[number];

export type FeedFilter = {
  personId?: string;
  /** Only people at this company. */
  company?: string;
  /** day: posted in the last 24 hours. engaged: people who replied to Luke lately. unreplied / replied: whether Luke has replied. pictures: posts with pictures. */
  view?: FeedView;
  before?: string;
  limit?: number;
};

/** The feed, newest first, each post with Luke's replies. */
export async function getFeed(filter: FeedFilter = {}) {
  const limit = filter.limit ?? 50;
  const [seen, people] = await Promise.all([seenAt(), listPeople()]);
  const now = new Date();
  const hasReply = sql`exists (select 1 from ${xReplies} where ${xReplies.postId} = ${xPosts.id})`;
  const atCompany = filter.company
    ? people.filter((p) => p.company?.toLowerCase() === filter.company!.toLowerCase()).map((p) => p.id)
    : null;
  const talking = people.filter((p) => p.engaged).map((p) => p.id);
  const conditions = [
    sql`(${xPosts.postedAt} >= ${keepFrom()} or ${pendingReply})`,
    filter.personId ? eq(xPosts.personId, filter.personId) : undefined,
    atCompany ? (atCompany.length ? inArray(xPosts.personId, atCompany) : sql`false`) : undefined,
    filter.view === "day" ? gt(xPosts.postedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)) : undefined,
    filter.view === "engaged" ? (talking.length ? inArray(xPosts.personId, talking) : sql`false`) : undefined,
    filter.view === "replied" ? hasReply : undefined,
    filter.view === "unreplied" ? sql`not ${hasReply}` : undefined,
    filter.view === "pictures" ? sql`jsonb_array_length(${xPosts.media}) > 0` : undefined,
    filter.before ? lt(xPosts.postedAt, new Date(filter.before)) : undefined,
  ].filter((c) => c !== undefined);
  const rows = await db
    .select()
    .from(xPosts)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(xPosts.postedAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const ids = page.map((p) => p.id);
  const [replies, actions] = page.length
    ? await Promise.all([
        db.select().from(xReplies).where(inArray(xReplies.postId, ids)).orderBy(xReplies.createdAt),
        db.select().from(xActions).where(inArray(xActions.postId, ids)),
      ])
    : [[], []];
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
      person: { id: p.id, handle: p.handle, name: p.name, company: p.company, avatarUrl: p.avatarUrl, follow: p.follow, engaged: p.engaged },
      replies: replies.filter((r) => r.postId === row.id).map(toReply),
      actions: Object.fromEntries(
        actionKinds.map((kind) => {
          const a = actions.find((x) => x.postId === row.id && x.kind === kind);
          return [kind, { on: a?.want ?? false, pending: !!a && a.want !== a.done, error: a?.error ?? null, done: a?.done ?? false }];
        }),
      ) as Record<XActionKind, XActionState>,
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
    /** The companies people work at, for filtering. */
    companies: [...new Set(people.map((p) => p.company).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    /** When this was read, for showing how long ago things happened. */
    now,
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
      media: z.array(z.url().max(2000)).max(4).optional().describe("The other post's pictures (and video thumbnails)."),
    })
    .nullable()
    .optional()
    .describe("For a quote or reply: the other post (author's @handle, its text, its address, its pictures), when it's shown."),
  media: z.array(z.url().max(2000)).max(4).default([]).describe("Addresses of the post's pictures (pbs.twimg.com), up to 4. For a video or GIF, its thumbnail (the <video> poster, under ext_tw_video_thumb, amplify_video_thumb or tweet_video_thumb): the app shows a play button that opens the post on X."),
});

export const xFeedOperations = {
  list_x_people: defineOperation({
    name: "list_x_people",
    description: "List the people Luke follows in his X feed (handle, name, company, picture, and when Claude last checked their profile on X).",
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
      company: z.string().trim().max(100).optional().describe("Where they work, shown next to their name."),
    }),
    run: async ({ handle: raw, name, company }, { actor }) => {
      const handle = cleanHandle(raw);
      const existing = await personByHandle(handle);
      if (existing) return existing;
      const [row] = await db
        .insert(xPeople)
        .values({ handle, name: name || null, company: company || null, ...madeByColumns(actor) })
        .returning();
      return toPerson(row);
    },
  }),

  update_x_person: defineOperation({
    name: "update_x_person",
    description: "Change a followed person's handle, display name, company or profile picture address. Fields left out stay as they are.",
    input: z.object({
      id: personId,
      handle: z.string().trim().min(1).max(200).optional(),
      name: z.string().trim().max(200).nullable().optional(),
      company: z.string().trim().max(100).nullable().optional().describe("Where they work. Empty or null clears it."),
      avatarUrl: z.url().max(2000).nullable().optional(),
    }),
    run: async ({ id, handle, name, company, avatarUrl }) => {
      await getPerson(id);
      await db
        .update(xPeople)
        .set({
          ...(handle !== undefined && { handle: cleanHandle(handle) }),
          ...(name !== undefined && { name: name || null }),
          ...(company !== undefined && { company: company || null }),
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
      "Luke's X feed, newest first (the last 2 days): posts from the people he follows, each with his replies and their state (draft: written by Claude, waits for Luke; queued: waiting to be posted on X; sent; failed). Also when Claude last checked X.",
    input: z.object({
      personId: personId.optional().describe("Only this person's posts."),
      company: z.string().trim().max(100).optional().describe("Only posts from people at this company."),
      view: z
        .enum(feedViews)
        .optional()
        .describe("day: posted in the last 24 hours. engaged: from people who replied to or mentioned Luke on X in the last 30 days. unreplied: Luke hasn't replied. replied: Luke has replied. pictures: posts with pictures."),
      before: z.iso.datetime({ offset: true }).optional().describe("Only posts older than this (the 'more' value from the previous page)."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => getFeed(filter),
  }),

  save_x_posts: defineOperation({
    name: "save_x_posts",
    description:
      "For the X feed routine: save posts read from a followed person's profile on X. Posts already saved, and posts more than 2 days old, are skipped (the feed keeps only the last 2 days; older posts are deleted unless Luke has a reply waiting on them), so it's safe to pass everything visible. Also records that their profile was checked, and can update their name and picture. Copy text exactly; never summarise or rewrite it.",
    input: z.object({
      personId,
      name: z.string().trim().max(200).optional().describe("Their display name as shown on X."),
      avatarUrl: z.url().max(2000).optional().describe("Their profile picture address."),
      following: z.boolean().optional().describe("Whether Luke follows them on X, from the Follow / Following button on their profile."),
      posts: z.array(postInput).max(100).describe("Their posts, as shown on their profile. Leave out reposts of other people's posts."),
    }),
    run: async ({ personId: id, name, avatarUrl, following, posts }, { actor }) => {
      const person = await getPerson(id);
      const now = new Date();
      await db
        .update(xPeople)
        .set({
          checkedAt: now,
          ...(name && { name }),
          ...(avatarUrl && { avatarUrl }),
          ...(following !== undefined && { following }),
          // Already as Luke wants on X: nothing left to do.
          ...(following !== undefined && following === person.follow.on && { followWant: null, followError: null }),
          updatedAt: now,
        })
        .where(eq(xPeople.id, id));
      const cleared = await clearOldPosts();
      const since = keepFrom();
      const fresh = posts.filter((p) => new Date(p.postedAt) >= since);
      if (fresh.length === 0) return { added: 0, skipped: posts.length, cleared };
      const inserted = await db
        .insert(xPosts)
        .values(
          fresh.map((p) => ({
            personId: id,
            xId: p.xId,
            url: `https://x.com/${person.handle}/status/${p.xId}`,
            text: p.text,
            kind: p.kind,
            context: p.context
              ? { author: p.context.author ?? null, text: p.context.text ?? null, url: p.context.url ?? null, media: p.context.media ?? [] }
              : null,
            media: p.media,
            postedAt: new Date(p.postedAt),
            ...madeByColumns(actor),
          })),
        )
        // A post seen again picks up pictures and video thumbnails an older read missed, and the
        // post it quotes (older reads could miss it, or mistake a plain post for a quote).
        .onConflictDoUpdate({
          target: xPosts.xId,
          set: {
            media: sql`case when jsonb_array_length(excluded.media) > jsonb_array_length(${xPosts.media}) then excluded.media else ${xPosts.media} end`,
            context: sql`coalesce(excluded.context, ${xPosts.context})`,
            kind: sql`case when excluded.context is null and ${xPosts.context} is not null then ${xPosts.kind} else excluded.kind end`,
          },
        })
        .returning({ id: xPosts.id, isNew: sql<boolean>`xmax = 0` });
      const added = inserted.filter((r) => r.isNew).length;
      return { added, updated: inserted.length - added, skipped: posts.length - added, cleared };
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
      "Write a reply to a post in Luke's X feed, or a quote post of it (kind: quote, Luke's own post with theirs embedded). When Luke writes one it's queued, and the X feed routine posts it on X exactly as written. When Claude writes one it's only a draft: it shows in the app for Luke to edit and send, and is never posted until he does.",
    input: z.object({
      postId: z.uuid().describe("The post's id in LukeOS."),
      text: replyText,
      kind: z.enum(["reply", "quote"]).default("reply").describe("reply: under their post. quote: a quote post of it."),
    }),
    run: async ({ postId, text, kind }, { actor }) => {
      await assertPost(postId);
      const [row] = await db
        .insert(xReplies)
        .values({ postId, text, kind, status: actor.kind === "user" ? "queued" : "draft", ...madeByColumns(actor) })
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
      "For the X feed routine: Luke's replies and quote posts waiting to be posted on X, oldest first, each with the post it's about (kind reply: reply under it; kind quote: quote it). Post each one's text exactly as given, character for character, then call mark_x_reply_sent (or mark_x_reply_failed).",
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
        kind: reply.kind === "quote" ? "quote" : "reply",
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

  set_x_post_action: defineOperation({
    name: "set_x_post_action",
    description:
      "Luke only, from the app: like, repost or bookmark a post in his X feed (on: true), or undo it (on: false). The X feed routine does it on X at the next check-in.",
    input: z.object({
      postId: z.uuid().describe("The post's id in LukeOS."),
      kind: z.enum(actionKinds),
      on: z.boolean(),
    }),
    run: async ({ postId, kind, on }, { actor }) => {
      assertLuke(actor, `${kind} posts on X`);
      await assertPost(postId);
      const [row] = await db
        .insert(xActions)
        .values({ postId, kind, want: on, done: false })
        .onConflictDoUpdate({ target: [xActions.postId, xActions.kind], set: { want: on, error: null, updatedAt: new Date() } })
        .returning();
      return { id: row.id, postId, kind, on: row.want, pending: row.want !== row.done };
    },
  }),

  list_x_actions_to_do: defineOperation({
    name: "list_x_actions_to_do",
    description:
      "For the X feed routine: Luke's likes, reposts and bookmarks (and undos) waiting to be done on X, oldest first, each with the post's address. on: true means like / repost / bookmark it; on: false means undo it. Then call mark_x_action_done (or mark_x_action_failed).",
    input: z.object({}),
    run: async () => {
      const rows = await db
        .select({ action: xActions, post: xPosts })
        .from(xActions)
        .innerJoin(xPosts, eq(xActions.postId, xPosts.id))
        .where(sql`${xActions.want} <> ${xActions.done}`)
        .orderBy(xActions.updatedAt);
      return rows.map(({ action, post }) => ({ id: action.id, kind: action.kind, on: action.want, url: post.url, error: action.error }));
    },
  }),

  mark_x_action_done: defineOperation({
    name: "mark_x_action_done",
    description: "For the X feed routine: record that a like, repost or bookmark (or its undo) is now done on X.",
    input: z.object({ id: z.uuid().describe("The action's id, from list_x_actions_to_do.") }),
    run: async ({ id }) => {
      const [row] = await db
        .update(xActions)
        .set({ done: sql`${xActions.want}`, error: null, updatedAt: new Date() })
        .where(eq(xActions.id, id))
        .returning();
      if (!row) throw new OperationError("That action doesn't exist.", 404);
      return { id, kind: row.kind, on: row.done };
    },
  }),

  mark_x_action_failed: defineOperation({
    name: "mark_x_action_failed",
    description: "For the X feed routine: record that a like, repost or bookmark couldn't be done on X, and why in a few plain words. It stays waiting, so the next run tries again.",
    input: z.object({ id: z.uuid(), error: z.string().trim().min(1).max(500) }),
    run: async ({ id, error }) => {
      const [row] = await db.update(xActions).set({ error, updatedAt: new Date() }).where(eq(xActions.id, id)).returning();
      if (!row) throw new OperationError("That action doesn't exist.", 404);
      return { id, error };
    },
  }),

  set_x_follow: defineOperation({
    name: "set_x_follow",
    description: "Luke only, from the app: follow someone in his X feed on X (on: true), or unfollow them (on: false). The X feed routine does it on X at the next check-in.",
    input: z.object({ personId, on: z.boolean() }),
    run: async ({ personId: id, on }, { actor }) => {
      assertLuke(actor, "follow people on X");
      const person = await getPerson(id);
      await db
        .update(xPeople)
        // Back to how it already is on X: nothing left to do.
        .set({ followWant: on === person.follow.done ? null : on, followError: null, updatedAt: new Date() })
        .where(eq(xPeople.id, id));
      return (await getPerson(id)).follow;
    },
  }),

  list_x_follows_to_do: defineOperation({
    name: "list_x_follows_to_do",
    description:
      "For the X feed routine: people Luke asked to follow (on: true) or unfollow (on: false) on X, each with their profile address. Then call mark_x_follow_done (or mark_x_follow_failed).",
    input: z.object({}),
    run: async () => {
      const rows = await db
        .select()
        .from(xPeople)
        .where(sql`${xPeople.followWant} is not null and ${xPeople.followWant} is distinct from coalesce(${xPeople.following}, false)`)
        .orderBy(xPeople.updatedAt);
      return rows.map((r) => ({ personId: r.id, handle: r.handle, on: r.followWant!, url: `https://x.com/${r.handle}`, error: r.followError }));
    },
  }),

  mark_x_follow_done: defineOperation({
    name: "mark_x_follow_done",
    description: "For the X feed routine: record whether Luke now follows this person on X (following: true or false, as the button on their profile shows).",
    input: z.object({ personId, following: z.boolean() }),
    run: async ({ personId: id, following }) => {
      await getPerson(id);
      await db.update(xPeople).set({ following, followWant: null, followError: null, updatedAt: new Date() }).where(eq(xPeople.id, id));
      return (await getPerson(id)).follow;
    },
  }),

  mark_x_follow_failed: defineOperation({
    name: "mark_x_follow_failed",
    description: "For the X feed routine: record that following or unfollowing someone on X didn't work, and why in a few plain words. It stays waiting, so the next run tries again.",
    input: z.object({ personId, error: z.string().trim().min(1).max(500) }),
    run: async ({ personId: id, error }) => {
      await getPerson(id);
      await db.update(xPeople).set({ followError: error, updatedAt: new Date() }).where(eq(xPeople.id, id));
      return { personId: id, error };
    },
  }),

  save_x_engagements: defineOperation({
    name: "save_x_engagements",
    description:
      "For the X feed routine: save what people in Luke's X feed did with Luke (@lukerlewis): replies and mentions (from the Mentions tab of his X notifications), likes of his posts and replies (from the All tab), and messages (from his X messages list: that they messaged, never what). People not in his feed, and ones already saved, are skipped. A reply, mention or message marks them as talking with Luke for 30 days. Copy text exactly.",
    input: z.object({
      items: z
        .array(
          z.object({
            handle: z.string().trim().min(1).max(100).describe("Who, their X username."),
            kind: z.enum(engagementKinds).default("reply"),
            xId: z
              .string()
              .trim()
              .regex(/^\d{1,25}$/)
              .optional()
              .describe("reply / mention: their post's id. like: the id of Luke's post they liked. Not for dm."),
            text: z.string().max(5000).default("").describe("reply / mention: their text. Leave empty for like and dm."),
            at: z.iso.datetime({ offset: true }).describe("When it happened (for a dm, the conversation's latest message)."),
          }),
        )
        .max(200),
    }),
    run: async ({ items }) => {
      const people = await db.select().from(xPeople);
      const byHandle = new Map(people.map((p) => [p.handle.toLowerCase(), p]));
      const rows = items.flatMap((i) => {
        const p = byHandle.get(i.handle.replace(/^@/, "").toLowerCase());
        if (!p) return [];
        if (i.kind !== "dm" && !i.xId) throw new OperationError(`A ${i.kind} needs xId.`);
        const at = new Date(i.at);
        const key =
          i.kind === "like" ? `like:${i.xId}:${p.handle.toLowerCase()}` : i.kind === "dm" ? `dm:${p.handle.toLowerCase()}:${at.toISOString().slice(0, 10)}` : i.xId!;
        const url = i.kind === "like" ? `https://x.com/lukerlewis/status/${i.xId}` : i.kind === "dm" ? null : `https://x.com/${p.handle}/status/${i.xId}`;
        return [{ personId: p.id, kind: i.kind, key, url, text: i.kind === "like" || i.kind === "dm" ? "" : i.text, at }];
      });
      const added = rows.length ? await db.insert(xEngagements).values(rows).onConflictDoNothing().returning({ personId: xEngagements.personId }) : [];
      const names = [...new Set(added.map((a) => a.personId))].map((id) => people.find((p) => p.id === id)!.handle);
      return { added: added.length, skipped: items.length - added.length, people: names };
    },
  }),

  list_x_engagement_totals: defineOperation({
    name: "list_x_engagement_totals",
    description:
      "Everyone in Luke's X feed who has ever engaged with him on X (replied, mentioned, liked, messaged), with all-time counts of each and when they last did anything. For keeping the Referral Hub's \"Engaged with you\" and \"Last engaged\" columns up to date.",
    input: z.object({}),
    run: async () => {
      const [people, { totals }] = await Promise.all([db.select().from(xPeople), engagedByPerson()]);
      return people
        .filter((p) => totals.has(p.id))
        .map((p) => {
          const t = totals.get(p.id)!;
          const parts = [
            t.replies && `${t.replies} ${t.replies === 1 ? "reply" : "replies"}`,
            t.mentions && `${t.mentions} ${t.mentions === 1 ? "mention" : "mentions"}`,
            t.likes && `${t.likes} ${t.likes === 1 ? "like" : "likes"}`,
            t.dms && `${t.dms} ${t.dms === 1 ? "DM" : "DMs"}`,
          ].filter(Boolean);
          return { handle: p.handle, name: p.name, ...t, summary: parts.join(", ") };
        })
        .sort((a, b) => b.lastAnyAt.getTime() - a.lastAnyAt.getTime());
    },
  }),

  mark_x_feed_seen: defineOperation({
    name: "mark_x_feed_seen",
    description: "Clear the New markers on X feed posts, as if Luke had opened the feed.",
    input: z.object({}),
    run: async () => markSeen(),
  }),
};

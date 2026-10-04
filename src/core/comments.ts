import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertArtifact } from "./artifacts";
import { defineOperation, madeByColumns, madeByOf, OperationError, type Actor, type MadeBy } from "./define";
import { deleteOrphanMentions, syncMentions } from "./mentions";
import { sendPush } from "./push";

const { comments, notes, artifacts, documents, tasks, archiveEntries, cards, projects, mentions } = schema;

export const commentTargets = ["note", "artifact", "document", "task", "entry", "card"] as const;
export type CommentTarget = (typeof commentTargets)[number];

export type Comment = {
  id: string;
  target: { type: CommentTarget; id: string; title: string };
  /** Artifacts only: the version it was made on. */
  version: number | null;
  /** The words it's about, if any were picked. */
  quote: string | null;
  body: string;
  resolved: boolean;
  resolvedAt: Date | null;
  madeBy: MadeBy;
  createdAt: Date;
  /** Answers to it, oldest first. */
  replies: Omit<Comment, "replies" | "target">[];
};

async function targetTitle(type: CommentTarget, id: string) {
  if (type === "artifact") return (await assertArtifact(id)).title;
  if (type === "task") {
    const [task] = await db
      .select({ title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task) throw new OperationError("That task doesn't exist, or it's in Trash.", 404);
    return task.title;
  }
  if (type === "document") {
    const [doc] = await db
      .select({ title: documents.title })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc) throw new OperationError("That document doesn't exist, or it's in Trash.", 404);
    return doc.title;
  }
  if (type === "card") {
    const [card] = await db
      .select({ title: cards.title })
      .from(cards)
      .innerJoin(projects, eq(projects.id, cards.projectId))
      .where(and(eq(cards.id, id), isNull(cards.deletedAt), isNull(projects.deletedAt)))
      .limit(1);
    if (!card) throw new OperationError("That card doesn't exist, or it's in Trash.", 404);
    return card.title;
  }
  if (type === "entry") {
    const [entry] = await db
      .select({ title: archiveEntries.title })
      .from(archiveEntries)
      .where(and(eq(archiveEntries.id, id), isNull(archiveEntries.deletedAt)))
      .limit(1);
    if (!entry) throw new OperationError("That Work archive entry doesn't exist, or it's in Trash.", 404);
    return entry.title;
  }
  const [row] = await db
    .select({ title: notes.title })
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .limit(1);
  if (!row) throw new OperationError("That note doesn't exist, or it's in Trash.", 404);
  return row.title;
}

type Row = typeof comments.$inferSelect;

const replyOf = (r: Row) => ({
  id: r.id,
  version: r.version,
  quote: r.quote,
  body: r.body,
  resolved: r.resolvedAt !== null,
  resolvedAt: r.resolvedAt,
  madeBy: madeByOf(r),
  createdAt: r.createdAt,
});

/**
 * Comment threads, oldest first: on one note, artifact, document, task or entry, or (with no
 * target) across everything, e.g. every open comment Claude hasn't answered.
 */
export async function listComments(
  filter: { targetType?: CommentTarget; targetId?: string; open?: boolean; limit?: number } = {},
): Promise<Comment[]> {
  const where: (SQL | undefined)[] = [isNull(comments.parentId)];
  if (filter.targetType) where.push(eq(comments.targetType, filter.targetType));
  if (filter.targetId) where.push(eq(comments.targetId, filter.targetId));
  if (filter.open) where.push(isNull(comments.resolvedAt));
  // Only on things that aren't in Trash.
  where.push(sql`(
    (${comments.targetType} = 'note' and exists (select 1 from ${notes} n where n.id = ${comments.targetId} and n.deleted_at is null))
    or (${comments.targetType} = 'artifact' and exists (select 1 from ${artifacts} a where a.id = ${comments.targetId} and a.deleted_at is null))
    or (${comments.targetType} = 'document' and exists (select 1 from ${documents} d where d.id = ${comments.targetId} and d.deleted_at is null))
    or (${comments.targetType} = 'task' and exists (select 1 from ${tasks} t where t.id = ${comments.targetId} and t.deleted_at is null))
    or (${comments.targetType} = 'entry' and exists (select 1 from ${archiveEntries} e where e.id = ${comments.targetId} and e.deleted_at is null))
    or (${comments.targetType} = 'card' and exists (select 1 from ${cards} k join ${projects} p on p.id = k.project_id where k.id = ${comments.targetId} and k.deleted_at is null and p.deleted_at is null)))`);

  const threads = await db
    .select({
      comment: comments,
      title: sql<string>`coalesce(
        (select n.title from ${notes} n where ${comments.targetType} = 'note' and n.id = ${comments.targetId}),
        (select a.title from ${artifacts} a where ${comments.targetType} = 'artifact' and a.id = ${comments.targetId}),
        (select d.title from ${documents} d where ${comments.targetType} = 'document' and d.id = ${comments.targetId}),
        (select t.title from ${tasks} t where ${comments.targetType} = 'task' and t.id = ${comments.targetId}),
        (select e.title from ${archiveEntries} e where ${comments.targetType} = 'entry' and e.id = ${comments.targetId}),
        (select k.title from ${cards} k where ${comments.targetType} = 'card' and k.id = ${comments.targetId}), '')`,
    })
    .from(comments)
    .where(and(...where))
    // Newest threads when listing across everything; in order when on one thing.
    .orderBy(filter.targetId ? asc(comments.createdAt) : desc(comments.createdAt))
    .limit(filter.limit ?? 200);
  if (threads.length === 0) return [];

  const replies = await db
    .select()
    .from(comments)
    .where(
      inArray(
        comments.parentId,
        threads.map((t) => t.comment.id),
      ),
    )
    .orderBy(asc(comments.createdAt));

  return threads.map(({ comment, title }) => ({
    ...replyOf(comment),
    target: { type: comment.targetType as CommentTarget, id: comment.targetId, title },
    replies: replies.filter((r) => r.parentId === comment.id).map(replyOf),
  }));
}

async function getThread(id: string) {
  const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
  if (!row) throw new OperationError("That comment doesn't exist.", 404);
  const top = row.parentId ? (await db.select().from(comments).where(eq(comments.id, row.parentId)).limit(1))[0] : row;
  const [thread] = (await listComments({ targetType: top.targetType as CommentTarget, targetId: top.targetId })).filter(
    (t) => t.id === top.id,
  );
  if (!thread) throw new OperationError("That comment is on something that's in Trash.", 404);
  return thread;
}

const fallbackTitle = { note: "Note", artifact: "Artifact", document: "Document", task: "Task", entry: "Work archive entry", card: "Card" } as const;

/** Where a comment's note, artifact, document, task, Work archive entry or card opens in the app. Tasks open over the dashboard; cards (/cards/<id>) on their project's Board. */
export const commentTargetUrl = (target: { type: CommentTarget; id: string }) =>
  target.type === "task" ? `/?task=${target.id}` : target.type === "entry" ? `/archive/${target.id}` : `/${target.type}s/${target.id}`;

/** Tells Luke's phone when Claude answers or starts a comment, so he can reply. */
async function notifyLuke(actor: Actor, target: Comment["target"], text: string) {
  if (actor.kind !== "agent") return;
  const flat = text.replace(/\s+/g, " ").trim();
  await sendPush({
    title: `${actor.name} · ${target.title || fallbackTitle[target.type]}`,
    body: flat.length > 180 ? `${flat.slice(0, 179)}…` : flat,
    url: commentTargetUrl(target),
    tag: `lukeos-comment-${target.id}`,
  });
}

/** Claude answering a thread deals with any @claude Luke wrote in it, so it isn't asked twice. */
async function resolveThreadMentions(threadId: string, actor: Actor, reply: string) {
  if (actor.kind !== "agent") return;
  await db
    .update(mentions)
    .set({ resolvedAt: new Date(), resolvedBy: actor.name, reply: reply.slice(0, 2000) })
    .where(
      and(
        eq(mentions.targetType, "comment"),
        isNull(mentions.resolvedAt),
        sql`${mentions.targetId} in (select c.id from ${comments} c where c.id = ${threadId} or c.parent_id = ${threadId})`,
      ),
    );
}

/**
 * Claude's answer to an @claude Luke wrote in a task's own text, posted as a
 * comment on the task so the reply sits in the task and he can answer back.
 */
export async function commentOnTaskMention(taskId: string, line: string, reply: string, actor: Actor) {
  if (actor.kind !== "agent") return;
  const title = await targetTitle("task", taskId);
  await db.insert(comments).values({ targetType: "task", targetId: taskId, body: reply, quote: line.slice(0, 2000), ...madeByColumns(actor) });
  await notifyLuke(actor, { type: "task", id: taskId, title }, reply);
}

const id = z.uuid().describe("The comment's id.");
const targetType = z.enum(commentTargets).describe('"document", "note", "task", "entry" (a Work archive entry), "card" (a pipeline card) or "artifact".');
const body = z.string().trim().min(1).max(20_000).describe("What the comment says.");

export const commentOperations = {
  list_comments: defineOperation({
    name: "list_comments",
    description:
      "Comment threads on Luke's documents, notes, tasks, Work archive entries, pipeline cards and artifacts, each with its replies. Give one of them to see its comments, or leave both out to see comments across everything. open: true shows only unresolved ones, which is how to find what Luke has asked you to look at. Each comment may quote the words it's about, and on an artifact says which version it was made on.",
    input: z.object({
      targetType: targetType.optional(),
      targetId: z.uuid().optional().describe("The document's, note's, task's, entry's, card's or artifact's id."),
      open: z.boolean().optional().describe("Only comments not yet resolved."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => listComments(filter),
  }),

  add_comment: defineOperation({
    name: "add_comment",
    description: "Start a comment thread on a document, a note, a task, a Work archive entry, a pipeline card or an artifact. To answer an existing comment, use reply_to_comment.",
    input: z.object({
      targetType,
      targetId: z.uuid().describe("The document's, note's, task's, entry's, card's or artifact's id."),
      body,
      quote: z.string().trim().max(2000).optional().describe("The words the comment is about, copied exactly."),
    }),
    run: async ({ targetType, targetId, body, quote }, { actor }) => {
      await targetTitle(targetType, targetId);
      const version = targetType === "artifact" ? (await assertArtifact(targetId)).version : null;
      const [row] = await db
        .insert(comments)
        .values({ targetType, targetId, body, quote: quote || null, version, ...madeByColumns(actor) })
        .returning({ id: comments.id });
      await syncMentions("comment", row.id, [body], actor);
      const thread = await getThread(row.id);
      await notifyLuke(actor, thread.target, body);
      return thread;
    },
  }),

  reply_to_comment: defineOperation({
    name: "reply_to_comment",
    description:
      "Answer a comment thread, e.g. to say what you changed, answer Luke's question, or ask him one. Luke gets a notification and can reply back, so a thread can go back and forth. Replying doesn't resolve it: call resolve_comment when it's fully dealt with, and leave it open if you've asked him something. If Luke replies to a resolved thread it opens again and comes back to you.",
    input: z.object({ id: id.describe("The id of the comment being answered."), body }),
    run: async ({ id, body }, { actor }) => {
      const thread = await getThread(id);
      const version = thread.target.type === "artifact" ? (await assertArtifact(thread.target.id)).version : null;
      const [reply] = await db.insert(comments).values({
        targetType: thread.target.type,
        targetId: thread.target.id,
        parentId: thread.id,
        body,
        version,
        ...madeByColumns(actor),
      }).returning({ id: comments.id });
      await syncMentions("comment", reply.id, [body], actor);
      // Luke answering a resolved thread opens it again, so Claude sees it.
      await db
        .update(comments)
        .set({ updatedAt: new Date(), ...(actor.kind === "user" && thread.resolved ? { resolvedAt: null } : {}) })
        .where(eq(comments.id, thread.id));
      await resolveThreadMentions(thread.id, actor, body);
      await notifyLuke(actor, thread.target, body);
      return getThread(thread.id);
    },
  }),

  resolve_comment: defineOperation({
    name: "resolve_comment",
    description: "Mark a comment thread as dealt with (or open it again with resolved: false).",
    input: z.object({ id, resolved: z.boolean().optional().describe("false opens it again. Defaults to true.") }),
    run: async ({ id, resolved = true }) => {
      const thread = await getThread(id);
      await db
        .update(comments)
        .set({ resolvedAt: resolved ? new Date() : null, updatedAt: new Date() })
        .where(eq(comments.id, thread.id));
      return getThread(thread.id);
    },
  }),

  delete_comment: defineOperation({
    name: "delete_comment",
    description: "Delete a comment (and, for the first comment in a thread, its replies). Only when Luke asks.",
    input: z.object({ id }),
    run: async ({ id }) => {
      const thread = await getThread(id);
      await db.delete(comments).where(eq(comments.id, id));
      await deleteOrphanMentions();
      return { deleted: id, thread: thread.id };
    },
  }),
};

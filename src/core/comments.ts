import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertArtifact } from "./artifacts";
import { defineOperation, madeByColumns, madeByOf, OperationError, type MadeBy } from "./define";
import { deleteOrphanMentions, syncMentions } from "./mentions";

const { comments, notes, artifacts } = schema;

export const commentTargets = ["note", "artifact"] as const;
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
 * Comment threads, oldest first: on one note or artifact, or (with no
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
    or (${comments.targetType} = 'artifact' and exists (select 1 from ${artifacts} a where a.id = ${comments.targetId} and a.deleted_at is null)))`);

  const threads = await db
    .select({
      comment: comments,
      title: sql<string>`coalesce(
        (select n.title from ${notes} n where ${comments.targetType} = 'note' and n.id = ${comments.targetId}),
        (select a.title from ${artifacts} a where ${comments.targetType} = 'artifact' and a.id = ${comments.targetId}), '')`,
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

const id = z.uuid().describe("The comment's id.");
const targetType = z.enum(commentTargets).describe('"note" or "artifact".');
const body = z.string().trim().min(1).max(20_000).describe("What the comment says.");

export const commentOperations = {
  list_comments: defineOperation({
    name: "list_comments",
    description:
      "Comment threads on Luke's notes and artifacts, each with its replies. Give a note or artifact to see its comments, or leave both out to see comments across everything. open: true shows only unresolved ones, which is how to find what Luke has asked you to look at. Each comment may quote the words it's about, and on an artifact says which version it was made on.",
    input: z.object({
      targetType: targetType.optional(),
      targetId: z.uuid().optional().describe("The note's or artifact's id."),
      open: z.boolean().optional().describe("Only comments not yet resolved."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => listComments(filter),
  }),

  add_comment: defineOperation({
    name: "add_comment",
    description: "Start a comment thread on a note or an artifact. To answer an existing comment, use reply_to_comment.",
    input: z.object({
      targetType,
      targetId: z.uuid().describe("The note's or artifact's id."),
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
      return getThread(row.id);
    },
  }),

  reply_to_comment: defineOperation({
    name: "reply_to_comment",
    description:
      "Answer a comment, e.g. to say what you changed. Replying doesn't resolve it; call resolve_comment too when it's been dealt with.",
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
      await db.update(comments).set({ updatedAt: new Date() }).where(eq(comments.id, thread.id));
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

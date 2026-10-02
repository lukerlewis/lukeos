import "server-only";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { findMentions } from "@/lib/mentions";
import { commentOnTaskMention } from "./comments";
import { listSops } from "./sops";
import { defineOperation, OperationError, type Actor } from "./define";

const { mentions } = schema;

export const mentionTargets = ["note", "task", "comment"] as const;
export type MentionTarget = (typeof mentionTargets)[number];

/** One @claude request, as Claude and the Agents section see it. */
export type Mention = {
  id: string;
  /** The line the tag is on: what Luke is asking. */
  text: string;
  /** Where he wrote it. For a comment, `on` is the note, artifact or task it's on. */
  where: {
    type: MentionTarget;
    id: string;
    title: string;
    on: { type: "note" | "artifact" | "task"; id: string; title: string } | null;
    /** Written in the scratch pad on Luke's dashboard. */
    scratchPad: boolean;
  };
  createdAt: Date;
  status: "open" | "done";
  resolvedAt: Date | null;
  resolvedBy: string | null;
  reply: string | null;
  /** Done, and the tag has since been taken out of the text. */
  removed: boolean;
};

/**
 * Keeps a note's, task's or comment's @claude requests in step with its text.
 * New tags become requests (only when Luke wrote them); tags taken out are
 * dropped if not yet dealt with, or kept as history if they were.
 */
export async function syncMentions(type: MentionTarget, id: string, texts: (string | null | undefined)[], actor: Actor) {
  const found = texts.flatMap(findMentions);
  const existing = await db
    .select()
    .from(mentions)
    .where(and(eq(mentions.targetType, type), eq(mentions.targetId, id)));
  if (found.length === 0 && existing.length === 0) return;

  const kept = new Set<string>();
  const byLuke = actor.kind === "user";
  // Ids already used elsewhere (a tag copied from another note) are matched by their line instead.
  const tagged = found.filter((f) => f.id).map((f) => f.id!);
  const elsewhere = new Set(
    tagged.length
      ? (
          await db
            .select({ id: mentions.id })
            .from(mentions)
            .where(and(inArray(mentions.id, tagged), sql`not (${mentions.targetType} = ${type} and ${mentions.targetId} = ${id})`))
        ).map((r) => r.id)
      : [],
  );

  for (const f of found) {
    const ownId = f.id && !elsewhere.has(f.id) ? f.id : null;
    const row = ownId
      ? existing.find((e) => e.id === ownId)
      : existing.find((e) => !e.anchored && e.context === f.context && !kept.has(e.id));
    if (row) {
      kept.add(row.id);
      const changes: Partial<typeof mentions.$inferInsert> = {};
      if (row.removedAt) changes.removedAt = null;
      if (!row.resolvedAt && row.context !== f.context) changes.context = f.context;
      if (Object.keys(changes).length) await db.update(mentions).set(changes).where(eq(mentions.id, row.id));
    } else if (byLuke && f.context) {
      const [added] = await db
        .insert(mentions)
        .values({ ...(ownId && { id: ownId }), targetType: type, targetId: id, context: f.context, anchored: !!ownId })
        .returning({ id: mentions.id });
      kept.add(added.id);
    }
  }

  for (const e of existing) {
    if (kept.has(e.id) || e.removedAt) continue;
    if (e.resolvedAt) await db.update(mentions).set({ removedAt: new Date() }).where(eq(mentions.id, e.id));
    else await db.delete(mentions).where(eq(mentions.id, e.id));
  }
}

/** Deletes requests whose note, task or comment is gone for good. */
export async function deleteOrphanMentions() {
  await db.execute(sql`
    delete from mentions m
    where (m.target_type = 'note' and not exists (select 1 from notes n where n.id = m.target_id))
       or (m.target_type = 'task' and not exists (select 1 from tasks t where t.id = m.target_id))
       or (m.target_type = 'comment' and not exists (select 1 from comments c where c.id = m.target_id))`);
}

// Where each request is, read alongside it. Things in Trash are left out.
const where = {
  title: sql<string>`coalesce(
    (select n.title from notes n where ${mentions.targetType} = 'note' and n.id = ${mentions.targetId}),
    (select t.title from tasks t where ${mentions.targetType} = 'task' and t.id = ${mentions.targetId}),
    (select left(c.body, 80) from comments c where ${mentions.targetType} = 'comment' and c.id = ${mentions.targetId}), '')`,
  scratchPad: sql<boolean>`exists (select 1 from notes n where ${mentions.targetType} = 'note' and n.id = ${mentions.targetId} and n.kind = 'scratchpad')`,
  onType: sql<string | null>`(select c.target_type from comments c where ${mentions.targetType} = 'comment' and c.id = ${mentions.targetId})`,
  onId: sql<string | null>`(select c.target_id from comments c where ${mentions.targetType} = 'comment' and c.id = ${mentions.targetId})`,
  onTitle: sql<string | null>`(select coalesce(n.title, a.title, t.title) from comments c
    left join notes n on c.target_type = 'note' and n.id = c.target_id
    left join artifacts a on c.target_type = 'artifact' and a.id = c.target_id
    left join tasks t on c.target_type = 'task' and t.id = c.target_id
    where ${mentions.targetType} = 'comment' and c.id = ${mentions.targetId})`,
};
const live = sql`(
  (${mentions.targetType} = 'note' and exists (select 1 from notes n where n.id = ${mentions.targetId} and n.deleted_at is null))
  or (${mentions.targetType} = 'task' and exists (select 1 from tasks t where t.id = ${mentions.targetId} and t.deleted_at is null))
  or (${mentions.targetType} = 'comment' and exists (select 1 from comments c
    left join notes n on c.target_type = 'note' and n.id = c.target_id
    left join artifacts a on c.target_type = 'artifact' and a.id = c.target_id
    left join tasks t on c.target_type = 'task' and t.id = c.target_id
    where c.id = ${mentions.targetId} and coalesce(n.deleted_at, a.deleted_at, t.deleted_at) is null and coalesce(n.id, a.id, t.id) is not null)))`;

/** @claude requests, newest first. Open ones only, or everything including what's been dealt with. */
export async function listMentions(filter: { open?: boolean; ids?: string[]; limit?: number } = {}): Promise<Mention[]> {
  const conditions: (SQL | undefined)[] = [live];
  if (filter.open) conditions.push(isNull(mentions.resolvedAt));
  if (filter.ids) conditions.push(inArray(mentions.id, filter.ids.length ? filter.ids : ["00000000-0000-0000-0000-000000000000"]));
  const rows = await db
    .select({ mention: mentions, ...where })
    .from(mentions)
    .where(and(...conditions))
    .orderBy(desc(mentions.createdAt))
    .limit(filter.limit ?? 100);
  return rows.map(({ mention: m, title, scratchPad, onType, onId, onTitle }) => ({
    id: m.id,
    text: m.context,
    where: {
      type: m.targetType as MentionTarget,
      id: m.targetId,
      title,
      on: onType && onId ? { type: onType as "note" | "artifact" | "task", id: onId, title: onTitle ?? "" } : null,
      scratchPad,
    },
    createdAt: m.createdAt,
    status: m.resolvedAt ? "done" : "open",
    resolvedAt: m.resolvedAt,
    resolvedBy: m.resolvedBy,
    reply: m.reply,
    removed: m.removedAt !== null,
  }));
}

/** Which of these requests have been dealt with, for showing a note's tags as done. */
export async function doneMentionIds(type: MentionTarget, id: string) {
  const rows = await db
    .select({ id: mentions.id })
    .from(mentions)
    .where(and(eq(mentions.targetType, type), eq(mentions.targetId, id), sql`${mentions.resolvedAt} is not null`));
  return rows.map((r) => r.id);
}

export const mentionOperations = {
  list_mentions: defineOperation({
    name: "list_mentions",
    description:
      'Luke\'s @claude requests: every place he wrote "@claude" (in a note, a task, a comment, or the scratch pad on his dashboard), newest first. Each has the line he wrote (text), where it is (where; use get_note, get_task or the comment\'s note or artifact to read around it), when, and whether it\'s been dealt with (status "open" or "done", with the reply). open: true shows only what\'s waiting for you, along with the title and description of each of Luke\'s SOPs (sops), so you can get_sop any that fit a request before doing it.',
    input: z.object({
      open: z.boolean().optional().describe("Only requests not yet dealt with."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async ({ open, limit }) => {
      const requests = await listMentions({ open, limit });
      if (!open) return { requests };
      const sops = requests.length ? (await listSops()).map((s) => ({ title: s.title, description: s.description })) : [];
      return { requests, sops };
    },
  }),

  resolve_mention: defineOperation({
    name: "resolve_mention",
    description:
      "Mark an @claude request as dealt with, with a short reply saying what you did (Luke sees it). For a request in a task, the reply is also posted as a comment on the task, so Luke sees it there and can answer back. For a request in a comment, answer with reply_to_comment instead: that resolves it for you. resolved: false opens it again. Leave the @claude tag in Luke's text; it shows as done once resolved.",
    input: z.object({
      id: z.uuid().describe("The request's id, from list_mentions."),
      reply: z.string().trim().max(2000).optional().describe("What you did, in a sentence or two."),
      resolved: z.boolean().optional().describe("false opens it again. Defaults to true."),
    }),
    run: async ({ id, reply, resolved = true }, { actor }) => {
      const [row] = await listMentions({ ids: [id], limit: 1 });
      if (!row) throw new OperationError("That @claude request doesn't exist, or what it's on is in Trash.", 404);
      await db
        .update(mentions)
        .set(
          resolved
            ? {
                resolvedAt: new Date(),
                resolvedBy: actor.kind === "agent" ? actor.name : null,
                ...(reply !== undefined && { reply: reply || null }),
              }
            : { resolvedAt: null, resolvedBy: null },
        )
        .where(eq(mentions.id, id));
      // A reply to an @claude in a task goes in the task itself, as a comment Luke can answer.
      if (resolved && reply && row.status === "open" && row.where.type === "task") {
        await commentOnTaskMention(row.where.id, row.text, reply, actor);
      }
      return (await listMentions({ ids: [id], limit: 1 }))[0];
    },
  }),
};

import "server-only";
import { and, desc, eq, getTableColumns, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { defineOperation, madeByColumns, madeByOf, OperationError, type MadeBy } from "./define";
import { sendPush } from "./push";

/**
 * Messages: a text chain between Luke and Claude. Luke texts a request any
 * time; Claude reads it at the next check-in (get_inbox), does it, and texts
 * back. Any Claude can also text Luke first (a routine finishing, something
 * it found), and each of Claude's texts sends a notification to his phone.
 */

const { messages } = schema;

export const linkTypes = ["task", "note", "artifact", "project", "routine", "entry"] as const;
export type LinkType = (typeof linkTypes)[number];

export type Message = {
  id: string;
  text: string;
  from: "luke" | "claude";
  madeBy: MadeBy;
  /** Something in LukeOS the message is about. Title is empty if it's been deleted. */
  link: { type: LinkType; id: string; title: string } | null;
  createdAt: Date;
  /** Claude's messages: Luke has seen it. */
  read: boolean;
  /** Luke's messages: Claude has dealt with it. */
  answered: boolean;
  answeredAt: Date | null;
};

const linkTitle = sql<string | null>`case ${messages.linkType}
  when 'task' then (select t.title from tasks t where t.id = ${messages.linkId} and t.deleted_at is null)
  when 'note' then (select coalesce(nullif(n.title, ''), 'Untitled note') from notes n where n.id = ${messages.linkId} and n.deleted_at is null)
  when 'artifact' then (select a.title from artifacts a where a.id = ${messages.linkId} and a.deleted_at is null)
  when 'project' then (select p.name from projects p where p.id = ${messages.linkId} and p.deleted_at is null)
  when 'routine' then (select r.title from routines r where r.id = ${messages.linkId} and r.deleted_at is null)
  when 'entry' then (select coalesce(nullif(e.title, ''), 'Untitled entry') from archive_entries e where e.id = ${messages.linkId} and e.deleted_at is null)
end`;

function toMessage(row: typeof messages.$inferSelect & { linkTitle: string | null }): Message {
  const madeBy = madeByOf(row);
  return {
    id: row.id,
    text: row.body,
    from: madeBy.kind === "agent" ? "claude" : "luke",
    madeBy,
    link: row.linkType && row.linkId ? { type: row.linkType as LinkType, id: row.linkId, title: row.linkTitle ?? "" } : null,
    createdAt: row.createdAt,
    read: row.readAt !== null,
    answered: row.answeredAt !== null,
    answeredAt: row.answeredAt,
  };
}

/** The chain, oldest first. `waiting` gives only Luke's messages Claude hasn't dealt with. */
export async function listMessages(filter: { limit?: number; before?: Date; waiting?: boolean; ids?: string[] } = {}) {
  const conditions: (SQL | undefined)[] = [];
  if (filter.before) conditions.push(lt(messages.createdAt, filter.before));
  if (filter.waiting) conditions.push(eq(messages.createdByKind, "user"), isNull(messages.answeredAt));
  if (filter.ids) conditions.push(inArray(messages.id, filter.ids.length ? filter.ids : ["00000000-0000-0000-0000-000000000000"]));
  // The newest ones, put back in order.
  const rows = await db
    .select({ ...getTableColumns(messages), linkTitle })
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(filter.limit ?? 100);
  return rows.reverse().map(toMessage);
}

/** How many of Claude's messages Luke hasn't seen yet. */
export async function unreadMessageCount() {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*) as n from messages where created_by_kind = 'agent' and read_at is null`,
  );
  return Number(rows.rows[0].n);
}

async function assertLink(type: LinkType, id: string) {
  const table = { task: schema.tasks, note: schema.notes, artifact: schema.artifacts, project: schema.projects, routine: schema.routines, entry: schema.archiveEntries }[type];
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new OperationError(`That ${type} doesn't exist.`, 404);
}

const preview = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 179)}…` : flat;
};

export const messageOperations = {
  list_messages: defineOperation({
    name: "list_messages",
    description:
      "The Messages chain between Luke and Claude, oldest first (the newest at the end), like a text conversation. Each message says who sent it (from \"luke\" or \"claude\"), when, and anything in LukeOS it's about (link). Luke's messages show whether they've been answered. waiting: true gives only Luke's messages nobody has dealt with yet (get_inbox lists these too).",
    input: z.object({
      waiting: z.boolean().optional().describe("Only Luke's messages that haven't been answered."),
      limit: z.number().int().min(1).max(200).optional().describe("How many of the most recent messages. Defaults to 100."),
    }),
    run: async ({ waiting, limit }) => listMessages({ waiting, limit }),
  }),

  send_message: defineOperation({
    name: "send_message",
    description:
      "Text Luke in his Messages chain. It sends a notification to his phone, so keep it short and worth his attention: one to three plain sentences, like a text from a helpful colleague. Use it to answer his messages (pass their ids as answers, so they stop showing as waiting), to tell him something finished or needs him, or when he asks you to let him know something. Long write-ups go in an artifact (create_artifact); link it here instead of pasting it. link points at one task, note, artifact, project, routine or Work archive entry, shown as a card he can tap.",
    input: z.object({
      text: z.string().trim().min(1).max(4000).describe("The message. Plain text; short."),
      link: z
        .object({ type: z.enum(linkTypes), id: z.uuid() })
        .optional()
        .describe("Something in LukeOS this is about, e.g. the artifact you just made."),
      answers: z
        .array(z.uuid())
        .max(100)
        .optional()
        .describe("Ids of Luke's messages this deals with (from get_inbox or list_messages). They stop showing as waiting."),
    }),
    run: async ({ text, link, answers }, { actor }) => {
      if (link) await assertLink(link.type, link.id);
      const [row] = await db
        .insert(messages)
        .values({
          body: text,
          linkType: link?.type ?? null,
          linkId: link?.id ?? null,
          // Luke's own messages count as read; Claude's count as answered.
          readAt: actor.kind === "user" ? new Date() : null,
          ...madeByColumns(actor),
        })
        .returning({ id: messages.id });
      if (actor.kind === "agent") {
        if (answers?.length)
          await db
            .update(messages)
            .set({ answeredAt: new Date(), answeredBy: row.id })
            .where(and(inArray(messages.id, answers), eq(messages.createdByKind, "user"), isNull(messages.answeredAt)));
        await sendPush({
          title: actor.routine ? `${actor.name} · ${actor.routine}` : actor.name,
          body: preview(text),
          url: "/messages",
          badge: await unreadMessageCount(),
          tag: "lukeos-messages",
        });
      }
      return (await listMessages({ ids: [row.id], limit: 1 }))[0];
    },
  }),

  mark_messages_read: defineOperation({
    name: "mark_messages_read",
    description: "Marks Claude's messages as seen. The app does this when Luke opens Messages; agents don't need to.",
    input: z.object({}),
    run: async () => {
      await db
        .update(messages)
        .set({ readAt: new Date() })
        .where(and(eq(messages.createdByKind, "agent"), isNull(messages.readAt)));
      return { unread: 0 };
    },
  }),
};


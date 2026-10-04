import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isInbox } from "@/lib/inbox";
import { colorHex, type ProjectColor } from "@/lib/project-colors";
import { defineOperation, madeByColumns, madeByOf, OperationError, type MadeBy } from "./define";
import { inspirationLabel } from "./inspiration";
import { assertProject, getProject } from "./projects";
import { listTasks, type Task } from "./tasks";

const { pipelineColumns, cards, cardAttachments, projects, tasks, documents, notes, inspirationItems, archiveEntries } = schema;

/** The columns a new pipeline starts with, unless others are given. */
export const DEFAULT_COLUMNS = ["Ideas", "In progress", "Review", "Done"];

export const attachmentTypes = ["document", "note", "inspiration", "entry"] as const;
export type AttachmentType = (typeof attachmentTypes)[number];
/** What can be put on a card: tasks go inside it, everything else is attached. */
export const attachableTypes = ["task", ...attachmentTypes] as const;
export type AttachableType = (typeof attachableTypes)[number];

export type PipelineColumn = { id: string; name: string; position: number };

/** An idea Luke rejected: hidden from the board, kept so it isn't suggested again. */
export type RejectedIdea = { id: string; title: string; notes: string | null; reason: string | null; rejectedAt: Date };

export type CardSummary = {
  id: string;
  title: string;
  /** The first line or two of its notes, for the board. */
  excerpt: string;
  columnId: string | null;
  project: { id: string; name: string; color: ProjectColor; hex: string };
  /** The tasks inside it. */
  taskCount: { open: number; done: number };
  attachmentCount: number;
  /** Comments not yet resolved (not counting replies). */
  openComments: number;
  madeBy: MadeBy;
  createdAt: Date;
  updatedAt: Date;
};

export type CardAttachment = { type: AttachmentType; id: string; title: string; href: string };

export type Card = CardSummary & {
  notes: string | null;
  column: PipelineColumn | null;
  tasks: Task[];
  attachments: CardAttachment[];
};

const liveCard = and(isNull(cards.deletedAt), isNull(projects.deletedAt), isNull(cards.rejectedAt));

const taskCount = {
  open: sql<number>`(select count(*) from tasks t where t.card_id = ${cards.id} and t.deleted_at is null and t.status <> 'done')`.mapWith(Number),
  done: sql<number>`(select count(*) from tasks t where t.card_id = ${cards.id} and t.deleted_at is null and t.status = 'done')`.mapWith(Number),
};
// Only things that aren't in Trash count.
const attachmentCount = sql<number>`(select count(*) from card_attachments x where x.card_id = ${cards.id} and (
  (x.item_type = 'document' and exists (select 1 from documents d where d.id = x.item_id and d.deleted_at is null))
  or (x.item_type = 'note' and exists (select 1 from notes n where n.id = x.item_id and n.deleted_at is null))
  or (x.item_type = 'inspiration' and exists (select 1 from inspiration_items i where i.id = x.item_id and i.deleted_at is null))
  or (x.item_type = 'entry' and exists (select 1 from archive_entries e where e.id = x.item_id and e.deleted_at is null))))`.mapWith(Number);
const openComments = sql<number>`(select count(*) from comments c where c.target_type = 'card' and c.target_id = ${cards.id} and c.parent_id is null and c.resolved_at is null)`.mapWith(
  Number,
);

type CardRow = typeof cards.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

function plainExcerpt(text: string | null) {
  const clean = (text ?? "").replace(/[#*_>`[\]-]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137).trimEnd()}...` : clean;
}

function toSummary(
  card: CardRow,
  project: ProjectRow,
  counts: { open: number; done: number; attachments: number; comments: number },
): CardSummary {
  return {
    id: card.id,
    title: card.title,
    excerpt: plainExcerpt(card.notes),
    columnId: card.columnId,
    project: { id: project.id, name: project.name, color: project.color as ProjectColor, hex: colorHex(project.color) },
    taskCount: { open: counts.open, done: counts.done },
    attachmentCount: counts.attachments,
    openComments: counts.comments,
    madeBy: madeByOf(card),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

/** A project's columns, in order. Empty when it has no pipeline. */
export async function listColumns(projectId: string): Promise<PipelineColumn[]> {
  return db
    .select({ id: pipelineColumns.id, name: pipelineColumns.name, position: pipelineColumns.position })
    .from(pipelineColumns)
    .where(eq(pipelineColumns.projectId, projectId))
    .orderBy(asc(pipelineColumns.position), asc(pipelineColumns.createdAt));
}

/** Live cards, in column order, then their order within the column. */
export async function listCards(filter: { projectId?: string; columnId?: string; search?: string; limit?: number } = {}): Promise<CardSummary[]> {
  const where: (SQL | undefined)[] = [liveCard];
  if (filter.projectId) where.push(eq(cards.projectId, filter.projectId));
  if (filter.columnId) where.push(eq(cards.columnId, filter.columnId));
  if (filter.search?.trim()) {
    const q = `%${filter.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    where.push(or(ilike(cards.title, q), ilike(sql`coalesce(${cards.notes}, '')`, q)));
  }
  const rows = await db
    .select({ card: cards, project: projects, open: taskCount.open, done: taskCount.done, attachments: attachmentCount, comments: openComments })
    .from(cards)
    .innerJoin(projects, eq(projects.id, cards.projectId))
    .leftJoin(pipelineColumns, eq(pipelineColumns.id, cards.columnId))
    .where(and(...where))
    .orderBy(asc(projects.createdAt), sql`${pipelineColumns.position} asc nulls first`, asc(cards.position), asc(cards.createdAt))
    .limit(filter.limit ?? 500);
  return rows.map((r) => toSummary(r.card, r.project, r));
}

async function attachmentsOf(cardId: string): Promise<CardAttachment[]> {
  const rows = await db.select().from(cardAttachments).where(eq(cardAttachments.cardId, cardId)).orderBy(asc(cardAttachments.createdAt));
  const ids = (type: AttachmentType) => rows.filter((r) => r.itemType === type).map((r) => r.itemId);
  const none = Promise.resolve([] as { id: string; title: string }[]);
  const [docs, noteRows, inspiration, entries] = await Promise.all([
    ids("document").length
      ? db.select({ id: documents.id, title: documents.title }).from(documents).where(and(inArray(documents.id, ids("document")), isNull(documents.deletedAt)))
      : none,
    ids("note").length
      ? db.select({ id: notes.id, title: notes.title }).from(notes).where(and(inArray(notes.id, ids("note")), isNull(notes.deletedAt)))
      : none,
    ids("inspiration").length
      ? db
          .select({ id: inspirationItems.id, title: inspirationItems.title, kind: inspirationItems.kind, body: inspirationItems.body, fileName: inspirationItems.fileName })
          .from(inspirationItems)
          .where(and(inArray(inspirationItems.id, ids("inspiration")), isNull(inspirationItems.deletedAt)))
          .then((items) => items.map((i) => ({ id: i.id, title: inspirationLabel(i) })))
      : none,
    ids("entry").length
      ? db
          .select({ id: archiveEntries.id, title: archiveEntries.title })
          .from(archiveEntries)
          .where(and(inArray(archiveEntries.id, ids("entry")), isNull(archiveEntries.deletedAt)))
      : none,
  ]);
  const found = { document: docs, note: noteRows, inspiration, entry: entries };
  const hrefOf = (type: AttachmentType, id: string) =>
    type === "document" ? `/documents/${id}` : type === "note" ? `/notes/${id}` : type === "entry" ? `/archive/${id}` : `/inspiration?item=${id}`;
  return rows.flatMap((r) => {
    const type = r.itemType as AttachmentType;
    const item = found[type]?.find((x) => x.id === r.itemId);
    return item ? [{ type, id: item.id, title: item.title || "Untitled", href: hrefOf(type, item.id) }] : [];
  });
}

export async function getCard(id: string): Promise<Card> {
  const [row] = await db
    .select({ card: cards, project: projects, open: taskCount.open, done: taskCount.done, attachments: attachmentCount, comments: openComments })
    .from(cards)
    .innerJoin(projects, eq(projects.id, cards.projectId))
    .where(and(eq(cards.id, id), liveCard))
    .limit(1);
  if (!row) throw new OperationError("That card doesn't exist, or it's in Trash.", 404);
  const [columns, cardTasks, attachments] = await Promise.all([
    listColumns(row.card.projectId),
    listTasks({ cardId: id, includeDone: true }),
    attachmentsOf(id),
  ]);
  const column = columns.find((c) => c.id === row.card.columnId) ?? columns[0] ?? null;
  return {
    ...toSummary(row.card, row.project, row),
    columnId: column?.id ?? null,
    notes: row.card.notes,
    column,
    tasks: cardTasks,
    attachments,
  };
}

/** A project's pipeline: its columns in order, each with its cards. */
export async function getPipeline(projectId: string) {
  const project = await getProject(projectId);
  const [columns, all, rejected] = await Promise.all([listColumns(projectId), listCards({ projectId }), listRejected(projectId)]);
  // A card whose column went away sits in the first one.
  const columnOf = (c: CardSummary) => (columns.some((col) => col.id === c.columnId) ? c.columnId : columns[0]?.id);
  return {
    project,
    columns: columns.map((col) => ({ ...col, cards: all.filter((c) => columnOf(c) === col.id) })),
    /** Ideas Luke rejected (titles and reasons only): never suggest these again. */
    rejected: rejected.map(({ title, reason }) => (reason ? { title, reason } : { title })),
  };
}

/** Ideas Luke rejected in a project's Inbox, newest first. */
export async function listRejected(projectId: string, limit = 300): Promise<RejectedIdea[]> {
  const rows = await db
    .select({ id: cards.id, title: cards.title, notes: cards.notes, reason: cards.rejectReason, rejectedAt: cards.rejectedAt })
    .from(cards)
    .where(and(eq(cards.projectId, projectId), isNotNull(cards.rejectedAt), isNull(cards.deletedAt)))
    .orderBy(desc(cards.rejectedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, rejectedAt: r.rejectedAt! }));
}

/** Finds a project's column by its id or its name (any case). */
async function findColumn(projectId: string, to: string) {
  const columns = await listColumns(projectId);
  const want = to.trim().toLowerCase();
  const column = columns.find((c) => c.id === to) ?? columns.find((c) => c.name.toLowerCase() === want);
  if (!column) {
    throw new OperationError(
      columns.length
        ? `There's no column "${to}" in this pipeline. Its columns are: ${columns.map((c) => c.name).join(", ")}.`
        : "This project has no pipeline yet. Start one with set_up_pipeline.",
    );
  }
  return column;
}

async function getColumn(id: string) {
  const [row] = await db.select().from(pipelineColumns).where(eq(pipelineColumns.id, id)).limit(1);
  if (!row) throw new OperationError("That pipeline column doesn't exist.", 404);
  await assertProject(row.projectId);
  return row;
}

/** The position after the last card in a column. */
async function endOf(columnId: string) {
  const [row] = await db
    .select({ max: sql<number | null>`max(${cards.position})` })
    .from(cards)
    .where(eq(cards.columnId, columnId));
  return (row?.max ?? -1) + 1;
}

/** Writes the columns' positions in the order given. */
async function renumber(ids: string[]) {
  await db.transaction(async (tx) => {
    for (const [position, id] of ids.entries()) {
      await tx.update(pipelineColumns).set({ position, updatedAt: new Date() }).where(eq(pipelineColumns.id, id));
    }
  });
}

/** Throws unless the thing to attach exists and isn't in Trash. */
async function assertAttachable(type: AttachableType, id: string) {
  const table =
    type === "task" ? tasks : type === "document" ? documents : type === "note" ? notes : type === "inspiration" ? inspirationItems : archiveEntries;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
    .limit(1);
  const label = { task: "task", document: "document", note: "note", inspiration: "Inspiration item", entry: "Work archive entry" }[type];
  if (!row) throw new OperationError(`That ${label} doesn't exist, or it's in Trash.`, 404);
}

const projectId = z.uuid().describe("The project's id.");
const cardId = z.uuid().describe("The card's id.");
const columnName = z.string().trim().min(1).max(100);
const to = z.string().trim().min(1).max(100).describe("The column's id or its name, e.g. \"Drafting\".");
const attachable = z
  .enum(attachableTypes)
  .describe('"task" (it goes inside the card), "document", "note", "inspiration" (an Inspiration item) or "entry" (a Work archive entry).');

export const pipelineOperations = {
  get_pipeline: defineOperation({
    name: "get_pipeline",
    description:
      "A project's pipeline, as Luke sees it on the project's Board: its columns in order (e.g. Ideas, Drafting, Review, Scheduled, Published), each with its cards. A card is a piece of work moving through the pipeline, not a task: it has a title, notes, tasks inside it, and attached documents, notes, Inspiration items and Work archive entries. Columns is empty if the project has no pipeline yet.",
    input: z.object({ projectId }),
    run: async ({ projectId }) => getPipeline(projectId),
  }),

  list_cards: defineOperation({
    name: "list_cards",
    description: "List pipeline cards, in column order: every project's, or one project's or column's. Search looks in titles and notes.",
    input: z.object({
      projectId: projectId.optional().describe("Only this project's cards."),
      column: z.string().optional().describe("Only cards in this column (its id or name). Needs projectId when it's a name."),
      search: z.string().optional().describe("Words to look for in the title or notes."),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    run: async ({ projectId, column, search, limit }) => {
      let columnId: string | undefined;
      if (column) {
        if (projectId) columnId = (await findColumn(projectId, column)).id;
        else if (z.uuid().safeParse(column).success) columnId = column;
        else throw new OperationError("Give projectId to find a column by its name.");
      }
      return listCards({ projectId, columnId, search, limit });
    },
  }),

  get_card: defineOperation({
    name: "get_card",
    description:
      "Get one pipeline card: its column, notes, the tasks inside it, and what's attached (documents, notes, Inspiration items, Work archive entries, with their ids; read them with get_document, get_note and so on). Use list_comments with targetType \"card\" for its comments.",
    input: z.object({ id: cardId }),
    run: async ({ id }) => getCard(id),
  }),

  set_up_pipeline: defineOperation({
    name: "set_up_pipeline",
    description: `Start a pipeline on a project, with these columns in order (default: ${DEFAULT_COLUMNS.join(", ")}). Only when Luke asks. It shows on the project's Board.`,
    input: z.object({
      projectId,
      columns: z.array(columnName).min(1).max(20).optional().describe("The column names, in order."),
    }),
    run: async ({ projectId, columns }) => {
      await assertProject(projectId);
      if ((await listColumns(projectId)).length) throw new OperationError("This project already has a pipeline. Use add_pipeline_column to add to it.");
      await db.insert(pipelineColumns).values((columns ?? DEFAULT_COLUMNS).map((name, position) => ({ projectId, name, position })));
      return getPipeline(projectId);
    },
  }),

  add_pipeline_column: defineOperation({
    name: "add_pipeline_column",
    description: "Add a column to a project's pipeline, at the end or at a position (0 is first). Starts a pipeline if the project has none. Only when Luke asks.",
    input: z.object({
      projectId,
      name: columnName,
      position: z.number().int().min(0).optional().describe("Where it goes: 0 is first. Leave out for the end."),
    }),
    run: async ({ projectId, name, position }) => {
      await assertProject(projectId);
      const columns = await listColumns(projectId);
      const [row] = await db
        .insert(pipelineColumns)
        .values({ projectId, name, position: columns.length })
        .returning({ id: pipelineColumns.id });
      if (position !== undefined && position < columns.length) {
        const ids = columns.map((c) => c.id);
        ids.splice(position, 0, row.id);
        await renumber(ids);
      }
      return getPipeline(projectId);
    },
  }),

  update_pipeline_column: defineOperation({
    name: "update_pipeline_column",
    description: "Rename a pipeline column or move it to another position (0 is first). Its cards stay in it. Only when Luke asks.",
    input: z.object({
      id: z.uuid().describe("The column's id."),
      name: columnName.optional(),
      position: z.number().int().min(0).optional().describe("Where it goes: 0 is first."),
    }),
    run: async ({ id, name, position }) => {
      const column = await getColumn(id);
      if (name !== undefined) await db.update(pipelineColumns).set({ name, updatedAt: new Date() }).where(eq(pipelineColumns.id, id));
      if (position !== undefined) {
        const ids = (await listColumns(column.projectId)).map((c) => c.id).filter((c) => c !== id);
        ids.splice(Math.min(position, ids.length), 0, id);
        await renumber(ids);
      }
      return getPipeline(column.projectId);
    },
  }),

  delete_pipeline_column: defineOperation({
    name: "delete_pipeline_column",
    description:
      "Delete a pipeline column. If it has cards, say which column they move to (moveCardsTo); they're never deleted with it. Deleting the last column ends the pipeline (only possible once it's empty). Only when Luke asks.",
    input: z.object({
      id: z.uuid().describe("The column's id."),
      moveCardsTo: to.optional().describe("The column its cards move to (id or name). Needed when it has cards."),
    }),
    run: async ({ id, moveCardsTo }) => {
      const column = await getColumn(id);
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(cards)
        .where(eq(cards.columnId, id));
      if (n > 0) {
        if (!moveCardsTo) throw new OperationError(`"${column.name}" has ${n} ${n === 1 ? "card" : "cards"}. Say which column they move to.`);
        const target = await findColumn(column.projectId, moveCardsTo);
        if (target.id === id) throw new OperationError("Pick a different column for its cards.");
        const start = await endOf(target.id);
        await db
          .update(cards)
          .set({ columnId: target.id, position: sql`${cards.position} + ${start}` })
          .where(eq(cards.columnId, id));
      }
      await db.delete(pipelineColumns).where(eq(pipelineColumns.id, id));
      await renumber((await listColumns(column.projectId)).map((c) => c.id));
      return getPipeline(column.projectId);
    },
  }),

  create_card: defineOperation({
    name: "create_card",
    description:
      "Add a card to a project's pipeline: a piece of work (e.g. a post or a video idea), not a to-do. It goes at the end of the column given, or the first column. If the pipeline has an Inbox column, ideas you come up with on your own go there for Luke to approve or reject; check the rejected list from get_pipeline first so you never suggest one again. Add tasks inside it with create_task and its cardId, and attach things with attach_to_card. It shows on the project's Board; nothing opens automatically.",
    input: z.object({
      projectId,
      title: z.string().trim().min(1).max(500),
      notes: z.string().max(20_000).optional().describe("Free text notes about it."),
      column: to.optional().describe("The column it starts in (id or name). Leave out for the first column."),
    }),
    run: async ({ projectId, title, notes: text, column }, { actor }) => {
      await assertProject(projectId);
      const target = column ? await findColumn(projectId, column) : (await listColumns(projectId))[0];
      if (!target) throw new OperationError("This project has no pipeline yet. Start one with set_up_pipeline (only if Luke asked).");
      const [row] = await db
        .insert(cards)
        .values({ projectId, title, notes: text?.trim() || null, columnId: target.id, position: await endOf(target.id), ...madeByColumns(actor) })
        .returning({ id: cards.id });
      return getCard(row.id);
    },
  }),

  update_card: defineOperation({
    name: "update_card",
    description: "Change a card's title or notes, or move it to another column. Fields left out stay as they are.",
    input: z.object({
      id: cardId,
      title: z.string().trim().min(1).max(500).optional(),
      notes: z.string().max(20_000).nullable().optional().describe("null clears them."),
      column: to.optional().describe("Move it to this column (id or name), at the end."),
    }),
    run: async ({ id, title, notes: text, column }) => {
      const card = await getCard(id);
      const set: Partial<CardRow> = { updatedAt: new Date() };
      if (title !== undefined) set.title = title;
      if (text !== undefined) set.notes = text?.trim() || null;
      if (column !== undefined) {
        const target = await findColumn(card.project.id, column);
        if (target.id !== card.columnId) {
          set.columnId = target.id;
          set.position = await endOf(target.id);
        }
      }
      await db.update(cards).set(set).where(eq(cards.id, id));
      return getCard(id);
    },
  }),

  move_card: defineOperation({
    name: "move_card",
    description: "Move a card to another column of its pipeline, just like dragging it on the Board. It goes at the end of that column. Moving it to the column it's in changes nothing.",
    input: z.object({ id: cardId, to }),
    run: async ({ id, to }): Promise<{ moved: boolean; card: Card }> => {
      const card = await getCard(id);
      const target = await findColumn(card.project.id, to);
      if (target.id === card.columnId) return { moved: false, card };
      await db
        .update(cards)
        .set({ columnId: target.id, position: await endOf(target.id), updatedAt: new Date() })
        .where(eq(cards.id, id));
      return { moved: true, card: await getCard(id) };
    },
  }),

  approve_card: defineOperation({
    name: "approve_card",
    description:
      "Approve an idea in a pipeline's Inbox column: it moves on to the next column (e.g. Ideas). This is what Luke's Approve button does; only use it when Luke asks.",
    input: z.object({ id: cardId }),
    run: async ({ id }) => {
      const card = await getCard(id);
      if (!isInbox(card.column)) throw new OperationError(`"${card.title}" isn't in the Inbox column.`);
      const columns = await listColumns(card.project.id);
      const next = columns[columns.findIndex((c) => c.id === card.columnId) + 1];
      if (!next) throw new OperationError("There's no column after Inbox to move it to.");
      await db
        .update(cards)
        .set({ columnId: next.id, position: await endOf(next.id), updatedAt: new Date() })
        .where(eq(cards.id, id));
      return getCard(id);
    },
  }),

  reject_card: defineOperation({
    name: "reject_card",
    description:
      "Reject an idea in a pipeline's Inbox column: it's hidden from the board but kept, and listed under \"rejected\" in get_pipeline so it's never suggested again. This is what Luke's Reject button does; only use it when Luke asks.",
    input: z.object({
      id: cardId,
      reason: z.string().trim().max(500).optional().describe("Why Luke rejected it, if he said."),
    }),
    run: async ({ id, reason }) => {
      const card = await getCard(id);
      await db
        .update(cards)
        .set({ rejectedAt: new Date(), rejectReason: reason || null, updatedAt: new Date() })
        .where(eq(cards.id, id));
      return { rejected: id, title: card.title };
    },
  }),

  unreject_card: defineOperation({
    name: "unreject_card",
    description: "Bring a rejected idea back to its project's Inbox column (undoes reject_card).",
    input: z.object({ id: cardId }),
    run: async ({ id }) => {
      const [row] = await db
        .select({ projectId: cards.projectId })
        .from(cards)
        .where(and(eq(cards.id, id), isNotNull(cards.rejectedAt), isNull(cards.deletedAt)))
        .limit(1);
      if (!row) throw new OperationError("That idea isn't rejected.", 404);
      await db.update(cards).set({ rejectedAt: null, rejectReason: null, updatedAt: new Date() }).where(eq(cards.id, id));
      return getCard(id);
    },
  }),

  list_rejected_ideas: defineOperation({
    name: "list_rejected_ideas",
    description:
      "Ideas Luke rejected from a project's Inbox, newest first, with their notes and his reason when he gave one. Check these before suggesting ideas so you never suggest the same thing (or a close variation) again. get_pipeline also lists their titles.",
    input: z.object({ projectId }),
    run: async ({ projectId }) => {
      await assertProject(projectId);
      return listRejected(projectId);
    },
  }),

  delete_card: defineOperation({
    name: "delete_card",
    description: "Move a card to Trash, where it's kept for 30 days. The tasks inside it and the things attached to it stay where they are.",
    input: z.object({ id: cardId }),
    run: async ({ id }) => {
      await getCard(id);
      await db.update(cards).set({ deletedAt: new Date() }).where(eq(cards.id, id));
      return { deleted: id };
    },
  }),

  attach_to_card: defineOperation({
    name: "attach_to_card",
    description:
      "Put something on a card: a document (e.g. a draft you wrote with create_document), a note, an Inspiration item or a Work archive entry is attached; an existing task moves inside the card (a task is in one card at most). The thing itself doesn't change otherwise.",
    input: z.object({ cardId, type: attachable, id: z.uuid().describe("The id of the thing to attach.") }),
    run: async ({ cardId, type, id }, { actor }) => {
      await getCard(cardId);
      await assertAttachable(type, id);
      if (type === "task") {
        await db.update(tasks).set({ cardId, updatedAt: new Date() }).where(eq(tasks.id, id));
      } else {
        await db
          .insert(cardAttachments)
          .values({ cardId, itemType: type, itemId: id, ...madeByColumns(actor) })
          .onConflictDoNothing();
      }
      await db.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, cardId));
      return getCard(cardId);
    },
  }),

  detach_from_card: defineOperation({
    name: "detach_from_card",
    description: "Take something off a card. The thing itself isn't deleted: a task stays a normal task, a document stays in Documents.",
    input: z.object({ cardId, type: attachable, id: z.uuid().describe("The id of the thing to take off.") }),
    run: async ({ cardId, type, id }) => {
      await getCard(cardId);
      if (type === "task") {
        await db
          .update(tasks)
          .set({ cardId: null, updatedAt: new Date() })
          .where(and(eq(tasks.id, id), eq(tasks.cardId, cardId)));
      } else {
        await db
          .delete(cardAttachments)
          .where(and(eq(cardAttachments.cardId, cardId), eq(cardAttachments.itemType, type), eq(cardAttachments.itemId, id)));
      }
      return getCard(cardId);
    },
  }),
};

import "server-only";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex, type ProjectColor } from "@/lib/project-colors";
import { defineOperation, madeByColumns, madeByOf, OperationError, type MadeBy } from "./define";
import { seenAt } from "./from-claude";
import { excerptOf } from "./notes";
import { assertProject } from "./projects";

const { documents, projects } = schema;

export type DocumentSummary = {
  id: string;
  title: string;
  /** The first line or two of text, for lists. */
  excerpt: string;
  project: { id: string; name: string; color: ProjectColor; hex: string } | null;
  madeBy: MadeBy;
  createdAt: Date;
  updatedAt: Date;
  /** Made or changed by Claude since Luke last looked at Documents. */
  isNew: boolean;
  /** Comments not yet resolved (not counting replies). */
  openComments: number;
};

export type Document = DocumentSummary & { content: string };

type ProjectRow = typeof projects.$inferSelect;

const projectOf = (p: ProjectRow | null) =>
  p ? { id: p.id, name: p.name, color: p.color as ProjectColor, hex: colorHex(p.color) } : null;

const live = and(isNull(documents.deletedAt), sql`(${projects.id} is null or ${projects.deletedAt} is null)`);

const openComments = sql<number>`(select count(*) from comments c where c.target_type = 'document' and c.target_id = ${documents.id} and c.parent_id is null and c.resolved_at is null)`.mapWith(
  Number,
);

export async function listDocuments(
  filter: { projectId?: string | null; madeBy?: "luke" | "claude"; routine?: string; search?: string; limit?: number } = {},
): Promise<DocumentSummary[]> {
  const where: (SQL | undefined)[] = [live];
  if (filter.projectId === null) where.push(isNull(documents.projectId));
  else if (filter.projectId) where.push(eq(documents.projectId, filter.projectId));
  if (filter.madeBy) where.push(eq(documents.createdByKind, filter.madeBy === "claude" ? "agent" : "user"));
  if (filter.routine) where.push(eq(documents.createdByRoutine, filter.routine));
  if (filter.search?.trim()) {
    const q = `%${filter.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    where.push(or(ilike(documents.title, q), ilike(documents.content, q)));
  }
  const [rows, seen] = await Promise.all([
    db
      .select({
        doc: {
          id: documents.id,
          title: documents.title,
          start: sql<string>`left(${documents.content}, 2000)`,
          claudeChangedAt: documents.claudeChangedAt,
          createdByKind: documents.createdByKind,
          createdByName: documents.createdByName,
          createdByRoutine: documents.createdByRoutine,
          createdAt: documents.createdAt,
          updatedAt: documents.updatedAt,
        },
        project: projects,
        openComments,
      })
      .from(documents)
      .leftJoin(projects, eq(projects.id, documents.projectId))
      .where(and(...where))
      .orderBy(desc(documents.updatedAt))
      .limit(filter.limit ?? 200),
    seenAt(),
  ]);
  return rows.map(({ doc, project, openComments }) => ({
    id: doc.id,
    title: doc.title,
    excerpt: excerptOf(doc.start, "markdown"),
    project: projectOf(project),
    madeBy: madeByOf(doc),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    isNew: doc.claudeChangedAt !== null && doc.claudeChangedAt > seen,
    openComments,
  }));
}

export async function getDocument(id: string): Promise<Document> {
  const [[row], seen] = await Promise.all([
    db
      .select({ doc: documents, project: projects, openComments })
      .from(documents)
      .leftJoin(projects, eq(projects.id, documents.projectId))
      .where(and(eq(documents.id, id), live))
      .limit(1),
    seenAt(),
  ]);
  if (!row) throw new OperationError("That document doesn't exist, or it's in Trash.", 404);
  const { doc, project } = row;
  return {
    id: doc.id,
    title: doc.title,
    excerpt: excerptOf(doc.content, "markdown"),
    content: doc.content,
    project: projectOf(project),
    madeBy: madeByOf(doc),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    isNew: doc.claudeChangedAt !== null && doc.claudeChangedAt > seen,
    openComments: row.openComments,
  };
}

const id = z.uuid().describe("The document's id.");
const title = z.string().trim().max(500).describe("The document's name, shown in lists and used as the PDF's file name. It isn't printed on the page.");
const content = z
  .string()
  .max(1_000_000)
  .describe(
    "The page's text in Markdown: start with a # heading for the document's title on the page, then ## and ### headings, paragraphs, **bold**, *italic*, lists, checklists (- [ ]), > quotes, tables, links, --- for a divider, and photos as ![](url) using a url from save_image. The page is US Letter and prints as it looks, so write it as a finished, printable document.",
  );
const projectId = z.uuid().nullable().describe("The project it belongs to. null means it stands on its own.");

export const documentOperations = {
  list_documents: defineOperation({
    name: "list_documents",
    description:
      "List Luke's documents (printable pages, by Luke or Claude), most recently changed first, with a short excerpt of each and how many unresolved comments it has. Filter by project, by who made them, by routine, or search the title and text.",
    input: z.object({
      projectId: z.uuid().nullable().optional().describe("Only this project's documents. null means ones with no project."),
      madeBy: z.enum(["luke", "claude"]).optional().describe("Only documents Luke made, or only ones Claude made."),
      routine: z.string().optional().describe("Only documents made by this routine."),
      search: z.string().optional().describe("Words to look for in the title or text."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => listDocuments(filter),
  }),

  get_document: defineOperation({
    name: "get_document",
    description: "Get one document with its full text (Markdown). Use list_comments to see what Luke said about it.",
    input: z.object({ id }),
    run: async ({ id }) => getDocument(id),
  }),

  create_document: defineOperation({
    name: "create_document",
    description:
      "Save something you wrote for Luke as a document: a report, research, a plan, a summary, a case study, a letter, anything to read, share or print. Use this for everything you make for him, not create_note (notes are Luke's own jottings). It's a printable US Letter page that Luke can edit and export as a PDF. For a routine that runs again and again, make a new document each run unless you were told to keep one up to date (then use update_document). It shows up in Luke's Documents under Made by Claude; nothing opens automatically.",
    input: z.object({ title, content: content.optional(), projectId: projectId.optional() }),
    run: async (input, { actor }) => {
      if (input.projectId) await assertProject(input.projectId);
      const [row] = await db
        .insert(documents)
        .values({
          title: input.title,
          content: input.content ?? "",
          projectId: input.projectId ?? null,
          claudeChangedAt: actor.kind === "agent" ? new Date() : null,
          ...madeByColumns(actor),
        })
        .returning({ id: documents.id });
      return getDocument(row.id);
    },
  }),

  update_document: defineOperation({
    name: "update_document",
    description:
      "Change a document: its title, its whole text, or its project. Luke edits documents too, so read the latest with get_document first and keep his changes. To add to the end without rewriting it (a running log, say), use append instead of content. Fields left out stay as they are. To act on Luke's comments: update the document, then reply_to_comment and resolve_comment.",
    input: z.object({
      id,
      title: title.optional(),
      content: content.optional(),
      append: z.string().max(200_000).optional().describe("Markdown to add to the end of the document, as a new paragraph."),
      projectId: projectId.optional(),
    }),
    run: async ({ id, title, content, append, projectId }, { actor }) => {
      const current = await getDocument(id);
      if (projectId) await assertProject(projectId);
      let body = content;
      if (append?.trim()) {
        const base = (body ?? current.content).trimEnd();
        body = base ? `${base}\n\n${append.trim()}\n` : `${append.trim()}\n`;
      }
      const set = {
        ...(title !== undefined && { title }),
        ...(body !== undefined && { content: body }),
        ...(projectId !== undefined && { projectId }),
      };
      if (Object.keys(set).length) {
        const now = new Date();
        await db
          .update(documents)
          .set({ ...set, updatedAt: now, ...(actor.kind === "agent" && { claudeChangedAt: now }) })
          .where(eq(documents.id, id));
      }
      return getDocument(id);
    },
  }),

  delete_document: defineOperation({
    name: "delete_document",
    description: "Move a document to Trash, where it's kept for 30 days.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await getDocument(id);
      await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, id));
      return { deleted: id };
    },
  }),
};

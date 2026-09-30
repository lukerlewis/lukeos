import "server-only";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex, type ProjectColor } from "@/lib/project-colors";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";
import { assertProject } from "./projects";

const { notes, projects, images } = schema;

export const noteFormats = ["markdown", "html"] as const;
export type NoteFormat = (typeof noteFormats)[number];

export type NoteSummary = {
  id: string;
  title: string;
  format: NoteFormat;
  /** The first line or two of text, for lists. */
  excerpt: string;
  project: { id: string; name: string; color: ProjectColor; hex: string } | null;
  madeBy: ReturnType<typeof madeByOf>;
  createdAt: Date;
  updatedAt: Date;
};

export type Note = NoteSummary & { content: string };

type ProjectRow = typeof projects.$inferSelect;

function projectOf(p: ProjectRow | null) {
  return p ? { id: p.id, name: p.name, color: p.color as ProjectColor, hex: colorHex(p.color) } : null;
}

/** Plain text from the start of a note, without Markdown symbols or HTML tags. */
export function excerptOf(content: string, format: string) {
  const text =
    format === "html"
      ? content
          .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
      : content
          .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // photos
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
          .replace(/^\s*(#{1,6}|[-*+]\s+\[[ xX]\]|[-*+]|\d+\.|>)\s*/gm, "")
          .replace(/[*_`~]/g, "");
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 160 ? `${clean.slice(0, 157).trimEnd()}...` : clean;
}

const live = and(isNull(notes.deletedAt), sql`(${projects.id} is null or ${projects.deletedAt} is null)`);

export async function listNotes(
  filter: {
    projectId?: string | null;
    madeBy?: "luke" | "claude";
    routine?: string;
    search?: string;
    limit?: number;
  } = {},
): Promise<NoteSummary[]> {
  const where: (SQL | undefined)[] = [live];
  if (filter.projectId === null) where.push(isNull(notes.projectId));
  else if (filter.projectId) where.push(eq(notes.projectId, filter.projectId));
  if (filter.madeBy) where.push(eq(notes.createdByKind, filter.madeBy === "claude" ? "agent" : "user"));
  if (filter.routine) where.push(eq(notes.createdByRoutine, filter.routine));
  if (filter.search?.trim()) {
    const q = `%${filter.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    where.push(or(ilike(notes.title, q), ilike(notes.content, q)));
  }

  const rows = await db
    .select({
      note: {
        id: notes.id,
        title: notes.title,
        format: notes.format,
        start: sql<string>`left(${notes.content}, 2000)`,
        createdByKind: notes.createdByKind,
        createdByName: notes.createdByName,
        createdByRoutine: notes.createdByRoutine,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
      },
      project: projects,
    })
    .from(notes)
    .leftJoin(projects, eq(projects.id, notes.projectId))
    .where(and(...where))
    .orderBy(desc(notes.updatedAt))
    .limit(filter.limit ?? 200);

  return rows.map(({ note, project }) => ({
    id: note.id,
    title: note.title,
    format: note.format as NoteFormat,
    excerpt: excerptOf(note.start, note.format),
    project: projectOf(project),
    madeBy: madeByOf(note),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }));
}

export async function getNote(id: string): Promise<Note> {
  const [row] = await db
    .select({ note: notes, project: projects })
    .from(notes)
    .leftJoin(projects, eq(projects.id, notes.projectId))
    .where(and(eq(notes.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That note doesn't exist, or it's in Trash.", 404);
  const { note, project } = row;
  return {
    id: note.id,
    title: note.title,
    format: note.format as NoteFormat,
    excerpt: excerptOf(note.content, note.format),
    content: note.content,
    project: projectOf(project),
    madeBy: madeByOf(note),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

// Photos: kept small by the app (it shrinks them before saving), and capped
// here so one upload can't fill the database.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const id = z.uuid().describe("The note's id.");
const title = z.string().trim().max(500).describe("The note's title.");
const content = z
  .string()
  .max(1_000_000)
  .describe(
    'The note\'s body. For Markdown notes: headings (#), lists (-), checklists (- [ ] and - [x]), links, and photos as ![](url) using a url from save_image. For format "html", a complete HTML page.',
  );
const projectId = z.uuid().nullable().describe("The project it belongs to. null means it stands on its own.");

export const noteOperations = {
  list_notes: defineOperation({
    name: "list_notes",
    description:
      "List notes, most recently changed first, with a short excerpt of each (use get_note for the full text). Filter by project, by who made them, by routine, or search the title and text.",
    input: z.object({
      projectId: z.uuid().nullable().optional().describe("Only this project's notes. null means notes with no project."),
      madeBy: z.enum(["luke", "claude"]).optional().describe("Only notes Luke made, or only ones Claude made."),
      routine: z.string().optional().describe("Only notes made by this routine."),
      search: z.string().optional().describe("Words to look for in the title or text."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => listNotes(filter),
  }),

  get_note: defineOperation({
    name: "get_note",
    description: "Get one note with its full text (Markdown, or HTML for a saved page).",
    input: z.object({ id }),
    run: async ({ id }) => getNote(id),
  }),

  create_note: defineOperation({
    name: "create_note",
    description:
      'Create a note, on its own or inside a project. Write it in Markdown. To save a finished document or artifact as a web page, pass format "html" and a complete HTML page as content; Luke sees it exactly as written but can\'t edit it in the app. Notes you make show up in Luke\'s From Claude section; nothing opens automatically.',
    input: z.object({
      title: title.optional(),
      content: content.optional(),
      format: z.enum(noteFormats).optional().describe('"markdown" (the default) or "html".'),
      projectId: projectId.optional(),
    }),
    run: async (input, { actor }) => {
      if (input.projectId) await assertProject(input.projectId);
      const [row] = await db
        .insert(notes)
        .values({
          title: input.title ?? "",
          content: input.content ?? "",
          format: input.format ?? "markdown",
          projectId: input.projectId ?? null,
          ...madeByColumns(actor),
        })
        .returning({ id: notes.id });
      return getNote(row.id);
    },
  }),

  update_note: defineOperation({
    name: "update_note",
    description:
      "Change a note: its title, its whole text, or its project. To add to the end without rewriting it (a running log, say), use append instead of content. Fields left out stay as they are.",
    input: z.object({
      id,
      title: title.optional(),
      content: content.optional(),
      append: z.string().max(200_000).optional().describe("Text to add to the end of the note, as a new paragraph."),
      projectId: projectId.optional(),
    }),
    run: async ({ id, title, content, append, projectId }) => {
      const current = await getNote(id);
      if (projectId) await assertProject(projectId);
      let body = content;
      if (append?.trim()) {
        const base = (body ?? current.content).trimEnd();
        body = base ? `${base}\n\n${append.trim()}\n` : `${append.trim()}\n`;
      }
      await db
        .update(notes)
        .set({
          ...(title !== undefined && { title }),
          ...(body !== undefined && { content: body }),
          ...(projectId !== undefined && { projectId }),
          updatedAt: new Date(),
        })
        .where(eq(notes.id, id));
      return getNote(id);
    },
  }),

  delete_note: defineOperation({
    name: "delete_note",
    description: "Move a note to Trash, where it's kept for 30 days.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await getNote(id);
      await db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, id));
      return { deleted: id };
    },
  }),

  save_image: defineOperation({
    name: "save_image",
    description:
      "Save a photo (JPEG, PNG, WebP or GIF, up to 3 MB) so it can go in a note. Returns a url and a ready-made Markdown line to put in the note's text.",
    input: z.object({
      data: z.base64().describe("The image file, base64 encoded."),
      mimeType: z.enum(imageTypes),
      alt: z.string().max(300).optional().describe("A short description of the photo."),
    }),
    run: async ({ data, mimeType, alt }, { actor }) => {
      const bytes = Buffer.from(data, "base64");
      if (bytes.length === 0) throw new OperationError("That image is empty.");
      if (bytes.length > MAX_IMAGE_BYTES) throw new OperationError("That image is over 3 MB. Make it smaller first.");
      const [row] = await db
        .insert(images)
        .values({ mimeType, bytes: bytes.length, data: bytes, ...madeByColumns(actor) })
        .returning({ id: images.id });
      const url = `/api/images/${row.id}`;
      return { id: row.id, url, markdown: `![${(alt ?? "").replace(/[[\]]/g, "")}](${url})` };
    },
  }),
};

export async function getImage(id: string) {
  const [row] = await db
    .select({ mimeType: images.mimeType, data: images.data })
    .from(images)
    .where(and(eq(images.id, id), isNull(images.deletedAt)))
    .limit(1);
  return row ?? null;
}

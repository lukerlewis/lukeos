import "server-only";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex, type ProjectColor } from "@/lib/project-colors";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";
import { tagMentions } from "@/lib/mentions";
import { syncMentions } from "./mentions";
import { assertProject } from "./projects";

const { notes, projects, images } = schema;

import { noteFormats, type NoteFormat } from "@/lib/note-formats";

export { noteFormats, type NoteFormat };

export type NoteSummary = {
  id: string;
  title: string;
  format: NoteFormat;
  /** The first line or two of text, for lists. */
  excerpt: string;
  project: { id: string; name: string; color: ProjectColor; hex: string } | null;
  /** Pinned notes sit at the top of every list of notes. */
  pinned: boolean;
  madeBy: ReturnType<typeof madeByOf>;
  createdAt: Date;
  updatedAt: Date;
};

export type Note = NoteSummary & {
  content: string;
  /** The scratch pad on the dashboard, rather than a note in Notes. */
  scratchPad: boolean;
};

type ProjectRow = typeof projects.$inferSelect;

function projectOf(p: ProjectRow | null) {
  return p ? { id: p.id, name: p.name, color: p.color as ProjectColor, hex: colorHex(p.color) } : null;
}

/** A note's words, without Markdown symbols or HTML tags. */
export function plainTextOf(content: string, format: string) {
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
          .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, "") // table dividers
          .replace(/\|/g, " ")
          .replace(/[*_`~]/g, "");
  return text.replace(/\s+/g, " ").trim();
}

/** Plain text from the start of a note, for lists. Headings are skipped if there's other text. */
export function excerptOf(content: string, format: string) {
  const withoutHeadings = format === "markdown" ? content.replace(/^\s*#{1,6}\s.*$/gm, "") : content;
  const clean = plainTextOf(withoutHeadings, format) || plainTextOf(content, format);
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
  // The scratch pad lives on the dashboard, not in Notes.
  const where: (SQL | undefined)[] = [live, eq(notes.kind, "note")];
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
        pinnedAt: notes.pinnedAt,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
      },
      project: projects,
    })
    .from(notes)
    .leftJoin(projects, eq(projects.id, notes.projectId))
    .where(and(...where))
    // Pinned notes first (the most recently pinned on top), then the rest by when they were changed.
    .orderBy(sql`${notes.pinnedAt} desc nulls last`, desc(notes.updatedAt))
    .limit(filter.limit ?? 200);

  return rows.map(({ note, project }) => ({
    id: note.id,
    title: note.title,
    format: note.format as NoteFormat,
    excerpt: excerptOf(note.start, note.format),
    project: projectOf(project),
    pinned: note.pinnedAt !== null,
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
    scratchPad: note.kind === "scratchpad",
    project: projectOf(project),
    pinned: note.pinnedAt !== null,
    madeBy: madeByOf(note),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** The dashboard's scratch pad, made the first time it's needed. */
export async function getScratchPad(): Promise<Note> {
  const [row] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.kind, "scratchpad"), isNull(notes.deletedAt)))
    .limit(1);
  if (row) return getNote(row.id);
  const [created] = await db.insert(notes).values({ title: "Scratch pad", kind: "scratchpad" }).returning({ id: notes.id });
  return getNote(created.id);
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
      "List notes: pinned ones first, then the most recently changed, with a short excerpt of each (use get_note for the full text). Filter by project, by who made them, by routine, or search the title and text.",
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
      "Create a note in Luke's Notes, on its own or inside a project, written in Markdown. Notes are Luke's own writing, so only do this when he explicitly asks for a note. For anything else you write for him (reports, pages, research), use create_artifact.",
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
          // Luke's @claude tags each get an id, so they stay the same request as he edits.
          content: actor.kind === "user" ? tagMentions(input.content ?? "", () => crypto.randomUUID()) : (input.content ?? ""),
          format: input.format ?? "markdown",
          projectId: input.projectId ?? null,
          ...madeByColumns(actor),
        })
        .returning({ id: notes.id });
      const note = await getNote(row.id);
      await syncMentions("note", note.id, [note.title, note.content], actor);
      return note;
    },
  }),

  update_note: defineOperation({
    name: "update_note",
    description:
      "Change one of Luke's notes: its title, its whole text, its project, or whether it's pinned to the top of his notes. Only when Luke explicitly asks you to change his note. To add to the end without rewriting it (a running log, say), use append instead of content. Fields left out stay as they are.",
    input: z.object({
      id,
      title: title.optional(),
      content: content.optional(),
      append: z.string().max(200_000).optional().describe("Text to add to the end of the note, as a new paragraph."),
      projectId: projectId.optional(),
      pinned: z.boolean().optional().describe("true pins the note to the top of Luke's notes; false unpins it."),
    }),
    run: async ({ id, title, content, append, projectId, pinned }, { actor }) => {
      const current = await getNote(id);
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
        ...(pinned !== undefined && pinned !== current.pinned && { pinnedAt: pinned ? new Date() : null }),
        // Pinning isn't editing, so it doesn't change when the note was last edited.
        ...((title !== undefined || body !== undefined || projectId !== undefined) && { updatedAt: new Date() }),
      };
      if (Object.keys(set).length) await db.update(notes).set(set).where(eq(notes.id, id));
      const note = await getNote(id);
      await syncMentions("note", id, [note.title, note.content], actor);
      return note;
    },
  }),

  delete_note: defineOperation({
    name: "delete_note",
    description: "Move a note to Trash, where it's kept for 30 days.",
    input: z.object({ id }),
    run: async ({ id }) => {
      if ((await getNote(id)).scratchPad) throw new OperationError("That's Luke's scratch pad, which can't be deleted. Change its text instead.");
      await db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, id));
      return { deleted: id };
    },
  }),

  save_image: defineOperation({
    name: "save_image",
    description:
      "Save a photo (JPEG, PNG, WebP or GIF, up to 3 MB) so it can go in an artifact or a note. Returns a url, and a ready-made Markdown line to put in the text (in an HTML part, use <img src=\"url\">).",
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

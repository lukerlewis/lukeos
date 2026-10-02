import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { entrySizes, entryStages, safeLinkUrl, type EntrySize, type EntryStage } from "@/lib/archive";
import { defineOperation, madeByColumns, madeByOf, OperationError, type MadeBy } from "./define";
import { excerptOf } from "./notes";

const { archiveEntries, archiveFiles } = schema;

/**
 * The Work archive: Luke's record of the work he's done, from a quick win
 * that would make a good story to a multi-year project, kept as raw material
 * for case studies, his portfolio and content.
 */

export { entrySizes, entryStages, type EntrySize, type EntryStage };

/** A file or link kept with an entry. Files open at `url` (/api/files/<id>). */
export type EntryFile = {
  id: string;
  kind: "file" | "link";
  name: string;
  url: string;
  mimeType: string | null;
  bytes: number | null;
  createdAt: Date;
};

export type EntrySummary = {
  id: string;
  title: string;
  size: EntrySize;
  stage: EntryStage;
  company: string | null;
  role: string | null;
  period: string | null;
  outcome: string | null;
  confidential: boolean;
  /** The first photo in the story, if there is one. */
  cover: string | null;
  /** The start of the story, for lists. */
  excerpt: string;
  fileCount: number;
  madeBy: MadeBy;
  createdAt: Date;
  updatedAt: Date;
};

export type Entry = EntrySummary & { story: string; files: EntryFile[] };

/** Files up to 4 MB, which is as much as one upload to the app can carry. Bigger things go in as links. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Through the connector the file comes as text (base64), which is a third bigger, so a little less. */
const MAX_CLAUDE_FILE_BYTES = 3 * 1024 * 1024;

const live = isNull(archiveEntries.deletedAt);

/** The first photo in a story, e.g. /api/images/<id>. */
export function coverOf(story: string) {
  return story.match(/!\[[^\]]*\]\((\/api\/images\/[0-9a-f-]{36})\)/i)?.[1] ?? null;
}

type Row = typeof archiveEntries.$inferSelect;

function summaryOf(row: Omit<Row, "story"> & { story: string }, fileCount: number): EntrySummary {
  return {
    id: row.id,
    title: row.title,
    size: row.size as EntrySize,
    stage: row.stage as EntryStage,
    company: row.company,
    role: row.role,
    period: row.period,
    outcome: row.outcome,
    confidential: row.confidential,
    cover: coverOf(row.story),
    excerpt: excerptOf(row.story, "markdown"),
    fileCount,
    madeBy: madeByOf(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const fileUrl = (f: { id: string; kind: string; url: string | null }) => (f.kind === "link" ? (f.url ?? "") : `/api/files/${f.id}`);

export async function listEntries(
  filter: { size?: EntrySize; stage?: EntryStage; search?: string; limit?: number } = {},
): Promise<EntrySummary[]> {
  const where: (SQL | undefined)[] = [live];
  if (filter.size) where.push(eq(archiveEntries.size, filter.size));
  if (filter.stage) where.push(eq(archiveEntries.stage, filter.stage));
  if (filter.search?.trim()) {
    const q = `%${filter.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    where.push(
      or(
        ilike(archiveEntries.title, q),
        ilike(archiveEntries.story, q),
        ilike(sql`coalesce(${archiveEntries.company}, '')`, q),
        ilike(sql`coalesce(${archiveEntries.role}, '')`, q),
        ilike(sql`coalesce(${archiveEntries.outcome}, '')`, q),
      ),
    );
  }
  const rows = await db
    .select({
      entry: archiveEntries,
      files: sql<number>`(select count(*) from archive_files f where f.entry_id = archive_entries.id)`.mapWith(Number),
    })
    .from(archiveEntries)
    .where(and(...where))
    .orderBy(desc(archiveEntries.updatedAt))
    .limit(filter.limit ?? 200);
  return rows.map(({ entry, files }) => summaryOf(entry, files));
}

export async function getEntry(id: string): Promise<Entry> {
  const [row] = await db
    .select()
    .from(archiveEntries)
    .where(and(eq(archiveEntries.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That Work archive entry doesn't exist, or it's in Trash.", 404);
  const files = await db
    .select({
      id: archiveFiles.id,
      kind: archiveFiles.kind,
      name: archiveFiles.name,
      url: archiveFiles.url,
      mimeType: archiveFiles.mimeType,
      bytes: archiveFiles.bytes,
      createdAt: archiveFiles.createdAt,
    })
    .from(archiveFiles)
    .where(eq(archiveFiles.entryId, id))
    .orderBy(asc(archiveFiles.createdAt));
  return {
    ...summaryOf(row, files.length),
    story: row.story,
    files: files.map((f) => ({ ...f, kind: f.kind as EntryFile["kind"], url: fileUrl(f) })),
  };
}

async function assertEntry(id: string) {
  const [row] = await db
    .select({ id: archiveEntries.id })
    .from(archiveEntries)
    .where(and(eq(archiveEntries.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That Work archive entry doesn't exist, or it's in Trash.", 404);
}

/** Changing what's kept with an entry counts as changing the entry. */
const touch = (id: string) => db.update(archiveEntries).set({ updatedAt: new Date() }).where(eq(archiveEntries.id, id));

/** Keeps a file with an entry. Used by the app's upload and by Claude's add_archive_file. */
export async function addEntryFile(
  entryId: string,
  file: { name: string; mimeType: string; data: Buffer },
  actor: Parameters<typeof madeByColumns>[0],
): Promise<EntryFile> {
  await assertEntry(entryId);
  if (file.data.length === 0) throw new OperationError("That file is empty.");
  if (file.data.length > MAX_FILE_BYTES) throw new OperationError("That file is over 4 MB. Add a link to it instead.");
  const [row] = await db
    .insert(archiveFiles)
    .values({
      entryId,
      kind: "file",
      name: file.name.trim().slice(0, 300) || "File",
      mimeType: file.mimeType.slice(0, 200) || "application/octet-stream",
      bytes: file.data.length,
      data: file.data,
      ...madeByColumns(actor),
    })
    .returning();
  await touch(entryId);
  return { id: row.id, kind: "file", name: row.name, url: fileUrl(row), mimeType: row.mimeType, bytes: row.bytes, createdAt: row.createdAt };
}

export async function getEntryFile(id: string) {
  const [row] = await db
    .select({ name: archiveFiles.name, mimeType: archiveFiles.mimeType, data: archiveFiles.data })
    .from(archiveFiles)
    .innerJoin(archiveEntries, eq(archiveEntries.id, archiveFiles.entryId))
    .where(and(eq(archiveFiles.id, id), eq(archiveFiles.kind, "file"), live))
    .limit(1);
  return row?.data ? row : null;
}

export async function archiveCount() {
  const [row] = await db.select({ n: count() }).from(archiveEntries).where(live);
  return row.n;
}

const id = z.uuid().describe("The entry's id, from list_archive.");
const title = z.string().trim().max(300).describe('A short name in Luke\'s words, e.g. "Checkout redesign".');
const size = z
  .enum(entrySizes)
  .describe('"win": one moment or result. "story": a situation with a beginning, middle and end. "project": months or years of work.');
const stage = z
  .enum(entryStages)
  .describe('"raw": captured, not written up. "drafted": a case study or post has been drafted from it. "published": Luke says it\'s out.');
const story = z
  .string()
  .max(1_000_000)
  .describe("The story in Markdown, in Luke's own words, with photos as ![](url) using a url from save_image. The first photo is the cover.");
const short = (what: string) => z.string().trim().max(300).nullable().describe(what);
const company = short("The company or client.");
const role = short("Luke's role.");
const period = short('When it happened, in Luke\'s words, e.g. "2021 to 2024" or "March 2025".');
const outcome = short("The result, in a line.");
const confidential = z.boolean().describe("True if it names a client or has internal numbers, so it needs disguising before it's shared.");

const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

export const archiveOperations = {
  list_archive: defineOperation({
    name: "list_archive",
    description:
      "List Luke's Work archive: his record of work he's done, from quick wins to multi-year projects, kept for case studies, his portfolio and content. Most recently changed first, with a short excerpt of each story (get_archive_entry has the full story and files). Filter by size or stage, or search the words.",
    input: z.object({
      size: size.optional().describe("Only this size: win, story or project."),
      stage: stage.optional().describe("Only this stage: raw, drafted or published."),
      search: z.string().optional().describe("Words to look for in the title, story, company, role or outcome."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => listEntries(filter),
  }),

  get_archive_entry: defineOperation({
    name: "get_archive_entry",
    description: "Get one Work archive entry with its full story, details, and the files and links kept with it.",
    input: z.object({ id }),
    run: async ({ id }) => getEntry(id),
  }),

  create_archive_entry: defineOperation({
    name: "create_archive_entry",
    description:
      "Add an entry to Luke's Work archive. Check list_archive first: if the piece of work is already there, add to that entry with update_archive_entry (append) instead. Keep Luke's own words in the story and never invent numbers, dates or outcomes. New entries start as raw.",
    input: z.object({
      title: title.optional(),
      size: size.optional().describe('win, story or project (default "win").'),
      stage: stage.optional(),
      story: story.optional(),
      company: company.optional(),
      role: role.optional(),
      period: period.optional(),
      outcome: outcome.optional(),
      confidential: confidential.optional(),
    }),
    run: async (input, { actor }) => {
      const [row] = await db
        .insert(archiveEntries)
        .values({
          title: input.title ?? "",
          size: input.size ?? "win",
          stage: input.stage ?? "raw",
          story: input.story ?? "",
          company: blank(input.company) ?? null,
          role: blank(input.role) ?? null,
          period: blank(input.period) ?? null,
          outcome: blank(input.outcome) ?? null,
          confidential: input.confidential ?? false,
          ...madeByColumns(actor),
        })
        .returning({ id: archiveEntries.id });
      return getEntry(row.id);
    },
  }),

  update_archive_entry: defineOperation({
    name: "update_archive_entry",
    description:
      "Change a Work archive entry: its title, size, stage, story, details or whether it's confidential. To add something new to it (another win, an update, a photo) without rewriting it, use append. Fields left out stay as they are; null clears a detail.",
    input: z.object({
      id,
      title: title.optional(),
      size: size.optional(),
      stage: stage.optional(),
      story: story.optional(),
      append: z.string().max(200_000).optional().describe("Markdown to add to the end of the story, as a new paragraph."),
      company: company.optional(),
      role: role.optional(),
      period: period.optional(),
      outcome: outcome.optional(),
      confidential: confidential.optional(),
    }),
    run: async ({ id, append, ...input }) => {
      const current = await getEntry(id);
      let body = input.story;
      if (append?.trim()) {
        const base = (body ?? current.story).trimEnd();
        body = base ? `${base}\n\n${append.trim()}\n` : `${append.trim()}\n`;
      }
      const set = {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.size !== undefined && { size: input.size }),
        ...(input.stage !== undefined && { stage: input.stage }),
        ...(body !== undefined && { story: body }),
        ...(input.company !== undefined && { company: blank(input.company) }),
        ...(input.role !== undefined && { role: blank(input.role) }),
        ...(input.period !== undefined && { period: blank(input.period) }),
        ...(input.outcome !== undefined && { outcome: blank(input.outcome) }),
        ...(input.confidential !== undefined && { confidential: input.confidential }),
      };
      if (Object.keys(set).length) await db.update(archiveEntries).set({ ...set, updatedAt: new Date() }).where(eq(archiveEntries.id, id));
      return getEntry(id);
    },
  }),

  delete_archive_entry: defineOperation({
    name: "delete_archive_entry",
    description: "Move a Work archive entry (with its files and links) to Trash, where it's kept for 30 days. Only when Luke asks.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await assertEntry(id);
      await db.update(archiveEntries).set({ deletedAt: new Date() }).where(eq(archiveEntries.id, id));
      return { deleted: id };
    },
  }),

  add_archive_link: defineOperation({
    name: "add_archive_link",
    description:
      "Keep a link with a Work archive entry: a Figma file, a live site, a video, a press piece, anything too big to store or that lives elsewhere.",
    input: z.object({
      entryId: id,
      url: z.string().trim().min(1).max(2000).describe("The web address."),
      name: z.string().trim().max(300).optional().describe('What it is, e.g. "Figma file" or "Launch video". Defaults to the address.'),
    }),
    run: async ({ entryId, url, name }, { actor }) => {
      await assertEntry(entryId);
      const safe = safeLinkUrl(url);
      if (!safe) throw new OperationError("That doesn't look like a web address.");
      const [row] = await db
        .insert(archiveFiles)
        .values({ entryId, kind: "link", name: name?.trim() || new URL(safe).hostname.replace(/^www\./, ""), url: safe, ...madeByColumns(actor) })
        .returning();
      await touch(entryId);
      return { id: row.id, kind: "link" as const, name: row.name, url: safe, mimeType: null, bytes: null, createdAt: row.createdAt };
    },
  }),

  add_archive_file: defineOperation({
    name: "add_archive_file",
    description:
      "Keep a file (a PDF, a deck, a short video...) with a Work archive entry, up to 3 MB. For photos, put them in the story instead (save_image, then update_archive_entry with append). Anything bigger: add_archive_link.",
    input: z.object({
      entryId: id,
      name: z.string().trim().min(1).max(300).describe('The file name, e.g. "Case study.pdf".'),
      mimeType: z.string().trim().min(1).max(200).describe('The file type, e.g. "application/pdf".'),
      data: z.base64().describe("The file, base64 encoded."),
    }),
    run: async ({ entryId, name, mimeType, data }, { actor }) => {
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > MAX_CLAUDE_FILE_BYTES) throw new OperationError("That file is over 3 MB. Add a link to it instead.");
      return addEntryFile(entryId, { name, mimeType, data: bytes }, actor);
    },
  }),

  remove_archive_file: defineOperation({
    name: "remove_archive_file",
    description: "Remove a file or link from a Work archive entry, for good. Only when Luke asks.",
    input: z.object({ id: z.uuid().describe("The file or link's id, from get_archive_entry.") }),
    run: async ({ id }) => {
      const [row] = await db.delete(archiveFiles).where(eq(archiveFiles.id, id)).returning({ entryId: archiveFiles.entryId, name: archiveFiles.name });
      if (!row) throw new OperationError("That file or link doesn't exist.", 404);
      await touch(row.entryId);
      return { removed: id, name: row.name, entryId: row.entryId };
    },
  }),
};

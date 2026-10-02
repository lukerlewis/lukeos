import "server-only";
import { and, count, desc, eq, ilike, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import sharp from "sharp";
import { z } from "zod";
import { db, schema } from "@/db";
import { cleanTags, inspirationKinds, MAX_UPLOAD_BYTES, siteOf, type InspirationKind } from "@/lib/inspiration";
import { downloadPicture, fetchPreview, looksLikeUrl, safeWebUrl } from "@/lib/link-preview";
import { preparePicture } from "@/lib/picture";
import { readStoredBytes, storageUsage, storeFile } from "@/lib/storage";
import { defineOperation, madeByColumns, madeByOf, OperationError, type Actor, type MadeBy } from "./define";

const { inspirationItems, projects, storedFiles } = schema;

/**
 * Inspiration: Luke's gallery of things that inspire him, like mymind.
 * Pictures, links (with their preview), videos (as links), quotes and PDFs.
 * Claude tags and describes each new one at its next check-in, so search
 * finds things by what's in them.
 */

export { inspirationKinds, type InspirationKind };

export type InspirationItem = {
  id: string;
  kind: InspirationKind;
  title: string;
  url: string | null;
  site: string | null;
  body: string;
  note: string;
  summary: string | null;
  tags: string[];
  project: { id: string; name: string; color: string } | null;
  /** The picture (about 2000px) and the gallery's small copy, at /api/stored/<id>. */
  image: string | null;
  thumb: string | null;
  width: number | null;
  height: number | null;
  file: { url: string; name: string; mimeType: string; bytes: number } | null;
  /** Claude has tagged and described it. */
  tagged: boolean;
  madeBy: MadeBy;
  createdAt: Date;
  updatedAt: Date;
};

const live = isNull(inspirationItems.deletedAt);
const fileRow = alias(storedFiles, "file_row");
const storedUrl = (id: string | null) => (id ? `/api/stored/${id}` : null);

const selection = {
  item: inspirationItems,
  project: { id: projects.id, name: projects.name, color: projects.color, deletedAt: projects.deletedAt },
  file: { mimeType: fileRow.mimeType, bytes: fileRow.bytes },
};

type Row = {
  item: typeof inspirationItems.$inferSelect;
  project: { id: string; name: string; color: string; deletedAt: Date | null } | null;
  file: { mimeType: string; bytes: number } | null;
};

function toItem({ item, project, file }: Row): InspirationItem {
  return {
    id: item.id,
    kind: item.kind as InspirationKind,
    title: item.title,
    url: item.url,
    site: siteOf(item.url),
    body: item.body,
    note: item.note,
    summary: item.summary,
    tags: item.tags,
    project: project && !project.deletedAt ? { id: project.id, name: project.name, color: project.color } : null,
    image: storedUrl(item.imageId),
    thumb: storedUrl(item.thumbId ?? item.imageId),
    width: item.width,
    height: item.height,
    file:
      item.fileId && file
        ? { url: `/api/stored/${item.fileId}`, name: item.fileName ?? "File", mimeType: file.mimeType, bytes: file.bytes }
        : null,
    tagged: item.taggedAt !== null,
    madeBy: madeByOf(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

const baseQuery = () =>
  db
    .select(selection)
    .from(inspirationItems)
    .leftJoin(projects, eq(projects.id, inspirationItems.projectId))
    .leftJoin(fileRow, eq(fileRow.id, inspirationItems.fileId));

export type InspirationFilter = {
  search?: string;
  tag?: string;
  kind?: InspirationKind;
  projectId?: string;
  untagged?: boolean;
  limit?: number;
};

/** Everything a search looks in. */
const searchable = sql`concat_ws(' ', ${inspirationItems.title}, ${inspirationItems.body}, ${inspirationItems.note}, ${inspirationItems.summary}, ${inspirationItems.url}, ${inspirationItems.fileName}, array_to_string(${inspirationItems.tags}, ' '))`;

export async function listInspiration(filter: InspirationFilter = {}): Promise<InspirationItem[]> {
  const where: (SQL | undefined)[] = [live];
  if (filter.kind) where.push(eq(inspirationItems.kind, filter.kind));
  if (filter.projectId) where.push(eq(inspirationItems.projectId, filter.projectId));
  if (filter.untagged) where.push(isNull(inspirationItems.taggedAt));
  if (filter.tag?.trim()) where.push(sql`${filter.tag.trim().toLowerCase()} = any(${inspirationItems.tags})`);
  for (const word of (filter.search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    where.push(ilike(searchable, `%${word.replace(/[\\%_]/g, "\\$&")}%`));
  }
  const rows = await baseQuery()
    .where(and(...where))
    .orderBy(desc(inspirationItems.createdAt))
    .limit(filter.limit ?? 300);
  return rows.map(toItem);
}

/** The most used tags, most used first. */
export async function inspirationTags(limit = 40) {
  const rows = await db.execute<{ tag: string; n: number }>(sql`
    select tag, count(*)::int as n from inspiration_items, unnest(tags) as tag
    where deleted_at is null group by tag order by n desc, tag limit ${limit}`);
  return rows.rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
}

export async function inspirationCount() {
  const [row] = await db.select({ n: count() }).from(inspirationItems).where(live);
  return row.n;
}

export async function getInspiration(id: string): Promise<InspirationItem> {
  const [row] = await baseQuery()
    .where(and(eq(inspirationItems.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That Inspiration item doesn't exist, or it's in Trash.", 404);
  return toItem(row);
}

async function assertRoom() {
  const usage = await storageUsage();
  if (usage.full) throw new OperationError("Inspiration storage is full. Delete some things (and empty Trash) to make room.", 507);
}

async function assertProject(projectId: string | null | undefined) {
  if (!projectId) return;
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) throw new OperationError("That project doesn't exist.", 404);
}

/** Keeps a picture's two copies, returning the columns that point at them. */
async function keepPicture(data: Buffer) {
  const picture = await preparePicture(data).catch((err: Error) => {
    throw new OperationError(err.message);
  });
  const display = await storeFile(picture.display.data, picture.display.mimeType);
  const thumb = await storeFile(picture.thumb.data, picture.thumb.mimeType);
  return { imageId: display.id, thumbId: thumb.id, width: picture.width, height: picture.height };
}

export type NewDetails = { title?: string; note?: string; tags?: string[]; projectId?: string | null; url?: string | null };

async function insert(values: Partial<typeof inspirationItems.$inferInsert> & { kind: InspirationKind }, details: NewDetails, actor: Actor) {
  await assertProject(details.projectId);
  const [row] = await db
    .insert(inspirationItems)
    .values({
      title: details.title?.trim().slice(0, 300) ?? "",
      note: details.note?.trim() ?? "",
      tags: cleanTags(details.tags ?? []),
      projectId: details.projectId ?? null,
      ...values,
      ...madeByColumns(actor),
    })
    .returning({ id: inspirationItems.id });
  return getInspiration(row.id);
}

/** Saves a web address: a page (with its preview picture), a video, or a picture on the web. */
export async function addLink(raw: string, details: NewDetails, actor: Actor) {
  if (!safeWebUrl(raw)) throw new OperationError("That doesn't look like a web address.");
  await assertRoom();
  const preview = await fetchPreview(raw).catch(() => null);
  if (!preview) throw new OperationError("That doesn't look like a web address.");
  let picture: Awaited<ReturnType<typeof keepPicture>> | null = null;
  if (preview.imageUrl) {
    const data = await downloadPicture(preview.imageUrl);
    if (data) picture = await keepPicture(data).catch(() => null);
  }
  if (preview.kind === "image" && !picture) throw new OperationError("Couldn't download that picture.");
  return insert(
    {
      kind: preview.kind,
      url: preview.url,
      body: preview.kind === "image" ? "" : (preview.description ?? ""),
      ...picture,
    },
    { ...details, title: details.title?.trim() || preview.title?.slice(0, 300) || "" },
    actor,
  );
}

export async function addText(text: string, details: NewDetails, actor: Actor) {
  const body = text.trim();
  if (!body) throw new OperationError("There's nothing to save.");
  if (looksLikeUrl(body)) return addLink(body, details, actor);
  return insert({ kind: "text", body: body.slice(0, 20_000), url: details.url ? (safeWebUrl(details.url)?.toString() ?? null) : null }, details, actor);
}

export async function addPicture(data: Buffer, details: NewDetails, actor: Actor) {
  if (!data.length) throw new OperationError("That picture is empty.");
  await assertRoom();
  const picture = await keepPicture(data);
  return insert({ kind: "image", url: details.url ? (safeWebUrl(details.url)?.toString() ?? null) : null, ...picture }, details, actor);
}

/** A PDF or other file. Pictures go through addPicture instead. */
export async function addFile(data: Buffer, file: { name: string; mimeType: string }, details: NewDetails, actor: Actor) {
  if (!data.length) throw new OperationError("That file is empty.");
  if (data.length > MAX_UPLOAD_BYTES) throw new OperationError("That file is over 4 MB.");
  if (file.mimeType.startsWith("video/")) throw new OperationError("Save videos as links (YouTube, Vimeo, Instagram...).");
  await assertRoom();
  const stored = await storeFile(data, file.mimeType || "application/octet-stream");
  const name = file.name.trim().slice(0, 300) || "File";
  return insert(
    { kind: "file", fileId: stored.id, fileName: name },
    { ...details, title: details.title?.trim() || name.replace(/\.[a-z0-9]{1,5}$/i, "") },
    actor,
  );
}

/** Anything a person (or the iPhone Shortcut) drops in: a picture, a file, a link or some text. */
export async function addUpload(
  upload: { data: Buffer; name: string; mimeType: string } | { text: string },
  details: NewDetails,
  actor: Actor,
) {
  if ("text" in upload) return addText(upload.text, details, actor);
  if (upload.mimeType.startsWith("image/") && upload.mimeType !== "image/svg+xml") return addPicture(upload.data, details, actor);
  return addFile(upload.data, upload, details, actor);
}

/** A picture small enough for Claude to look at. */
async function pictureForClaude(item: InspirationItem) {
  const id = (item.image ?? item.thumb)?.split("/").pop();
  if (!id) return null;
  const file = await readStoredBytes(id);
  if (!file) return null;
  const data = await sharp(file.data).resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return { data: data.toString("base64"), mimeType: "image/webp" };
}

const id = z.uuid().describe("The item's id, from list_inspiration.");
const tags = z.array(z.string().max(60)).max(30);
const kind = z.enum(inspirationKinds);

const changes = {
  title: z.string().trim().max(300).optional().describe("A short name."),
  note: z.string().max(20_000).optional().describe("Luke's own note about it. Only change when he asks."),
  body: z.string().max(20_000).optional().describe("For a quote: its text."),
  summary: z.string().trim().max(1000).nullable().optional().describe("Your short description of what it is and what's notable about it (style, colours, subject, mood), in one to three sentences."),
  tags: tags.optional().describe("Replace all its tags."),
  addTags: tags.optional().describe("Tags to add, keeping the ones it has."),
  removeTags: tags.optional().describe("Tags to take off."),
  projectId: z.uuid().nullable().optional().describe("Link it to a project (null unlinks it)."),
  url: z.string().trim().max(2000).nullable().optional().describe("Where it came from."),
};

type Changes = { [K in keyof typeof changes]?: z.infer<(typeof changes)[K]> };

async function applyChanges(itemId: string, input: Changes, actor: Actor) {
  const current = await getInspiration(itemId);
  await assertProject(input.projectId);
  let nextTags: string[] | undefined;
  if (input.tags || input.addTags || input.removeTags) {
    const removed = new Set(cleanTags(input.removeTags ?? []));
    nextTags = cleanTags([...(input.tags ?? current.tags), ...(input.addTags ?? [])]).filter((t) => !removed.has(t));
  }
  let url: string | null | undefined;
  if (input.url !== undefined) {
    url = input.url ? safeWebUrl(input.url)?.toString() : null;
    if (url === undefined) throw new OperationError("That doesn't look like a web address.");
  }
  const set = {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.note !== undefined && { note: input.note }),
    ...(input.body !== undefined && current.kind === "text" && { body: input.body }),
    ...(input.summary !== undefined && { summary: input.summary?.trim() || null }),
    ...(nextTags && { tags: nextTags }),
    ...(input.projectId !== undefined && { projectId: input.projectId }),
    ...(url !== undefined && { url }),
  };
  // Claude tagging or describing it counts as done, so it stops showing in get_inbox.
  const tagging = actor.kind === "agent" && (nextTags !== undefined || input.summary !== undefined);
  if (Object.keys(set).length || tagging)
    await db
      .update(inspirationItems)
      .set({ ...set, updatedAt: new Date(), ...(tagging && { taggedAt: new Date() }) })
      .where(eq(inspirationItems.id, itemId));
  return getInspiration(itemId);
}

/** How the check-in should handle new items, sent with them in get_inbox. */
export const TAGGING_HOW_TO =
  "For each one: get_inspiration (it shows you the picture), then update_inspiration with tags (3 to 8 short lower-case words: subject, style, colours, mood, medium; reuse Luke's existing tags where they fit, from list_inspiration_tags), a one to three sentence summary, and a short title if it has none. Keep any tags Luke added (use addTags). Several at once: update_inspirations.";

export const inspirationOperations = {
  list_inspiration: defineOperation({
    name: "list_inspiration",
    description:
      "List Luke's Inspiration: his gallery of things that inspire him (pictures, links, videos, quotes, PDFs), newest first, with tags and your descriptions. Search looks in titles, text, notes, descriptions, tags and addresses; every word must match.",
    input: z.object({
      search: z.string().max(200).optional(),
      tag: z.string().max(60).optional().describe("Only things with this tag."),
      kind: kind.optional().describe("image, link, video, text (quotes) or file."),
      projectId: z.uuid().optional().describe("Only things linked to this project."),
      untagged: z.boolean().optional().describe("Only things you haven't tagged yet."),
      limit: z.number().int().min(1).max(300).optional(),
    }),
    run: async (filter) => listInspiration({ ...filter, limit: filter.limit ?? 100 }),
  }),

  list_inspiration_tags: defineOperation({
    name: "list_inspiration_tags",
    description: "The tags used in Inspiration, most used first, so new tags match the ones Luke already has.",
    input: z.object({}),
    run: async () => inspirationTags(200),
  }),

  get_inspiration: defineOperation({
    name: "get_inspiration",
    description: "Get one Inspiration item with all its details. With look (default true) you also get its picture to look at.",
    input: z.object({ id, look: z.boolean().optional().describe("Include the picture (default true).") }),
    run: async ({ id, look }) => {
      const item = await getInspiration(id);
      if (look === false) return item;
      const picture = await pictureForClaude(item).catch(() => null);
      return picture ? { ...item, __images: [picture] } : item;
    },
  }),

  add_inspiration: defineOperation({
    name: "add_inspiration",
    description:
      "Save something to Luke's Inspiration. Give exactly one of: url (a web page, video or picture on the web: its preview is saved too), text (a quote or snippet), or image (a picture, base64, up to 3 MB). Tag it and describe it while you're at it.",
    input: z.object({
      url: z.string().trim().max(2000).optional(),
      text: z.string().max(20_000).optional(),
      image: z.object({ data: z.base64(), mimeType: z.string().regex(/^image\//) }).optional(),
      source: z.string().max(2000).optional().describe("For text or a picture: the web page it came from."),
      title: changes.title,
      note: changes.note,
      tags: tags.optional(),
      summary: changes.summary,
      projectId: z.uuid().nullable().optional().describe("A project to link it to."),
    }),
    run: async ({ url, text, image, source, summary, ...details }, { actor }) => {
      const given = [url, text, image].filter((v) => v !== undefined && v !== "").length;
      if (given !== 1) throw new OperationError("Give exactly one of url, text or image.");
      const extra = { ...details, url: source };
      let item: InspirationItem;
      if (image) {
        const data = Buffer.from(image.data, "base64");
        if (data.length > 3 * 1024 * 1024) throw new OperationError("That picture is over 3 MB.");
        item = await addPicture(data, extra, actor);
      } else if (url) item = await addLink(url, extra, actor);
      else item = await addText(text!, extra, actor);
      return summary !== undefined || details.tags?.length ? applyChanges(item.id, { summary, tags: details.tags }, actor) : item;
    },
  }),

  update_inspiration: defineOperation({
    name: "update_inspiration",
    description:
      "Change an Inspiration item: tags, your description (summary), title, project, where it came from, a quote's text, or Luke's note (only when he asks). Setting tags or a summary marks it as tagged, so it stops showing in get_inbox.",
    input: z.object({ id, ...changes }),
    run: async ({ id, ...input }, { actor }) => applyChanges(id, input, actor),
  }),

  update_inspirations: defineOperation({
    name: "update_inspirations",
    description: "Tag and describe several Inspiration items at once. Each change works like update_inspiration.",
    input: z.object({
      items: z
        .array(z.object({ id, tags: changes.tags, addTags: changes.addTags, removeTags: changes.removeTags, summary: changes.summary, title: changes.title, projectId: changes.projectId }))
        .min(1)
        .max(50),
    }),
    run: async ({ items }, { actor }) => {
      const updated = [];
      for (const { id, ...input } of items) updated.push(await applyChanges(id, input, actor));
      return { updated: updated.map((i) => ({ id: i.id, title: i.title, tags: i.tags })) };
    },
  }),

  delete_inspiration: defineOperation({
    name: "delete_inspiration",
    description: "Move an Inspiration item to Trash, where it's kept for 30 days. Only when Luke asks.",
    input: z.object({ id }),
    run: async ({ id }) => {
      const item = await getInspiration(id);
      await db.update(inspirationItems).set({ deletedAt: new Date() }).where(eq(inspirationItems.id, id));
      return { deleted: id, title: item.title };
    },
  }),
};

/** New things Claude hasn't tagged yet, for get_inbox. */
export async function untaggedInspiration() {
  const rows = await db
    .select({ id: inspirationItems.id, kind: inspirationItems.kind, title: inspirationItems.title, createdAt: inspirationItems.createdAt })
    .from(inspirationItems)
    .where(and(live, isNull(inspirationItems.taggedAt)))
    .orderBy(desc(inspirationItems.createdAt))
    .limit(30);
  return rows;
}

/** For the activity log and Trash: just a title, even for untitled things. */
export function inspirationLabel(row: { title: string; kind: string; body?: string; fileName?: string | null }) {
  if (row.title.trim()) return row.title.trim();
  if (row.kind === "text" && row.body) return row.body.trim().slice(0, 60);
  if (row.fileName) return row.fileName;
  return { image: "Picture", link: "Link", video: "Video", text: "Quote", file: "File" }[row.kind as InspirationKind] ?? "Item";
}

export const searchableInspiration = searchable;

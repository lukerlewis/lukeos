import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { fetchPreview, safeWebUrl } from "@/lib/link-preview";
import { defineOperation, madeByColumns, madeByOf, OperationError, type MadeBy } from "./define";
import { assertProject } from "./projects";

const { projectLinks } = schema;

export type ProjectLink = {
  id: string;
  projectId: string;
  url: string;
  /** The page's title, or Luke's own name for it. */
  title: string | null;
  note: string | null;
  /** The web address's site, e.g. figma.com. */
  site: string;
  madeBy: MadeBy;
  createdAt: Date;
};

function toLink(row: typeof projectLinks.$inferSelect): ProjectLink {
  let site = row.url;
  try {
    site = new URL(row.url).hostname.replace(/^www\./, "");
  } catch {}
  return {
    id: row.id,
    projectId: row.projectId,
    url: row.url,
    title: row.title,
    note: row.note,
    site,
    madeBy: madeByOf(row),
    createdAt: row.createdAt,
  };
}

/** A project's links, newest first. */
export async function listLinks(projectId: string): Promise<ProjectLink[]> {
  const rows = await db.select().from(projectLinks).where(eq(projectLinks.projectId, projectId)).orderBy(desc(projectLinks.createdAt));
  return rows.map(toLink);
}

async function getLink(id: string) {
  const [row] = await db.select().from(projectLinks).where(eq(projectLinks.id, id)).limit(1);
  if (!row) throw new OperationError("That link doesn't exist.", 404);
  return toLink(row);
}

function cleanUrl(raw: string) {
  const url = safeWebUrl(raw);
  if (!url) throw new OperationError("That doesn't look like a web address.");
  return url.toString();
}

/** The page's own title, or null if it can't be read. */
async function pageTitle(url: string) {
  try {
    return (await fetchPreview(url)).title?.trim().slice(0, 300) || null;
  } catch {
    return null;
  }
}

const id = z.uuid().describe("The link's id.");
const url = z.string().trim().min(1, "Add a web address.").max(4000).describe("The web address, e.g. https://figma.com/file/...");
const title = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .describe("What the link is called. Left out or empty, the page's own title is used.");
const note = z.string().trim().max(4000).nullable().describe("A short note about the link.");

export const linkOperations = {
  list_links: defineOperation({
    name: "list_links",
    description: "List the links saved on a project's Links tab (web address, title, note), newest first.",
    input: z.object({ projectId: z.uuid().describe("The project's id.") }),
    run: async ({ projectId }) => {
      await assertProject(projectId);
      return listLinks(projectId);
    },
  }),

  add_link: defineOperation({
    name: "add_link",
    description:
      "Save a web link on a project's Links tab, for pages Luke keeps coming back to for that project (a Figma file, a doc, a site). Without a title, the page's own title is used.",
    input: z.object({ projectId: z.uuid().describe("The project to save it on."), url, title: title.optional(), note: note.optional() }),
    run: async (input, { actor }) => {
      await assertProject(input.projectId);
      const href = cleanUrl(input.url);
      const [row] = await db
        .insert(projectLinks)
        .values({
          projectId: input.projectId,
          url: href,
          title: input.title || (await pageTitle(href)),
          note: input.note || null,
          ...madeByColumns(actor),
        })
        .returning();
      return toLink(row);
    },
  }),

  update_link: defineOperation({
    name: "update_link",
    description: "Change a saved link's web address, title or note. Fields left out stay as they are; null or empty clears the title or note.",
    input: z.object({ id, url: url.optional(), title: title.optional(), note: note.optional() }),
    run: async ({ id, url, title, note }) => {
      await getLink(id);
      const href = url !== undefined ? cleanUrl(url) : undefined;
      await db
        .update(projectLinks)
        .set({
          ...(href !== undefined && { url: href }),
          ...(title !== undefined && { title: title || null }),
          ...(note !== undefined && { note: note || null }),
          updatedAt: new Date(),
        })
        .where(eq(projectLinks.id, id));
      return getLink(id);
    },
  }),

  delete_link: defineOperation({
    name: "delete_link",
    description: "Remove a saved link from its project. Only when Luke asks.",
    input: z.object({ id }),
    run: async ({ id }) => {
      const link = await getLink(id);
      await db.delete(projectLinks).where(eq(projectLinks.id, id));
      return { deleted: id, projectId: link.projectId, url: link.url, title: link.title, note: link.note };
    },
  }),
};

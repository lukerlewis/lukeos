import "server-only";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex, type ProjectColor } from "@/lib/project-colors";
import { defineOperation, madeByColumns, OperationError } from "./define";
import { assertProject } from "./projects";

const { noteFolders, notes, projects } = schema;

export type Folder = {
  id: string;
  name: string;
  /** The project it's attached to: its notes show on that project too. */
  project: { id: string; name: string; color: ProjectColor; hex: string } | null;
  /** How many notes are in it (not counting Trash). */
  noteCount: number;
};

export async function listFolders(filter: { projectId?: string } = {}): Promise<Folder[]> {
  const rows = await db
    .select({ folder: noteFolders, project: projects })
    .from(noteFolders)
    // A project in Trash no longer counts as attached.
    .leftJoin(projects, and(eq(projects.id, noteFolders.projectId), isNull(projects.deletedAt)))
    .where(filter.projectId ? and(eq(noteFolders.projectId, filter.projectId), isNotNull(projects.id)) : undefined)
    .orderBy(sql`lower(${noteFolders.name})`, asc(noteFolders.createdAt));

  const counts = await db
    .select({ folderId: notes.folderId, n: count() })
    .from(notes)
    .where(and(isNull(notes.deletedAt), eq(notes.kind, "note")))
    .groupBy(notes.folderId);
  const countOf = new Map(counts.map((c) => [c.folderId, c.n]));

  return rows.map(({ folder, project }) => ({
    id: folder.id,
    name: folder.name,
    project: project ? { id: project.id, name: project.name, color: project.color as ProjectColor, hex: colorHex(project.color) } : null,
    noteCount: countOf.get(folder.id) ?? 0,
  }));
}

export async function getFolder(id: string): Promise<Folder> {
  const folder = (await listFolders()).find((f) => f.id === id);
  if (!folder) throw new OperationError("That folder doesn't exist.", 404);
  return folder;
}

export async function assertFolder(id: string) {
  const [row] = await db.select({ id: noteFolders.id }).from(noteFolders).where(eq(noteFolders.id, id)).limit(1);
  if (!row) throw new OperationError("That folder doesn't exist.", 404);
}

const id = z.uuid().describe("The folder's id.");
const name = z.string().trim().min(1, "Give the folder a name.").max(200).describe("The folder's name.");
const projectId = z
  .uuid()
  .nullable()
  .describe("The project to attach it to, so its notes show on that project. null means it isn't attached to one.");

export const folderOperations = {
  list_folders: defineOperation({
    name: "list_folders",
    description:
      "List the folders in Luke's Notes, with the project each is attached to and how many notes are in it. Use list_notes with folderId to see a folder's notes.",
    input: z.object({ projectId: z.uuid().optional().describe("Only folders attached to this project.") }),
    run: async (filter) => listFolders(filter),
  }),

  create_folder: defineOperation({
    name: "create_folder",
    description: "Make a folder in Luke's Notes, optionally attached to a project. Only when Luke asks for one.",
    input: z.object({ name, projectId: projectId.optional() }),
    run: async (input, { actor }) => {
      if (input.projectId) await assertProject(input.projectId);
      const [row] = await db
        .insert(noteFolders)
        .values({ name: input.name, projectId: input.projectId ?? null, ...madeByColumns(actor) })
        .returning({ id: noteFolders.id });
      return getFolder(row.id);
    },
  }),

  update_folder: defineOperation({
    name: "update_folder",
    description: "Rename a folder, or attach it to a project or detach it (projectId null). Fields left out stay as they are.",
    input: z.object({ id, name: name.optional(), projectId: projectId.optional() }),
    run: async ({ id, name, projectId }) => {
      await assertFolder(id);
      if (projectId) await assertProject(projectId);
      await db
        .update(noteFolders)
        .set({ ...(name !== undefined && { name }), ...(projectId !== undefined && { projectId }), updatedAt: new Date() })
        .where(eq(noteFolders.id, id));
      return getFolder(id);
    },
  }),

  delete_folder: defineOperation({
    name: "delete_folder",
    description: "Delete a folder. Its notes are kept: they just aren't in a folder any more.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await assertFolder(id);
      // The notes' folder is cleared by the database (on delete set null).
      await db.delete(noteFolders).where(eq(noteFolders.id, id));
      return { deleted: id };
    },
  }),
};

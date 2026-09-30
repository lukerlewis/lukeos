import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { projectColorNames, type ProjectColor } from "@/lib/project-colors";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";
import { listTasks } from "./tasks";

const { projects, tasks } = schema;

export type Project = {
  id: string;
  name: string;
  color: ProjectColor;
  openTasks: number;
  doneTasks: number;
  madeBy: ReturnType<typeof madeByOf>;
  createdAt: Date;
};

const colorInput = z.enum(projectColorNames).describe(`One of: ${projectColorNames.join(", ")}.`);

/** Live (not in Trash) projects, oldest first, with task counts. */
export async function listProjects(): Promise<Project[]> {
  const rows = await db
    .select({
      project: projects,
      openTasks: sql<number>`count(${tasks.id}) filter (where ${tasks.status} <> 'done')`.mapWith(Number),
      doneTasks: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')`.mapWith(Number),
    })
    .from(projects)
    .leftJoin(tasks, and(eq(tasks.projectId, projects.id), isNull(tasks.deletedAt)))
    .where(isNull(projects.deletedAt))
    .groupBy(projects.id)
    .orderBy(asc(projects.createdAt));
  return rows.map(({ project, openTasks, doneTasks }) => ({
    id: project.id,
    name: project.name,
    color: project.color as ProjectColor,
    openTasks,
    doneTasks,
    madeBy: madeByOf(project),
    createdAt: project.createdAt,
  }));
}

export async function getProject(id: string) {
  const project = (await listProjects()).find((p) => p.id === id);
  if (!project) throw new OperationError("That project doesn't exist, or it's in Trash.", 404);
  return project;
}

/** Throws unless `id` is a live project. Used before putting a task in it. */
export async function assertProject(id: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) throw new OperationError("That project doesn't exist, or it's in Trash.", 404);
}

async function nextColor(): Promise<ProjectColor> {
  const used = new Set((await listProjects()).map((p) => p.color));
  return projectColorNames.find((c) => !used.has(c)) ?? projectColorNames[used.size % projectColorNames.length];
}

const id = z.uuid().describe("The project's id.");

export const projectOperations = {
  list_projects: defineOperation({
    name: "list_projects",
    description: "List Luke's projects (not ones in Trash) with how many open and done tasks each has.",
    input: z.object({}),
    run: async () => listProjects(),
  }),

  get_project: defineOperation({
    name: "get_project",
    description: "Get one project and all of its tasks, including done ones.",
    input: z.object({ id }),
    run: async ({ id }) => ({
      ...(await getProject(id)),
      tasks: await listTasks({ projectId: id, includeDone: true }),
    }),
  }),

  create_project: defineOperation({
    name: "create_project",
    description: "Create a project. If no colour is given, an unused one is picked.",
    input: z.object({
      name: z.string().trim().min(1).max(200),
      color: colorInput.optional(),
    }),
    run: async ({ name, color }, { actor }) => {
      const [row] = await db
        .insert(projects)
        .values({ name, color: color ?? (await nextColor()), ...madeByColumns(actor) })
        .returning({ id: projects.id });
      return getProject(row.id);
    },
  }),

  update_project: defineOperation({
    name: "update_project",
    description: "Rename a project or change its colour.",
    input: z.object({
      id,
      name: z.string().trim().min(1).max(200).optional(),
      color: colorInput.optional(),
    }),
    run: async ({ id, name, color }) => {
      await assertProject(id);
      await db
        .update(projects)
        .set({ ...(name !== undefined && { name }), ...(color !== undefined && { color }), updatedAt: new Date() })
        .where(eq(projects.id, id));
      return getProject(id);
    },
  }),

  delete_project: defineOperation({
    name: "delete_project",
    description: "Move a project and all of its tasks to Trash, where they are kept for 30 days.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await assertProject(id);
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.update(projects).set({ deletedAt: now }).where(eq(projects.id, id));
        await tx
          .update(tasks)
          .set({ deletedAt: now })
          .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt)));
      });
      return { deleted: id };
    },
  }),
};

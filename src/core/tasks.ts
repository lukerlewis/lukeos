import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addDays, isoDay, nextRepeat } from "@/lib/dates";
import { colorHex, type ProjectColor } from "@/lib/project-colors";
import { efforts, priorities, repeats, statuses, type Effort, type Priority, type Repeat, type Status } from "@/lib/task-fields";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";
import { syncMentions } from "./mentions";
import { assertProject } from "./projects";
import { today } from "./settings";

const { tasks, projects } = schema;

export type Task = {
  id: string;
  title: string;
  status: Status;
  dueDate: string | null;
  priority: Priority | null;
  effort: Effort | null;
  notes: string | null;
  /** How often it comes back once done: daily, weekly or monthly. */
  repeat: Repeat | null;
  project: { id: string; name: string; color: ProjectColor; hex: string } | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  madeBy: ReturnType<typeof madeByOf>;
};

type TaskRow = typeof tasks.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

function toTask(t: TaskRow, p: ProjectRow | null): Task {
  return {
    id: t.id,
    title: t.title,
    status: t.status as Status,
    dueDate: t.dueDate,
    priority: t.priority as Priority | null,
    effort: t.effort as Effort | null,
    notes: t.notes,
    repeat: t.repeat as Repeat | null,
    project: p ? { id: p.id, name: p.name, color: p.color as ProjectColor, hex: colorHex(p.color) } : null,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    madeBy: madeByOf(t),
  };
}

// Doing first, then To do, then Done. Within that: soonest due date, then
// highest priority, then oldest.
const statusRank = sql`case ${tasks.status} when 'doing' then 0 when 'todo' then 1 else 2 end`;
const priorityRank = sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end`;

export async function listTasks(filter: {
  projectId?: string | null;
  status?: Status;
  includeDone?: boolean;
  dueOnOrBefore?: string;
  dueOnOrAfter?: string;
  limit?: number;
}) {
  const where: (SQL | undefined)[] = [isNull(tasks.deletedAt)];
  if (filter.projectId === null) where.push(isNull(tasks.projectId));
  else if (filter.projectId) where.push(eq(tasks.projectId, filter.projectId));
  if (filter.status) where.push(eq(tasks.status, filter.status));
  else if (!filter.includeDone) where.push(ne(tasks.status, "done"));
  if (filter.dueOnOrBefore) where.push(lte(tasks.dueDate, filter.dueOnOrBefore));
  if (filter.dueOnOrAfter) where.push(gte(tasks.dueDate, filter.dueOnOrAfter));

  const rows = await db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    // A task whose project is in Trash is in Trash too.
    .where(and(...where, sql`(${projects.id} is null or ${projects.deletedAt} is null)`))
    .orderBy(statusRank, sql`${tasks.dueDate} asc nulls last`, priorityRank, asc(tasks.createdAt))
    .limit(filter.limit ?? 500);
  return rows.map((r) => toTask(r.task, r.project));
}

export async function getTask(id: string) {
  const [row] = await db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row || row.project?.deletedAt) throw new OperationError("That task doesn't exist, or it's in Trash.", 404);
  return toTask(row.task, row.project);
}

/** What the Today screen shows: late and due-today tasks, and the week ahead. */
export async function getToday() {
  const date = await today();
  const [dueByToday, upcoming] = await Promise.all([
    listTasks({ dueOnOrBefore: date }),
    listTasks({ dueOnOrAfter: addDays(date, 1), dueOnOrBefore: addDays(date, 7) }),
  ]);
  return {
    date,
    overdue: dueByToday.filter((t) => t.dueDate! < date),
    today: dueByToday.filter((t) => t.dueDate === date),
    upcoming,
  };
}

/**
 * Keeps repeating tasks going. When one is done, the next one is made (once),
 * due on the next day, week or month. If it's un-ticked again, that next one
 * is taken back, as long as it hasn't been started or changed. Called after
 * anything that can change a task's status.
 */
export async function syncRepeats(ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db.select().from(tasks).where(and(inArray(tasks.id, ids), isNull(tasks.deletedAt)));
  const date = await today();
  for (const t of rows) {
    if (t.status === "done" && t.repeat && !t.repeatNextId) {
      const [next] = await db
        .insert(tasks)
        .values({
          title: t.title,
          projectId: t.projectId,
          status: "todo",
          dueDate: nextRepeat(t.dueDate, t.repeat as Repeat, date),
          priority: t.priority,
          effort: t.effort,
          notes: t.notes,
          repeat: t.repeat,
          createdByKind: t.createdByKind,
          createdByName: t.createdByName,
          createdByRoutine: t.createdByRoutine,
        })
        .returning({ id: tasks.id });
      await db.update(tasks).set({ repeatNextId: next.id }).where(eq(tasks.id, t.id));
    } else if (t.status !== "done" && t.repeatNextId) {
      await db
        .delete(tasks)
        .where(and(eq(tasks.id, t.repeatNextId), eq(tasks.status, "todo"), sql`${tasks.updatedAt} = ${tasks.createdAt}`));
      await db.update(tasks).set({ repeatNextId: null }).where(eq(tasks.id, t.id));
    }
  }
}

// Inputs: every field but the title is optional, and `null` clears a field.
const id = z.uuid().describe("The task's id.");
const dueDate = z
  .string()
  .regex(isoDay, "Use a date like 2026-10-02.")
  .nullable()
  .describe("Due date as YYYY-MM-DD in Luke's time zone (get_today tells you today's date). null clears it.");
export const fields = {
  title: z.string().trim().min(1).max(500),
  projectId: z.uuid().nullable().describe("The project to put it in. null means no project."),
  status: z.enum(statuses).describe("todo, doing or done."),
  dueDate,
  priority: z.enum(priorities).nullable().describe("low, medium or high. null clears it."),
  effort: z.enum(efforts).nullable().describe("How big the task is: small, medium or large. null clears it."),
  notes: z.string().max(20_000).nullable().describe("Free text notes. null clears them."),
  repeat: z
    .enum(repeats)
    .nullable()
    .describe(
      "daily, weekdays (Monday to Friday), weekly, monthly or yearly: when it's marked done, the next one is added automatically, due a day, weekday, week, month or year on. null stops it repeating.",
    ),
};

export const taskOperations = {
  get_today: defineOperation({
    name: "get_today",
    description:
      "What's on Luke's plate: today's date in his time zone, open tasks that are overdue or due today, and open tasks due in the next 7 days.",
    input: z.object({}),
    run: async () => getToday(),
  }),

  list_tasks: defineOperation({
    name: "list_tasks",
    description:
      "List tasks, soonest due first. By default only open tasks (To do and Doing) from every project. Filter by project, status or a due date range.",
    input: z.object({
      projectId: z.uuid().nullable().optional().describe("Only this project's tasks. null means tasks with no project."),
      status: z.enum(statuses).optional(),
      includeDone: z.boolean().optional().describe("Include done tasks too. Ignored if status is set."),
      dueOnOrAfter: z.string().regex(isoDay).optional().describe("YYYY-MM-DD"),
      dueOnOrBefore: z.string().regex(isoDay).optional().describe("YYYY-MM-DD"),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    run: async (filter) => listTasks(filter),
  }),

  get_task: defineOperation({
    name: "get_task",
    description: "Get one task with all its fields, including notes.",
    input: z.object({ id }),
    run: async ({ id }) => getTask(id),
  }),

  create_task: defineOperation({
    name: "create_task",
    description:
      "Create a task. Only the title is required; it starts as To do unless a status is given. Set repeat for something that comes back every day, weekday, week, month or year.",
    input: z.object({
      title: fields.title,
      projectId: fields.projectId.optional(),
      status: fields.status.optional(),
      dueDate: fields.dueDate.optional(),
      priority: fields.priority.optional(),
      effort: fields.effort.optional(),
      notes: fields.notes.optional(),
      repeat: fields.repeat.optional(),
    }),
    run: async (input, { actor }) => {
      if (input.projectId) await assertProject(input.projectId);
      const status = input.status ?? "todo";
      const [row] = await db
        .insert(tasks)
        .values({
          title: input.title,
          projectId: input.projectId ?? null,
          status,
          dueDate: input.dueDate ?? null,
          priority: input.priority ?? null,
          effort: input.effort ?? null,
          notes: input.notes?.trim() || null,
          repeat: input.repeat ?? null,
          completedAt: status === "done" ? new Date() : null,
          ...madeByColumns(actor),
        })
        .returning({ id: tasks.id });
      await syncRepeats([row.id]);
      await syncMentions("task", row.id, [input.title, input.notes], actor);
      return getTask(row.id);
    },
  }),

  update_task: defineOperation({
    name: "update_task",
    description:
      "Change any fields of a task: title, project, status, due date, priority, effort, notes or how it repeats. Fields left out stay as they are; null clears one. Marking a repeating task done adds the next one.",
    input: z.object({
      id,
      title: fields.title.optional(),
      projectId: fields.projectId.optional(),
      status: fields.status.optional(),
      dueDate: fields.dueDate.optional(),
      priority: fields.priority.optional(),
      effort: fields.effort.optional(),
      notes: fields.notes.optional(),
      repeat: fields.repeat.optional(),
    }),
    run: async ({ id, ...changes }, { actor }) => {
      const current = await getTask(id);
      if (changes.projectId) await assertProject(changes.projectId);
      const set: Partial<TaskRow> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) (set as Record<string, unknown>)[key] = value;
      }
      if (changes.notes !== undefined) set.notes = changes.notes?.trim() || null;
      if (changes.status && changes.status !== current.status) {
        set.completedAt = changes.status === "done" ? new Date() : null;
      }
      await db.update(tasks).set(set).where(eq(tasks.id, id));
      await syncRepeats([id]);
      const task = await getTask(id);
      if (changes.title !== undefined || changes.notes !== undefined) await syncMentions("task", id, [task.title, task.notes], actor);
      return task;
    },
  }),

  delete_task: defineOperation({
    name: "delete_task",
    description: "Move a task to Trash, where it's kept for 30 days.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await getTask(id);
      await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, id));
      return { deleted: id };
    },
  }),
};

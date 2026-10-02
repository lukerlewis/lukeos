import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { changesForMove, columnIds } from "@/lib/board";
import type { Bucket, Status } from "@/lib/task-fields";
import { defineOperation, OperationError } from "./define";
import { assertProject } from "./projects";
import { fields, syncRepeats } from "./tasks";

/**
 * Doing the same thing to several tasks, notes or artifacts at once, as Luke does when he
 * selects a few in the app. Each returns how many it changed and their titles.
 */

const { tasks, notes, artifacts, projects } = schema;

const ids = (what: string) => z.array(z.uuid()).min(1).max(200).describe(`The ${what}' ids.`);

type Outcome = { count: number; titles: string[]; project?: string | null };

async function liveTitles(table: typeof tasks | typeof notes | typeof artifacts, list: string[]) {
  const rows = await db
    .select({ id: table.id, title: table.title })
    .from(table)
    // The dashboard's scratch pad isn't changed in bulk.
    .where(and(inArray(table.id, list), isNull(table.deletedAt), table === notes ? eq(notes.kind, "note") : undefined));
  if (rows.length === 0) throw new OperationError(`None of those ${table === tasks ? "tasks" : table === notes ? "notes" : "artifacts"} exist, or they're in Trash.`, 404);
  return rows;
}

async function projectName(id: string | null | undefined) {
  if (!id) return id;
  await assertProject(id);
  const [row] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, id)).limit(1);
  return row.name;
}

export const bulkOperations = {
  update_tasks: defineOperation({
    name: "update_tasks",
    description:
      "Change several tasks at once: their project, list (bucket), status, due date, priority or effort. The same changes go to every task listed. Fields left out stay as they are; null clears one.",
    input: z.object({
      ids: ids("tasks"),
      projectId: fields.projectId.optional(),
      status: fields.status.optional(),
      bucket: fields.bucket.optional(),
      dueDate: fields.dueDate.optional(),
      priority: fields.priority.optional(),
      effort: fields.effort.optional(),
    }),
    run: async ({ ids, ...changes }): Promise<Outcome> => {
      const rows = await liveTitles(tasks, ids);
      const project = await projectName(changes.projectId);
      const set: Record<string, unknown> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(changes)) if (value !== undefined) set[key] = value;
      if (changes.status) {
        // Only tasks whose status actually changes get a new finished time.
        set.completedAt = sql`case when ${tasks.status} = ${changes.status} then ${tasks.completedAt} else ${
          changes.status === "done" ? new Date() : null
        }::timestamptz end`;
      }
      await db.update(tasks).set(set).where(inArray(tasks.id, rows.map((r) => r.id)));
      if (changes.status) await syncRepeats(rows.map((r) => r.id));
      return { count: rows.length, titles: rows.map((r) => r.title), project };
    },
  }),

  move_tasks: defineOperation({
    name: "move_tasks",
    description:
      "Move several tasks to a board column at once, just like move_task does for one. today, tomorrow, this_week and later put them in that list (due dates stay as they are); todo, doing and done set the status. Tasks already in that column are left alone.",
    input: z.object({ ids: ids("tasks"), to: z.enum(columnIds) }),
    run: async ({ ids, to }): Promise<Outcome> => {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(inArray(tasks.id, ids), isNull(tasks.deletedAt)));
      const moved: string[] = [];
      await db.transaction(async (tx) => {
        for (const task of rows) {
          const changes = changesForMove({ bucket: task.bucket as Bucket, status: task.status as Status }, to);
          if (!changes) continue;
          const set: Record<string, unknown> = { ...changes, updatedAt: new Date() };
          if ("status" in changes) set.completedAt = changes.status === "done" ? new Date() : null;
          await tx.update(tasks).set(set).where(eq(tasks.id, task.id));
          moved.push(task.title);
        }
      });
      await syncRepeats(rows.map((r) => r.id));
      return { count: moved.length, titles: moved };
    },
  }),

  delete_tasks: defineOperation({
    name: "delete_tasks",
    description: "Move several tasks to Trash at once. They're kept there for 30 days.",
    input: z.object({ ids: ids("tasks") }),
    run: async ({ ids }): Promise<Outcome> => {
      const rows = await liveTitles(tasks, ids);
      await db.update(tasks).set({ deletedAt: new Date() }).where(inArray(tasks.id, rows.map((r) => r.id)));
      return { count: rows.length, titles: rows.map((r) => r.title) };
    },
  }),

  update_notes: defineOperation({
    name: "update_notes",
    description:
      "Change several notes at once: move them into a project or out of their project (projectId null), or pin or unpin them. Fields left out stay as they are.",
    input: z.object({
      ids: ids("notes"),
      projectId: z.uuid().nullable().optional().describe("The project to put them in. null means they stand on their own."),
      pinned: z.boolean().optional().describe("true pins them to the top of Luke's notes; false unpins them."),
    }),
    run: async ({ ids, projectId, pinned }): Promise<Outcome> => {
      if (projectId === undefined && pinned === undefined) throw new OperationError("Say what to change: projectId or pinned.");
      const rows = await liveTitles(notes, ids);
      const project = await projectName(projectId);
      const now = new Date();
      await db
        .update(notes)
        .set({
          ...(projectId !== undefined && { projectId, updatedAt: now }),
          // Notes already pinned keep their place.
          ...(pinned !== undefined && { pinnedAt: pinned ? sql`coalesce(${notes.pinnedAt}, ${now})` : null }),
        })
        .where(inArray(notes.id, rows.map((r) => r.id)));
      return { count: rows.length, titles: rows.map((r) => r.title), project };
    },
  }),

  delete_notes: defineOperation({
    name: "delete_notes",
    description: "Move several notes to Trash at once. They're kept there for 30 days.",
    input: z.object({ ids: ids("notes") }),
    run: async ({ ids }): Promise<Outcome> => {
      const rows = await liveTitles(notes, ids);
      await db.update(notes).set({ deletedAt: new Date() }).where(inArray(notes.id, rows.map((r) => r.id)));
      return { count: rows.length, titles: rows.map((r) => r.title) };
    },
  }),

  update_artifacts: defineOperation({
    name: "update_artifacts",
    description: "Move several artifacts into a project at once, or out of their project (projectId null).",
    input: z.object({
      ids: ids("artifacts"),
      projectId: z.uuid().nullable().describe("The project to put them in. null means they stand on their own."),
    }),
    run: async ({ ids, projectId }): Promise<Outcome> => {
      const rows = await liveTitles(artifacts, ids);
      const project = await projectName(projectId);
      await db
        .update(artifacts)
        .set({ projectId, updatedAt: new Date() })
        .where(inArray(artifacts.id, rows.map((r) => r.id)));
      return { count: rows.length, titles: rows.map((r) => r.title), project };
    },
  }),

  delete_artifacts: defineOperation({
    name: "delete_artifacts",
    description: "Move several artifacts to Trash at once. They're kept there for 30 days.",
    input: z.object({ ids: ids("artifacts") }),
    run: async ({ ids }): Promise<Outcome> => {
      const rows = await liveTitles(artifacts, ids);
      await db.update(artifacts).set({ deletedAt: new Date() }).where(inArray(artifacts.id, rows.map((r) => r.id)));
      return { count: rows.length, titles: rows.map((r) => r.title) };
    },
  }),
};

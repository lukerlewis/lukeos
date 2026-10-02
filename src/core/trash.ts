import "server-only";
import { and, eq, isNotNull, lt, sql, type AnyColumn } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex } from "@/lib/project-colors";
import { deleteOrphanComments } from "./artifacts";
import { deleteUnusedStoredFiles } from "@/lib/storage";
import { inspirationLabel } from "./inspiration";
import { deleteOrphanMentions } from "./mentions";
import { defineOperation, madeByOf, OperationError, type MadeBy } from "./define";

const { tasks, notes, artifacts, projects, sops, routines, archiveEntries, inspirationItems } = schema;

type Kind = "task" | "note" | "artifact" | "project" | "sop" | "routine" | "entry" | "inspiration";
type OwnKind = "sop" | "routine" | "entry" | "inspiration";
/** Things that stand alone, outside any project. */
const ownTable = (type: OwnKind) =>
  type === "sop" ? sops : type === "routine" ? routines : type === "inspiration" ? inspirationItems : archiveEntries;
const isOwn = (type: Kind): type is OwnKind => type === "sop" || type === "routine" || type === "entry" || type === "inspiration";
const tableOf = (type: "task" | "note" | "artifact") => (type === "task" ? tasks : type === "note" ? notes : artifacts);

/** How long things stay in Trash before they're deleted for good. */
export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;

/** One thing in Trash. */
export type TrashItem = {
  type: Kind;
  id: string;
  title: string;
  /** Tasks, notes and artifacts: the project they were in, if any. */
  project: { id: string; name: string; hex: string; inTrash: boolean } | null;
  /** Projects: how many tasks, notes and artifacts went to Trash with it (and come back with it). */
  contains: { tasks: number; notes: number; artifacts: number } | null;
  /** Notes only: "html" for a saved page. */
  format: string | null;
  madeBy: MadeBy;
  deletedAt: Date;
  /** When it will be deleted for good. */
  deletesOn: Date;
};

const itemType = z
  .enum(["task", "note", "artifact", "project", "sop", "routine", "entry", "inspiration"])
  .describe("task, note, artifact, project, sop, routine, entry (a Work archive entry) or inspiration (an Inspiration item).");

function deletesOn(deletedAt: Date) {
  return new Date(deletedAt.getTime() + TRASH_DAYS * DAY_MS);
}

let lastPurge = 0;

/**
 * Deletes for good everything that has been in Trash for over 30 days, and
 * any photos no note or task uses any more. The app calls this as it's used
 * (at most every few hours unless `force`), so no scheduled job is needed.
 */
export async function purgeExpiredTrash({ force = false } = {}) {
  if (!force && Date.now() - lastPurge < 6 * 60 * 60 * 1000) return;
  lastPurge = Date.now();
  const cutoff = new Date(Date.now() - TRASH_DAYS * DAY_MS);
  await db.transaction(async (tx) => {
    await tx.delete(tasks).where(lt(tasks.deletedAt, cutoff));
    await tx.delete(notes).where(lt(notes.deletedAt, cutoff));
    await tx.delete(artifacts).where(lt(artifacts.deletedAt, cutoff));
    await tx.delete(projects).where(lt(projects.deletedAt, cutoff));
    await tx.delete(sops).where(lt(sops.deletedAt, cutoff));
    await tx.delete(routines).where(lt(routines.deletedAt, cutoff));
    await tx.delete(archiveEntries).where(lt(archiveEntries.deletedAt, cutoff));
    await tx.delete(inspirationItems).where(lt(inspirationItems.deletedAt, cutoff));
  });
  await deleteOrphanComments();
  await deleteOrphanMentions();
  await deleteUnusedImages();
  await deleteUnusedStoredFiles();
}

/**
 * Photos that no note, artifact, task or Work archive entry mentions any more. Only ones over a day old,
 * so a photo being pasted into a note right now isn't touched.
 */
async function deleteUnusedImages() {
  await db.execute(sql`
    delete from images i
    where i.created_at < now() - interval '1 day'
      and not exists (select 1 from notes n where position(i.id::text in n.content) > 0)
      and not exists (select 1 from artifact_parts p where position(i.id::text in p.content) > 0)
      and not exists (select 1 from tasks t where position(i.id::text in coalesce(t.notes, '')) > 0)
      and not exists (select 1 from archive_entries e where position(i.id::text in e.story) > 0)`);
}

/**
 * What's in Trash, most recently deleted first. Tasks and notes that went to
 * Trash along with their project are counted on the project instead of
 * listed on their own, since restoring the project brings them back.
 */
export async function listTrash(filter: { type?: TrashItem["type"] } = {}) {
  await purgeExpiredTrash({ force: true });
  const want = (type: TrashItem["type"]) => !filter.type || filter.type === type;
  const parent = alias(projects, "parent");
  // Left out: things that went with their project (same deleted time).
  const onItsOwn = (deletedAt: AnyColumn) =>
    sql`(${parent.id} is null or ${parent.deletedAt} is null or ${parent.deletedAt} <> ${deletedAt})`;

  const [taskRows, noteRows, artifactRows, projectRows, sopRows, routineRows, entryRows, inspirationRows] = await Promise.all([
    want("task")
      ? db
          .select({ task: tasks, parent })
          .from(tasks)
          .leftJoin(parent, eq(parent.id, tasks.projectId))
          .where(and(isNotNull(tasks.deletedAt), onItsOwn(tasks.deletedAt)))
      : [],
    want("note")
      ? db
          .select({
            note: {
              id: notes.id,
              title: notes.title,
              format: notes.format,
              deletedAt: notes.deletedAt,
              createdByKind: notes.createdByKind,
              createdByName: notes.createdByName,
              createdByRoutine: notes.createdByRoutine,
            },
            parent,
          })
          .from(notes)
          .leftJoin(parent, eq(parent.id, notes.projectId))
          .where(and(isNotNull(notes.deletedAt), onItsOwn(notes.deletedAt)))
      : [],
    want("artifact")
      ? db
          .select({
            artifact: {
              id: artifacts.id,
              title: artifacts.title,
              deletedAt: artifacts.deletedAt,
              createdByKind: artifacts.createdByKind,
              createdByName: artifacts.createdByName,
              createdByRoutine: artifacts.createdByRoutine,
            },
            parent,
          })
          .from(artifacts)
          .leftJoin(parent, eq(parent.id, artifacts.projectId))
          .where(and(isNotNull(artifacts.deletedAt), onItsOwn(artifacts.deletedAt)))
      : [],
    want("project")
      ? db
          .select({
            project: projects,
            tasks: sql<number>`(select count(*) from tasks t where t.project_id = projects.id and t.deleted_at = projects.deleted_at)`.mapWith(
              Number,
            ),
            notes: sql<number>`(select count(*) from notes n where n.project_id = projects.id and n.deleted_at = projects.deleted_at)`.mapWith(
              Number,
            ),
            artifacts: sql<number>`(select count(*) from artifacts a where a.project_id = projects.id and a.deleted_at = projects.deleted_at)`.mapWith(
              Number,
            ),
          })
          .from(projects)
          .where(isNotNull(projects.deletedAt))
      : [],
    want("sop")
      ? db
          .select({
            id: sops.id,
            title: sops.title,
            deletedAt: sops.deletedAt,
            createdByKind: sops.createdByKind,
            createdByName: sops.createdByName,
            createdByRoutine: sops.createdByRoutine,
          })
          .from(sops)
          .where(isNotNull(sops.deletedAt))
      : [],
    want("routine")
      ? db
          .select({
            id: routines.id,
            title: routines.title,
            deletedAt: routines.deletedAt,
            createdByKind: routines.createdByKind,
            createdByName: routines.createdByName,
            createdByRoutine: routines.createdByRoutine,
          })
          .from(routines)
          .where(isNotNull(routines.deletedAt))
      : [],
    want("entry")
      ? db
          .select({
            id: archiveEntries.id,
            title: archiveEntries.title,
            deletedAt: archiveEntries.deletedAt,
            createdByKind: archiveEntries.createdByKind,
            createdByName: archiveEntries.createdByName,
            createdByRoutine: archiveEntries.createdByRoutine,
          })
          .from(archiveEntries)
          .where(isNotNull(archiveEntries.deletedAt))
      : [],
    want("inspiration")
      ? db
          .select({
            id: inspirationItems.id,
            title: inspirationItems.title,
            kind: inspirationItems.kind,
            body: inspirationItems.body,
            fileName: inspirationItems.fileName,
            deletedAt: inspirationItems.deletedAt,
            createdByKind: inspirationItems.createdByKind,
            createdByName: inspirationItems.createdByName,
            createdByRoutine: inspirationItems.createdByRoutine,
          })
          .from(inspirationItems)
          .where(isNotNull(inspirationItems.deletedAt))
      : [],
  ]);

  const parentOf = (p: typeof parent.$inferSelect | null) =>
    p ? { id: p.id, name: p.name, hex: colorHex(p.color), inTrash: p.deletedAt !== null } : null;

  const items: TrashItem[] = [
    ...taskRows.map(({ task, parent }) => ({
      type: "task" as const,
      id: task.id,
      title: task.title,
      project: parentOf(parent),
      contains: null,
      format: null,
      madeBy: madeByOf(task),
      deletedAt: task.deletedAt!,
      deletesOn: deletesOn(task.deletedAt!),
    })),
    ...noteRows.map(({ note, parent }) => ({
      type: "note" as const,
      id: note.id,
      title: note.title || "Untitled",
      project: parentOf(parent),
      contains: null,
      format: note.format,
      madeBy: madeByOf(note),
      deletedAt: note.deletedAt!,
      deletesOn: deletesOn(note.deletedAt!),
    })),
    ...artifactRows.map(({ artifact, parent }) => ({
      type: "artifact" as const,
      id: artifact.id,
      title: artifact.title || "Untitled",
      project: parentOf(parent),
      contains: null,
      format: null,
      madeBy: madeByOf(artifact),
      deletedAt: artifact.deletedAt!,
      deletesOn: deletesOn(artifact.deletedAt!),
    })),
    ...projectRows.map(({ project, tasks, notes, artifacts }) => ({
      type: "project" as const,
      id: project.id,
      title: project.name,
      project: null,
      contains: { tasks, notes, artifacts },
      format: null,
      madeBy: madeByOf(project),
      deletedAt: project.deletedAt!,
      deletesOn: deletesOn(project.deletedAt!),
    })),
    ...sopRows.map((sop) => ({
      type: "sop" as const,
      id: sop.id,
      title: sop.title || "Untitled",
      project: null,
      contains: null,
      format: null,
      madeBy: madeByOf(sop),
      deletedAt: sop.deletedAt!,
      deletesOn: deletesOn(sop.deletedAt!),
    })),
    ...routineRows.map((routine) => ({
      type: "routine" as const,
      id: routine.id,
      title: routine.title || "Untitled",
      project: null,
      contains: null,
      format: null,
      madeBy: madeByOf(routine),
      deletedAt: routine.deletedAt!,
      deletesOn: deletesOn(routine.deletedAt!),
    })),
    ...entryRows.map((entry) => ({
      type: "entry" as const,
      id: entry.id,
      title: entry.title || "Untitled",
      project: null,
      contains: null,
      format: null,
      madeBy: madeByOf(entry),
      deletedAt: entry.deletedAt!,
      deletesOn: deletesOn(entry.deletedAt!),
    })),
    ...inspirationRows.map((item) => ({
      type: "inspiration" as const,
      id: item.id,
      title: inspirationLabel(item),
      project: null,
      contains: null,
      format: null,
      madeBy: madeByOf(item),
      deletedAt: item.deletedAt!,
      deletesOn: deletesOn(item.deletedAt!),
    })),
  ];
  items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  return items;
}

async function trashedRow(type: TrashItem["type"], id: string) {
  const table = type === "project" ? projects : isOwn(type) ? ownTable(type) : tableOf(type);
  const [row] = await db
    .select({ deletedAt: table.deletedAt })
    .from(table)
    .where(and(eq(table.id, id), isNotNull(table.deletedAt)))
    .limit(1);
  if (!row) throw new OperationError(`That ${type} isn't in Trash.`, 404);
  return row.deletedAt!;
}

/** Brings something back from Trash. Returns where it went. */
export async function restoreFromTrash(type: TrashItem["type"], id: string) {
  const deletedAt = await trashedRow(type, id);
  const now = new Date();

  if (type === "project") {
    // The project, plus the tasks and notes that went to Trash with it.
    await db.transaction(async (tx) => {
      await tx.update(projects).set({ deletedAt: null, updatedAt: now }).where(eq(projects.id, id));
      await tx
        .update(tasks)
        .set({ deletedAt: null })
        .where(and(eq(tasks.projectId, id), eq(tasks.deletedAt, deletedAt)));
      await tx
        .update(notes)
        .set({ deletedAt: null })
        .where(and(eq(notes.projectId, id), eq(notes.deletedAt, deletedAt)));
      await tx
        .update(artifacts)
        .set({ deletedAt: null })
        .where(and(eq(artifacts.projectId, id), eq(artifacts.deletedAt, deletedAt)));
    });
    return { restored: { type, id }, movedOutOfProject: false };
  }
  if (isOwn(type)) {
    const table = ownTable(type);
    await db.update(table).set({ deletedAt: null }).where(eq(table.id, id));
    return { restored: { type, id }, movedOutOfProject: false };
  }

  // A task, note or artifact whose project is still in Trash comes back on
  // its own, outside the project, so it doesn't stay hidden.
  const table = tableOf(type);
  const [row] = await db
    .select({ projectId: table.projectId, projectDeletedAt: projects.deletedAt })
    .from(table)
    .leftJoin(projects, eq(projects.id, table.projectId))
    .where(eq(table.id, id));
  const moveOut = row.projectId !== null && row.projectDeletedAt !== null;
  await db
    .update(table)
    .set({ deletedAt: null, ...(moveOut && { projectId: null }) })
    .where(eq(table.id, id));
  return { restored: { type, id }, movedOutOfProject: moveOut };
}

/** Deletes something in Trash for good. A project takes the tasks and notes that went with it. */
export async function deleteForever(type: TrashItem["type"], id: string) {
  const deletedAt = await trashedRow(type, id);
  if (type === "project") {
    await db.transaction(async (tx) => {
      await tx.delete(tasks).where(and(eq(tasks.projectId, id), eq(tasks.deletedAt, deletedAt)));
      await tx.delete(notes).where(and(eq(notes.projectId, id), eq(notes.deletedAt, deletedAt)));
      await tx.delete(artifacts).where(and(eq(artifacts.projectId, id), eq(artifacts.deletedAt, deletedAt)));
      await tx.delete(projects).where(eq(projects.id, id));
    });
  } else if (isOwn(type)) {
    const table = ownTable(type);
    await db.delete(table).where(eq(table.id, id));
  } else {
    const table = tableOf(type);
    await db.delete(table).where(eq(table.id, id));
  }
  await deleteOrphanComments();
  await deleteOrphanMentions();
  return { deletedForever: { type, id } };
}

export async function emptyTrash() {
  const counts = await db.transaction(async (tx) => {
    const t = await tx.delete(tasks).where(isNotNull(tasks.deletedAt)).returning({ id: tasks.id });
    const n = await tx.delete(notes).where(isNotNull(notes.deletedAt)).returning({ id: notes.id });
    const a = await tx.delete(artifacts).where(isNotNull(artifacts.deletedAt)).returning({ id: artifacts.id });
    const p = await tx.delete(projects).where(isNotNull(projects.deletedAt)).returning({ id: projects.id });
    const s = await tx.delete(sops).where(isNotNull(sops.deletedAt)).returning({ id: sops.id });
    const r = await tx.delete(routines).where(isNotNull(routines.deletedAt)).returning({ id: routines.id });
    const e = await tx.delete(archiveEntries).where(isNotNull(archiveEntries.deletedAt)).returning({ id: archiveEntries.id });
    const i = await tx.delete(inspirationItems).where(isNotNull(inspirationItems.deletedAt)).returning({ id: inspirationItems.id });
    return {
      tasks: t.length,
      notes: n.length,
      artifacts: a.length,
      projects: p.length,
      sops: s.length,
      routines: r.length,
      entries: e.length,
      inspiration: i.length,
    };
  });
  await deleteOrphanComments();
  await deleteOrphanMentions();
  return { deletedForever: counts };
}

export async function trashCount() {
  const [row] = await db.execute<{ n: number }>(sql`
    select (select count(*) from tasks where deleted_at is not null)
         + (select count(*) from notes where deleted_at is not null)
         + (select count(*) from artifacts where deleted_at is not null)
         + (select count(*) from projects where deleted_at is not null)
         + (select count(*) from sops where deleted_at is not null)
         + (select count(*) from routines where deleted_at is not null)
         + (select count(*) from archive_entries where deleted_at is not null)
         + (select count(*) from inspiration_items where deleted_at is not null) as n`).then((r) => r.rows);
  return Number(row.n);
}

const id = z.uuid().describe("The item's id, from list_trash.");

export const trashOperations = {
  list_trash: defineOperation({
    name: "list_trash",
    description: `What's in Trash, most recently deleted first. Things stay in Trash for ${TRASH_DAYS} days, then are deleted for good (deletesOn says when). A project's tasks, notes and artifacts that went to Trash with it are counted on the project, not listed separately.`,
    input: z.object({ type: itemType.optional().describe("Only this kind of thing.") }),
    run: async ({ type }) => listTrash({ type }),
  }),

  restore_from_trash: defineOperation({
    name: "restore_from_trash",
    description:
      "Bring a task, note, artifact, project, SOP, routine, Work archive entry or Inspiration item back from Trash. Restoring a project also brings back the tasks, notes and artifacts that went to Trash with it. A task, note or artifact whose project is still in Trash comes back on its own, outside the project.",
    input: z.object({ type: itemType, id }),
    run: async ({ type, id }) => restoreFromTrash(type, id),
  }),

  delete_forever: defineOperation({
    name: "delete_forever",
    description:
      "Permanently delete something that's already in Trash. This can't be undone, so only do it when Luke asks. A project takes the tasks, notes and artifacts that went to Trash with it.",
    input: z.object({ type: itemType, id }),
    run: async ({ type, id }) => deleteForever(type, id),
  }),

  empty_trash: defineOperation({
    name: "empty_trash",
    description: "Permanently delete everything in Trash. This can't be undone, so only do it when Luke asks.",
    input: z.object({}),
    run: async () => emptyTrash(),
  }),
};

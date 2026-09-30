import "server-only";
import { and, desc, eq, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex } from "@/lib/project-colors";
import { defineOperation } from "./define";
import { excerptOf } from "./notes";

const { tasks, notes, projects, appSettings } = schema;

const SEEN_KEY = "from_claude_seen_at";

/** One thing Claude made, as the Agents section lists it. */
export type ClaudeItem = {
  type: "note" | "task" | "project";
  id: string;
  title: string;
  /** Notes: the start of the text. Tasks: nothing. */
  excerpt: string | null;
  /** Notes only: "html" for a saved page. */
  format: string | null;
  project: { id: string; name: string; hex: string } | null;
  name: string;
  routine: string | null;
  createdAt: Date;
  isNew: boolean;
};

async function seenAt() {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SEEN_KEY)).limit(1);
  return row ? new Date(row.value) : new Date(0);
}

/**
 * Everything Claude made that isn't in Trash, newest first. "New" means made
 * since Luke last looked at the Agents section.
 */
export async function listFromClaude(filter: { routine?: string; type?: ClaudeItem["type"]; limit?: number } = {}) {
  const limit = filter.limit ?? 100;
  const seen = await seenAt();
  const byRoutine = (col: AnyColumn): SQL | undefined =>
    filter.routine ? eq(col, filter.routine) : undefined;
  const want = (type: ClaudeItem["type"]) => !filter.type || filter.type === type;

  const [noteRows, taskRows, projectRows] = await Promise.all([
    want("note")
      ? db
          .select({
            row: {
              id: notes.id,
              title: notes.title,
              format: notes.format,
              start: sql<string>`left(${notes.content}, 2000)`,
              name: notes.createdByName,
              routine: notes.createdByRoutine,
              createdAt: notes.createdAt,
            },
            project: projects,
          })
          .from(notes)
          .leftJoin(projects, eq(projects.id, notes.projectId))
          .where(
            and(
              eq(notes.createdByKind, "agent"),
              isNull(notes.deletedAt),
              sql`(${projects.id} is null or ${projects.deletedAt} is null)`,
              byRoutine(notes.createdByRoutine),
            ),
          )
          .orderBy(desc(notes.createdAt))
          .limit(limit)
      : [],
    want("task")
      ? db
          .select({
            row: {
              id: tasks.id,
              title: tasks.title,
              name: tasks.createdByName,
              routine: tasks.createdByRoutine,
              createdAt: tasks.createdAt,
            },
            project: projects,
          })
          .from(tasks)
          .leftJoin(projects, eq(projects.id, tasks.projectId))
          .where(
            and(
              eq(tasks.createdByKind, "agent"),
              isNull(tasks.deletedAt),
              sql`(${projects.id} is null or ${projects.deletedAt} is null)`,
              byRoutine(tasks.createdByRoutine),
            ),
          )
          .orderBy(desc(tasks.createdAt))
          .limit(limit)
      : [],
    want("project")
      ? db
          .select()
          .from(projects)
          .where(and(eq(projects.createdByKind, "agent"), isNull(projects.deletedAt), byRoutine(projects.createdByRoutine)))
          .orderBy(desc(projects.createdAt))
          .limit(limit)
      : [],
  ]);

  const projectOf = (p: typeof projects.$inferSelect | null) => (p ? { id: p.id, name: p.name, hex: colorHex(p.color) } : null);
  const items: ClaudeItem[] = [
    ...noteRows.map(({ row, project }) => ({
      type: "note" as const,
      id: row.id,
      title: row.title,
      excerpt: excerptOf(row.start, row.format),
      format: row.format,
      project: projectOf(project),
      name: row.name ?? "Claude",
      routine: row.routine,
      createdAt: row.createdAt,
      isNew: row.createdAt > seen,
    })),
    ...taskRows.map(({ row, project }) => ({
      type: "task" as const,
      id: row.id,
      title: row.title,
      excerpt: null,
      format: null,
      project: projectOf(project),
      name: row.name ?? "Claude",
      routine: row.routine,
      createdAt: row.createdAt,
      isNew: row.createdAt > seen,
    })),
    ...projectRows.map((p) => ({
      type: "project" as const,
      id: p.id,
      title: p.name,
      excerpt: null,
      format: null,
      project: null,
      name: p.createdByName ?? "Claude",
      routine: p.createdByRoutine,
      createdAt: p.createdAt,
      isNew: p.createdAt > seen,
    })),
  ];
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items.slice(0, limit);
}

/** How many things Claude made since Luke last looked, for the sidebar. */
export async function newFromClaudeCount() {
  const seen = await seenAt();
  const count = (table: typeof notes | typeof tasks | typeof projects) =>
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(table)
      .where(and(eq(table.createdByKind, "agent"), isNull(table.deletedAt), sql`${table.createdAt} > ${seen}`))
      .then(([r]) => r.n);
  const counts = await Promise.all([count(notes), count(tasks), count(projects)]);
  return counts.reduce((a, b) => a + b, 0);
}

/** The routine names that have made something, for the filter. */
export async function claudeRoutines() {
  const rows = await db.execute<{ routine: string }>(sql`
    select distinct created_by_routine as routine from (
      select created_by_routine from notes where created_by_kind = 'agent' and deleted_at is null
      union select created_by_routine from tasks where created_by_kind = 'agent' and deleted_at is null
      union select created_by_routine from projects where created_by_kind = 'agent' and deleted_at is null
    ) r where created_by_routine is not null order by 1`);
  return rows.rows.map((r) => r.routine);
}

export const fromClaudeOperations = {
  list_from_claude: defineOperation({
    name: "list_from_claude",
    description:
      "What Claude has made in LukeOS (notes, tasks and projects), newest first, as Luke sees it in his Agents section. isNew marks things made since he last looked. Filter by routine or type.",
    input: z.object({
      routine: z.string().optional().describe("Only things this routine made."),
      type: z.enum(["note", "task", "project"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => listFromClaude(filter),
  }),

  mark_from_claude_seen: defineOperation({
    name: "mark_from_claude_seen",
    description: "Clear the New markers in Luke's Agents section, as if he'd looked at it.",
    input: z.object({}),
    run: async () => {
      const now = new Date().toISOString();
      await db
        .insert(appSettings)
        .values({ key: SEEN_KEY, value: now })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: now } });
      return { seenAt: now };
    },
  }),
};

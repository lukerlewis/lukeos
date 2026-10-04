import "server-only";
import { and, desc, eq, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex } from "@/lib/project-colors";
import { ARTIFACTS_ON } from "@/lib/features";
import { defineOperation } from "./define";
import { excerptOf } from "./notes";

const { tasks, artifacts, documents, projects, appSettings } = schema;

// Facts about an artifact's latest version.
const latest = sql`(select v.id from artifact_versions v where v.artifact_id = ${artifacts.id} and v.number = ${artifacts.version})`;
const firstPart = (column: "content" | "format") =>
  sql<string | null>`(select ${sql.raw(column === "content" ? "left(p.content, 2000)" : "p.format")} from artifact_parts p where p.version_id = ${latest} order by p.position limit 1)`;
const changedAt = sql<Date | null>`(select v.created_at from artifact_versions v where v.id = ${latest})`.mapWith(artifacts.createdAt);
const openComments = sql<number>`(select count(*) from comments c where c.target_type = 'artifact' and c.target_id = ${artifacts.id} and c.parent_id is null and c.resolved_at is null)`.mapWith(
  Number,
);

const SEEN_KEY = "from_claude_seen_at";

/** One thing Claude made, as the Agents section lists it. */
export type ClaudeItem = {
  type: "document" | "artifact" | "task" | "project";
  id: string;
  title: string;
  /** Documents and artifacts: the start of the text. Tasks: nothing. */
  excerpt: string | null;
  /** Artifacts only: "html" for a web page. */
  format: string | null;
  project: { id: string; name: string; hex: string } | null;
  name: string;
  routine: string | null;
  /** For artifacts, when the latest version was made. */
  createdAt: Date;
  isNew: boolean;
  /** Artifacts only: the latest version's number. */
  version: number | null;
  /** Artifacts only: comments not yet resolved. */
  openComments: number;
};

export async function seenAt() {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SEEN_KEY)).limit(1);
  return row ? new Date(row.value) : new Date(0);
}

/**
 * Everything Claude made that isn't in Trash, newest first. "New" means made
 * (or, for an artifact, given a new version) since Luke last looked at the Agents section.
 */
export async function listFromClaude(filter: { routine?: string; type?: ClaudeItem["type"]; limit?: number } = {}) {
  const limit = filter.limit ?? 100;
  const seen = await seenAt();
  const byRoutine = (col: AnyColumn): SQL | undefined =>
    filter.routine ? eq(col, filter.routine) : undefined;
  const want = (type: ClaudeItem["type"]) => !filter.type || filter.type === type;

  const [documentRows, artifactRows, taskRows, projectRows] = await Promise.all([
    want("document")
      ? db
          .select({
            row: {
              id: documents.id,
              title: documents.title,
              start: sql<string>`left(${documents.content}, 2000)`,
              name: documents.createdByName,
              routine: documents.createdByRoutine,
              createdAt: documents.createdAt,
              claudeChangedAt: documents.claudeChangedAt,
            },
            openComments: sql<number>`(select count(*) from comments c where c.target_type = 'document' and c.target_id = ${documents.id} and c.parent_id is null and c.resolved_at is null)`.mapWith(
              Number,
            ),
            project: projects,
          })
          .from(documents)
          .leftJoin(projects, eq(projects.id, documents.projectId))
          .where(
            and(
              eq(documents.createdByKind, "agent"),
              isNull(documents.deletedAt),
              sql`(${projects.id} is null or ${projects.deletedAt} is null)`,
              byRoutine(documents.createdByRoutine),
            ),
          )
          .orderBy(desc(documents.createdAt))
          .limit(limit)
      : [],
    want("artifact") && ARTIFACTS_ON
      ? db
          .select({
            row: {
              id: artifacts.id,
              title: artifacts.title,
              version: artifacts.version,
              name: artifacts.createdByName,
              routine: artifacts.createdByRoutine,
              createdAt: artifacts.createdAt,
            },
            start: firstPart("content"),
            format: firstPart("format"),
            changedAt: changedAt,
            openComments: openComments,
            project: projects,
          })
          .from(artifacts)
          .leftJoin(projects, eq(projects.id, artifacts.projectId))
          .where(
            and(
              eq(artifacts.createdByKind, "agent"),
              isNull(artifacts.deletedAt),
              sql`(${projects.id} is null or ${projects.deletedAt} is null)`,
              byRoutine(artifacts.createdByRoutine),
            ),
          )
          .orderBy(desc(changedAt))
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
    ...documentRows.map(({ row, project, openComments }) => ({
      type: "document" as const,
      id: row.id,
      title: row.title,
      excerpt: excerptOf(row.start, "markdown"),
      format: "markdown",
      project: projectOf(project),
      name: row.name ?? "Claude",
      routine: row.routine,
      createdAt: row.claudeChangedAt ?? row.createdAt,
      isNew: (row.claudeChangedAt ?? row.createdAt) > seen,
      version: null,
      openComments,
    })),
    ...artifactRows.map(({ row, project, start, format, changedAt, openComments }) => ({
      type: "artifact" as const,
      id: row.id,
      title: row.title,
      excerpt: excerptOf(start ?? "", format ?? "markdown"),
      format: format ?? "markdown",
      project: projectOf(project),
      name: row.name ?? "Claude",
      routine: row.routine,
      createdAt: changedAt ?? row.createdAt,
      isNew: (changedAt ?? row.createdAt) > seen,
      version: row.version,
      openComments,
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
      version: null,
      openComments: 0,
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
      version: null,
      openComments: 0,
    })),
  ];
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items.slice(0, limit);
}

/** How many documents (and, while they're on, artifacts) Claude made or changed since Luke last looked, for the sidebar. */
export async function newFromClaudeCount() {
  const seen = await seenAt();
  const rows = await db.execute<{ n: number }>(sql`
    select (select count(*) from documents d where d.deleted_at is null and d.claude_changed_at > ${seen})
      + ${ARTIFACTS_ON ? sql`(select count(*) from artifacts a join artifact_versions v on v.artifact_id = a.id and v.number = a.version
         where a.created_by_kind = 'agent' and a.deleted_at is null and v.created_at > ${seen})` : sql`0`} as n`);
  return Number(rows.rows[0].n);
}

/** The routine names that have made an artifact, for the filter. */
export async function claudeRoutines() {
  const rows = await db.execute<{ routine: string }>(sql`
    select distinct created_by_routine as routine from artifacts
    where created_by_kind = 'agent' and deleted_at is null and created_by_routine is not null order by 1`);
  return rows.rows.map((r) => r.routine);
}

export const fromClaudeOperations = {
  list_from_claude: defineOperation({
    name: "list_from_claude",
    description:
      "What Claude has made in LukeOS (documents, tasks and projects), newest first. Luke sees Claude's documents under Made by Claude in his Documents. isNew marks things made (or documents changed by Claude) since he last looked. Filter by routine or type.",
    input: z.object({
      routine: z.string().optional().describe("Only things this routine made."),
      type: z.enum(ARTIFACTS_ON ? ["document", "artifact", "task", "project"] : ["document", "task", "project"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => listFromClaude(filter),
  }),

  mark_from_claude_seen: defineOperation({
    name: "mark_from_claude_seen",
    description: "Clear the New markers on Claude's documents, as if Luke had looked at his Documents.",
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

import "server-only";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex } from "@/lib/project-colors";
import type { Status } from "@/lib/task-fields";
import { defineOperation, madeByOf, type MadeBy } from "./define";
import { excerptOf, plainTextOf } from "./notes";

const { tasks, notes, artifacts, projects, archiveEntries } = schema;

/** One thing that matched a search. */
export type SearchResult = {
  type: "task" | "note" | "artifact" | "project" | "entry";
  id: string;
  title: string;
  /** A bit of the text around the first match, when it matched below the title. */
  snippet: string | null;
  /** Tasks only. */
  status: Status | null;
  dueDate: string | null;
  /** Notes and artifacts: "html" for a web page. */
  format: string | null;
  project: { id: string; name: string; hex: string } | null;
  madeBy: MadeBy;
  updatedAt: Date;
};

/** The words to look for: up to 6, each at least one character. */
function wordsOf(query: string) {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

const likeOf = (word: string) => `%${word.replace(/[\\%_]/g, "\\$&")}%`;

/** Every word must appear somewhere in one of the columns. */
function matchesAll(words: string[], ...columns: SQL[]) {
  return and(...words.map((w) => or(...columns.map((c) => ilike(c, likeOf(w))))));
}

/** The text around the first word found, e.g. "...pick up the paint from...". */
export function snippetAround(text: string, words: string[], width = 120) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  const at = words.map((w) => lower.indexOf(w.toLowerCase())).filter((i) => i >= 0);
  if (at.length === 0) return null;
  const hit = Math.min(...at);
  const start = Math.max(0, hit - Math.floor(width / 3));
  const end = Math.min(clean.length, start + width);
  return `${start > 0 ? "..." : ""}${clean.slice(start, end).trim()}${end < clean.length ? "..." : ""}`;
}

function titleHasAll(title: string, words: string[]) {
  const t = title.toLowerCase();
  return words.every((w) => t.includes(w.toLowerCase()));
}

const liveProject = sql`(${projects.id} is null or ${projects.deletedAt} is null)`;
const projectOf = (p: typeof projects.$inferSelect | null) => (p ? { id: p.id, name: p.name, hex: colorHex(p.color) } : null);

/**
 * Looks through task titles and notes, note titles and text, and project
 * names. Things whose title has every word come first, then the most
 * recently changed.
 */
export async function search(query: string, filter: { type?: SearchResult["type"]; limit?: number } = {}) {
  const words = wordsOf(query);
  if (words.length === 0) return [];
  const limit = filter.limit ?? 30;
  const want = (type: SearchResult["type"]) => !filter.type || filter.type === type;

  // An artifact's words: every part of its latest version, web pages without their code.
  const artifactText = sql<string>`coalesce((select string_agg(case when p.format = 'html' then regexp_replace(p.content, '<[^>]*>', ' ', 'g') else p.content end, ' ' order by p.position)
    from artifact_parts p join artifact_versions v on v.id = p.version_id
    where v.artifact_id = ${artifacts.id} and v.number = ${artifacts.version}), '')`;

  const entryText = sql<string>`concat_ws(' ', ${archiveEntries.story}, ${archiveEntries.company}, ${archiveEntries.role}, ${archiveEntries.outcome})`;

  const [taskRows, noteRows, artifactRows, projectRows, entryRows] = await Promise.all([
    want("task")
      ? db
          .select({ task: tasks, project: projects })
          .from(tasks)
          .leftJoin(projects, eq(projects.id, tasks.projectId))
          .where(
            and(isNull(tasks.deletedAt), liveProject, matchesAll(words, sql`${tasks.title}`, sql`coalesce(${tasks.notes}, '')`)),
          )
          .orderBy(desc(tasks.updatedAt))
          .limit(limit)
      : [],
    want("note")
      ? db
          .select({ note: notes, project: projects })
          .from(notes)
          .leftJoin(projects, eq(projects.id, notes.projectId))
          .where(and(isNull(notes.deletedAt), eq(notes.kind, "note"), liveProject, matchesAll(
                words,
                sql`${notes.title}`,
                // A saved web page is searched by its words, not its code.
                sql`case when ${notes.format} = 'html' then regexp_replace(${notes.content}, '<[^>]*>', ' ', 'g') else ${notes.content} end`,
              )))
          .orderBy(desc(notes.updatedAt))
          .limit(limit)
      : [],
    want("artifact")
      ? db
          .select({ artifact: artifacts, project: projects, text: artifactText })
          .from(artifacts)
          .leftJoin(projects, eq(projects.id, artifacts.projectId))
          .where(and(isNull(artifacts.deletedAt), liveProject, matchesAll(words, sql`${artifacts.title}`, artifactText)))
          .orderBy(desc(artifacts.updatedAt))
          .limit(limit)
      : [],
    want("project")
      ? db
          .select()
          .from(projects)
          .where(and(isNull(projects.deletedAt), matchesAll(words, sql`${projects.name}`)))
          .orderBy(desc(projects.updatedAt))
          .limit(limit)
      : [],
    want("entry")
      ? db
          .select({ entry: archiveEntries, text: entryText })
          .from(archiveEntries)
          .where(and(isNull(archiveEntries.deletedAt), matchesAll(words, sql`${archiveEntries.title}`, entryText)))
          .orderBy(desc(archiveEntries.updatedAt))
          .limit(limit)
      : [],
  ]);

  const results: SearchResult[] = [
    ...projectRows.map((p) => ({
      type: "project" as const,
      id: p.id,
      title: p.name,
      snippet: null,
      status: null,
      dueDate: null,
      format: null,
      project: null,
      madeBy: madeByOf(p),
      updatedAt: p.updatedAt,
    })),
    ...taskRows.map(({ task, project }) => ({
      type: "task" as const,
      id: task.id,
      title: task.title,
      snippet: titleHasAll(task.title, words) ? null : snippetAround(task.notes ?? "", words),
      status: task.status as Status,
      dueDate: task.dueDate,
      format: null,
      project: projectOf(project),
      madeBy: madeByOf(task),
      updatedAt: task.updatedAt,
    })),
    ...noteRows.map(({ note, project }) => {
      const title = note.title || "Untitled";
      return {
        type: "note" as const,
        id: note.id,
        title,
        snippet: titleHasAll(title, words)
          ? excerptOf(note.content, note.format) || null
          : snippetAround(plainTextOf(note.content, note.format), words),
        status: null,
        dueDate: null,
        format: note.format,
        project: projectOf(project),
        madeBy: madeByOf(note),
        updatedAt: note.updatedAt,
      };
    }),
    ...artifactRows.map(({ artifact, project, text }) => {
      const title = artifact.title || "Untitled";
      return {
        type: "artifact" as const,
        id: artifact.id,
        title,
        snippet: titleHasAll(title, words) ? excerptOf(text, "markdown") || null : snippetAround(plainTextOf(text, "markdown"), words),
        status: null,
        dueDate: null,
        format: null,
        project: projectOf(project),
        madeBy: madeByOf(artifact),
        updatedAt: artifact.updatedAt,
      };
    }),
    ...entryRows.map(({ entry, text }) => {
      const title = entry.title || "Untitled";
      return {
        type: "entry" as const,
        id: entry.id,
        title,
        snippet: titleHasAll(title, words) ? excerptOf(entry.story, "markdown") || null : snippetAround(plainTextOf(text, "markdown"), words),
        status: null,
        dueDate: null,
        format: null,
        project: null,
        madeBy: madeByOf(entry),
        updatedAt: entry.updatedAt,
      };
    }),
  ];

  results.sort((a, b) => {
    const at = titleHasAll(a.title, words) ? 0 : 1;
    const bt = titleHasAll(b.title, words) ? 0 : 1;
    return at - bt || b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  return results.slice(0, limit);
}

export const searchOperations = {
  search: defineOperation({
    name: "search",
    description:
      "Search everything in LukeOS (not Trash): task titles and task notes, note titles and text, artifact titles and text (latest version), Work archive entries (title, story and details), and project names. Every word must match. Results whose title matches come first, then the most recently changed. Done tasks are included.",
    input: z.object({
      query: z.string().min(1).max(200).describe("The words to look for."),
      type: z.enum(["task", "note", "artifact", "project", "entry"]).optional().describe("Only this kind of thing."),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: async ({ query, type, limit }) => search(query, { type, limit }),
  }),
};

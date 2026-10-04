import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { colorHex, type ProjectColor } from "@/lib/project-colors";
import { defineOperation, madeByColumns, madeByOf, OperationError, type Actor, type MadeBy } from "./define";
import { noteFormats, type NoteFormat } from "@/lib/note-formats";
import { excerptOf, getImage, getNote, type Note } from "./notes";
import { assertProject } from "./projects";

const { artifacts, artifactVersions, artifactParts, comments, notes, projects } = schema;

export type ArtifactPart = { id: string; name: string; format: NoteFormat; content: string };

export type ArtifactVersion = { number: number; note: string | null; madeBy: MadeBy; createdAt: Date };

export type ArtifactSummary = {
  id: string;
  title: string;
  /** The latest version's number. */
  version: number;
  /** The first line or two of the first part, for lists. */
  excerpt: string;
  /** The first part's format: "html" for a web page. */
  format: NoteFormat;
  parts: number;
  project: { id: string; name: string; color: ProjectColor; hex: string } | null;
  madeBy: MadeBy;
  createdAt: Date;
  /** When the latest version was made. */
  changedAt: Date;
  updatedAt: Date;
  /** Comments not yet resolved (not counting replies). */
  openComments: number;
};

export type Artifact = ArtifactSummary & {
  /** The version shown: the latest unless an older one was asked for. */
  shown: ArtifactVersion;
  content: ArtifactPart[];
  /** Every version, newest first. */
  versions: ArtifactVersion[];
};

type ProjectRow = typeof projects.$inferSelect;

const projectOf = (p: ProjectRow | null) =>
  p ? { id: p.id, name: p.name, color: p.color as ProjectColor, hex: colorHex(p.color) } : null;

const live = and(isNull(artifacts.deletedAt), sql`(${projects.id} is null or ${projects.deletedAt} is null)`);

// Facts about the latest version, read alongside each artifact.
const latest = sql`(select v.id from artifact_versions v where v.artifact_id = ${artifacts.id} and v.number = ${artifacts.version})`;
const firstPart = (column: "content" | "format") =>
  sql<string>`(select ${sql.raw(column === "content" ? "left(p.content, 2000)" : "p.format")} from artifact_parts p where p.version_id = ${latest} order by p.position limit 1)`;
const summaryColumns = {
  start: firstPart("content"),
  format: firstPart("format"),
  parts: sql<number>`(select count(*) from artifact_parts p where p.version_id = ${latest})`.mapWith(Number),
  changedAt: sql<Date>`(select v.created_at from artifact_versions v where v.id = ${latest})`.mapWith(artifacts.createdAt),
  openComments: sql<number>`(select count(*) from comments c where c.target_type = 'artifact' and c.target_id = ${artifacts.id} and c.parent_id is null and c.resolved_at is null)`.mapWith(
    Number,
  ),
};

function toSummary(
  a: typeof artifacts.$inferSelect,
  extra: { start: string | null; format: string | null; parts: number; changedAt: Date | null; openComments: number },
  project: ProjectRow | null,
): ArtifactSummary {
  const format = (extra.format ?? "markdown") as NoteFormat;
  return {
    id: a.id,
    title: a.title,
    version: a.version,
    excerpt: excerptOf(extra.start ?? "", format),
    format,
    parts: extra.parts,
    project: projectOf(project),
    madeBy: madeByOf(a),
    createdAt: a.createdAt,
    changedAt: extra.changedAt ?? a.createdAt,
    updatedAt: a.updatedAt,
    openComments: extra.openComments,
  };
}

export async function listArtifacts(
  filter: { projectId?: string | null; routine?: string; search?: string; limit?: number } = {},
): Promise<ArtifactSummary[]> {
  const where: (SQL | undefined)[] = [live];
  if (filter.projectId === null) where.push(isNull(artifacts.projectId));
  else if (filter.projectId) where.push(eq(artifacts.projectId, filter.projectId));
  if (filter.routine) where.push(eq(artifacts.createdByRoutine, filter.routine));
  if (filter.search?.trim()) {
    const q = `%${filter.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    where.push(
      or(
        ilike(artifacts.title, q),
        sql`exists (select 1 from artifact_parts p where p.version_id = ${latest} and p.content ilike ${q})`,
      ),
    );
  }
  const rows = await db
    .select({ artifact: artifacts, project: projects, ...summaryColumns })
    .from(artifacts)
    .leftJoin(projects, eq(projects.id, artifacts.projectId))
    .where(and(...where))
    .orderBy(desc(summaryColumns.changedAt))
    .limit(filter.limit ?? 100);
  return rows.map(({ artifact, project, ...extra }) => toSummary(artifact, extra, project));
}

const versionOf = (v: typeof artifactVersions.$inferSelect): ArtifactVersion => ({
  number: v.number,
  note: v.note,
  madeBy: madeByOf(v),
  createdAt: v.createdAt,
});

export async function getArtifact(id: string, version?: number): Promise<Artifact> {
  const [row] = await db
    .select({ artifact: artifacts, project: projects, ...summaryColumns })
    .from(artifacts)
    .leftJoin(projects, eq(projects.id, artifacts.projectId))
    .where(and(eq(artifacts.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That artifact doesn't exist, or it's in Trash.", 404);
  const { artifact, project, ...extra } = row;

  const versions = await db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, id))
    .orderBy(desc(artifactVersions.number));
  const shown = versions.find((v) => v.number === (version ?? artifact.version));
  if (!shown) throw new OperationError(`That artifact has no version ${version}. It's on version ${artifact.version}.`, 404);
  const parts = await db
    .select()
    .from(artifactParts)
    .where(eq(artifactParts.versionId, shown.id))
    .orderBy(asc(artifactParts.position));

  return {
    ...toSummary(artifact, extra, project),
    shown: versionOf(shown),
    content: parts.map((p) => ({ id: p.id, name: p.name, format: p.format as NoteFormat, content: p.content })),
    versions: versions.map(versionOf),
  };
}

export async function assertArtifact(id: string) {
  const [row] = await db
    .select({ id: artifacts.id, title: artifacts.title, version: artifacts.version })
    .from(artifacts)
    .where(and(eq(artifacts.id, id), isNull(artifacts.deletedAt)))
    .limit(1);
  if (!row) throw new OperationError("That artifact doesn't exist, or it's in Trash.", 404);
  return row;
}

type PartInput = { name?: string; format?: NoteFormat; content: string };

/** Saves a version and its parts. Run inside the transaction that sets the artifact's version number. */
async function addVersion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  artifactId: string,
  number: number,
  parts: PartInput[],
  note: string | undefined,
  actor: Actor,
) {
  const { createdByKind, createdByName, createdByRoutine } = madeByColumns(actor);
  const [version] = await tx
    .insert(artifactVersions)
    .values({ artifactId, number, note: note?.trim() || null, createdByKind, createdByName, createdByRoutine })
    .returning({ id: artifactVersions.id });
  await tx.insert(artifactParts).values(
    parts.map((p, position) => ({
      versionId: version.id,
      position,
      name: p.name?.trim() ?? "",
      format: p.format ?? "markdown",
      content: p.content,
    })),
  );
}

/** Either `parts`, or `content` (and `format`) as a single part. */
function partsFrom(input: { parts?: PartInput[]; content?: string; format?: NoteFormat }) {
  if (input.parts?.length) return input.parts;
  if (input.content !== undefined) return [{ content: input.content, format: input.format }];
  return null;
}

/**
 * Photos in a web page point at /api/images/..., which a sandboxed page can't
 * load (it isn't signed in). They're put in the page itself instead.
 */
export async function inlineImages(html: string) {
  const ids = [...new Set(html.match(/\/api\/images\/[0-9a-f-]{36}/gi) ?? [])];
  let out = html;
  for (const path of ids) {
    const image = await getImage(path.slice("/api/images/".length));
    if (image) out = out.replaceAll(path, `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`);
  }
  return out;
}

const id = z.uuid().describe("The artifact's id.");
const title = z.string().trim().max(500).describe("The artifact's title.");
const content = z
  .string()
  .max(1_000_000)
  .describe(
    'The body. Markdown: headings (#), lists, tables, links, and photos as ![](url) using a url from save_image. HTML: a complete web page; photos from save_image work as <img src="url">.',
  );
const format = z.enum(noteFormats).describe('"markdown" (the default) or "html" for a web page.');
const parts = z
  .array(
    z.object({
      name: z.string().trim().max(100).optional().describe('A short tab name, e.g. "Report" or "Data". Needed when there are several parts.'),
      format: format.optional(),
      content,
    }),
  )
  .min(1)
  .max(20)
  .describe("The artifact's parts, in order. Each shows as a tab. Use this or content, not both.");
const projectId = z.uuid().nullable().describe("The project it belongs to. null means it stands on its own.");
const versionNote = z
  .string()
  .max(500)
  .describe('A line saying what this version changed, e.g. "Charts are weekly now, as asked in the comments".');

export const artifactOperations = {
  list_artifacts: defineOperation({
    name: "list_artifacts",
    description:
      "List artifacts (reports, pages and other things agents made for Luke), most recently changed first, with a short excerpt of each and how many unresolved comments it has. Filter by project or routine, or search the title and text.",
    input: z.object({
      projectId: z.uuid().nullable().optional().describe("Only this project's artifacts. null means ones with no project."),
      routine: z.string().optional().describe("Only artifacts made by this routine."),
      search: z.string().optional().describe("Words to look for in the title or text."),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (filter) => listArtifacts(filter),
  }),

  get_artifact: defineOperation({
    name: "get_artifact",
    description:
      "Get an artifact: every part of its latest version (or an older one), and its version history. Use list_comments to see what Luke said about it.",
    input: z.object({
      id,
      version: z.number().int().min(1).optional().describe("An older version's number. Leave out for the latest."),
    }),
    run: async ({ id, version }) => getArtifact(id, version),
  }),

  create_artifact: defineOperation({
    name: "create_artifact",
    description:
      'Save something you made for Luke as an artifact: a report, a web page, research, a plan, anything he\'ll read rather than edit. Use this by default for things you make, not create_note. One artifact can hold several parts (say a report and its data), each shown as a tab, and photos go inside a part (call save_image first). For a routine that runs again and again, make a new artifact each run unless you were told to keep one up to date (then use update_artifact). It shows up in Luke\'s Agents section; nothing opens automatically.',
    input: z.object({
      title,
      content: content.optional(),
      format: format.optional(),
      parts: parts.optional(),
      projectId: projectId.optional(),
    }),
    run: async (input, { actor }) => {
      const body = partsFrom(input);
      if (!body) throw new OperationError("Give the artifact some content, or parts.");
      if (input.projectId) await assertProject(input.projectId);
      const artifactId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(artifacts)
          .values({ title: input.title, projectId: input.projectId ?? null, version: 1, ...madeByColumns(actor) })
          .returning({ id: artifacts.id });
        await addVersion(tx, row.id, 1, body, undefined, actor);
        return row.id;
      });
      return getArtifact(artifactId);
    },
  }),

  update_artifact: defineOperation({
    name: "update_artifact",
    description:
      "Change an artifact. New content (content or parts) saves a new version, and the old ones are kept; say what changed in note. Parts not given are not carried over, so pass every part you want in the new version. Changing only the title or project doesn't make a new version. To act on Luke's comments: update the artifact, then reply_to_comment and resolve_comment.",
    input: z.object({
      id,
      title: title.optional(),
      content: content.optional(),
      format: format.optional(),
      parts: parts.optional(),
      note: versionNote.optional(),
      projectId: projectId.optional(),
    }),
    run: async ({ id, title, projectId, note, ...rest }, { actor }) => {
      const current = await assertArtifact(id);
      if (projectId) await assertProject(projectId);
      const body = partsFrom(rest);
      await db.transaction(async (tx) => {
        const next = body ? current.version + 1 : current.version;
        if (body) await addVersion(tx, id, next, body, note, actor);
        await tx
          .update(artifacts)
          .set({
            ...(title !== undefined && { title }),
            ...(projectId !== undefined && { projectId }),
            version: next,
            updatedAt: new Date(),
          })
          .where(eq(artifacts.id, id));
      });
      return getArtifact(id);
    },
  }),

  delete_artifact: defineOperation({
    name: "delete_artifact",
    description: "Move an artifact to Trash, where it's kept for 30 days.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await assertArtifact(id);
      await db.update(artifacts).set({ deletedAt: new Date() }).where(eq(artifacts.id, id));
      return { deleted: id };
    },
  }),

  copy_artifact_to_note: defineOperation({
    name: "copy_artifact_to_note",
    description:
      "Copy an artifact's latest version into a new note of Luke's, so he can edit it. Only when Luke asks. Markdown parts are joined, each under its name as a heading; an artifact that's only web pages copies its first page.",
    input: z.object({ id }),
    run: async ({ id }, { actor }): Promise<Note> => {
      const artifact = await getArtifact(id);
      const markdown = artifact.content.filter((p) => p.format === "markdown");
      const several = markdown.length > 1;
      const [text, noteFormat] = markdown.length
        ? [markdown.map((p) => (several && p.name ? `## ${p.name}\n\n${p.content.trim()}` : p.content.trim())).join("\n\n"), "markdown"]
        : [artifact.content[0].content, "html"];
      const [row] = await db
        .insert(notes)
        .values({
          title: artifact.title,
          content: text,
          format: noteFormat,
          projectId: artifact.project?.id ?? null,
          ...madeByColumns(actor),
        })
        .returning({ id: notes.id });
      return getNote(row.id);
    },
  }),
};

/** Deletes comments whose note, artifact, document, task or Work archive entry is gone for good. */
export async function deleteOrphanComments() {
  await db.execute(sql`
    delete from ${comments} c
    where (c.target_type = 'note' and not exists (select 1 from ${notes} n where n.id = c.target_id))
       or (c.target_type = 'artifact' and not exists (select 1 from ${artifacts} a where a.id = c.target_id))
       or (c.target_type = 'document' and not exists (select 1 from documents d where d.id = c.target_id))
       or (c.target_type = 'task' and not exists (select 1 from tasks t where t.id = c.target_id))
       or (c.target_type = 'entry' and not exists (select 1 from archive_entries e where e.id = c.target_id))`);
}

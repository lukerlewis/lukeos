import "server-only";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";

const { contextFiles } = schema;

/**
 * Context files are background for Claude: who Luke is, who his audience is,
 * how his business works. Like SOPs, Claude only sees each one's title and
 * description up front and reads the rest with get_context when it's relevant.
 */

/** What Claude sees for every context file, before deciding which to read. */
export type ContextSummary = {
  id: string;
  title: string;
  description: string;
  madeBy: ReturnType<typeof madeByOf>;
  createdAt: Date;
  updatedAt: Date;
};

export type ContextFile = ContextSummary & { body: string };

/** The longest description allowed, the same as for SOPs. */
export const CONTEXT_DESCRIPTION_MAX = 1024;

const live = isNull(contextFiles.deletedAt);

function summaryOf(row: Omit<typeof contextFiles.$inferSelect, "body">): ContextSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    madeBy: madeByOf(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every context file, A to Z, without the long part. */
export async function listContext(): Promise<ContextSummary[]> {
  const rows = await db
    .select({
      id: contextFiles.id,
      title: contextFiles.title,
      description: contextFiles.description,
      createdByKind: contextFiles.createdByKind,
      createdByName: contextFiles.createdByName,
      createdByRoutine: contextFiles.createdByRoutine,
      createdAt: contextFiles.createdAt,
      updatedAt: contextFiles.updatedAt,
      deletedAt: contextFiles.deletedAt,
    })
    .from(contextFiles)
    .where(live)
    .orderBy(sql`lower(${contextFiles.title})`, asc(contextFiles.createdAt));
  return rows.map(summaryOf);
}

export async function getContext(id: string): Promise<ContextFile> {
  const [row] = await db
    .select()
    .from(contextFiles)
    .where(and(eq(contextFiles.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That context file doesn't exist, or it's in Trash.", 404);
  return { ...summaryOf(row), body: row.body };
}

/** Finds a context file by its title: an exact match first, then the one title that contains the words. */
async function contextByTitle(title: string): Promise<ContextFile> {
  const wanted = title.trim();
  const exact = await db
    .select({ id: contextFiles.id })
    .from(contextFiles)
    .where(and(live, sql`lower(${contextFiles.title}) = lower(${wanted})`))
    .limit(1);
  if (exact[0]) return getContext(exact[0].id);
  const close = await db
    .select({ id: contextFiles.id, title: contextFiles.title })
    .from(contextFiles)
    .where(and(live, ilike(contextFiles.title, `%${wanted.replace(/[\\%_]/g, "\\$&")}%`)))
    .limit(5);
  if (close.length === 1) return getContext(close[0].id);
  if (close.length > 1)
    throw new OperationError(`More than one context file matches "${wanted}": ${close.map((c) => `"${c.title}"`).join(", ")}. Use its id.`, 404);
  throw new OperationError(`There's no context file called "${wanted}". list_context shows them all.`, 404);
}

/**
 * The context files as short lines for Claude's instructions, e.g.
 * - "My audience": Who Luke writes for...
 */
export async function contextIndex() {
  const list = await listContext();
  return list
    .filter((c) => c.title.trim() || c.description.trim())
    .map((c) => `- "${c.title.trim() || "Untitled"}": ${c.description.trim().replace(/\s+/g, " ") || "(no description yet)"}`)
    .join("\n");
}

const id = z.uuid().describe("The context file's id, from list_context.");
const title = z.string().trim().max(200).describe("A short name, e.g. \"About me\" or \"My audience\".");
const description = z
  .string()
  .trim()
  .max(CONTEXT_DESCRIPTION_MAX)
  .describe(
    "One or two sentences saying what's in it and when it's relevant (e.g. \"Who Luke's audience is and what they care about. Read before writing posts, newsletters or anything public.\"). Claude sees this every time, so keep it short.",
  );
const body = z.string().max(200_000).describe("The context itself, in Markdown.");

export const contextOperations = {
  list_context: defineOperation({
    name: "list_context",
    description:
      "Luke's context files: background he wants you to know, like who he is, who his audience is, or how his work runs. Returns each one's id, title and description only (no full text). Use get_context to read any whose description is relevant to what you're doing.",
    input: z.object({}),
    run: async () =>
      (await listContext()).map((c) => ({ id: c.id, title: c.title, description: c.description, updatedAt: c.updatedAt })),
  }),

  get_context: defineOperation({
    name: "get_context",
    description: "Read one of Luke's context files in full, by id or title, and keep it in mind for what you're doing.",
    input: z
      .object({
        id: id.optional(),
        title: z.string().trim().min(1).max(200).optional().describe("The context file's title, if you don't have its id."),
      })
      .refine((v) => v.id || v.title, "Give the context file's id or its title."),
    run: async ({ id, title }) => (id ? getContext(id) : contextByTitle(title!)),
  }),

  create_context: defineOperation({
    name: "create_context",
    description:
      "Add a context file to Luke's Agents section: a title, a short description of what's in it and when it's relevant, and the context itself. Only when Luke asks.",
    input: z.object({
      title: title.optional(),
      description: description.optional(),
      body: body.optional(),
    }),
    run: async (input, { actor }) => {
      const [row] = await db
        .insert(contextFiles)
        .values({
          title: input.title ?? "",
          description: input.description ?? "",
          body: input.body ?? "",
          ...madeByColumns(actor),
        })
        .returning({ id: contextFiles.id });
      return getContext(row.id);
    },
  }),

  update_context: defineOperation({
    name: "update_context",
    description:
      "Change one of Luke's context files: its title, description or text. Only when Luke asks. Fields left out stay as they are.",
    input: z.object({
      id,
      title: z.string().trim().max(200).optional(),
      description: z
        .string()
        .trim()
        .max(CONTEXT_DESCRIPTION_MAX)
        .optional()
        .describe("What's in it and when it's relevant (see create_context)."),
      body: z.string().max(200_000).optional().describe("The context itself, in Markdown."),
    }),
    run: async ({ id, title, description, body }) => {
      await getContext(id);
      await db
        .update(contextFiles)
        .set({
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(body !== undefined && { body }),
          updatedAt: new Date(),
        })
        .where(eq(contextFiles.id, id));
      return getContext(id);
    },
  }),

  delete_context: defineOperation({
    name: "delete_context",
    description: "Move a context file to Trash, where it's kept for 30 days. Only when Luke asks.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await getContext(id);
      await db.update(contextFiles).set({ deletedAt: new Date() }).where(eq(contextFiles.id, id));
      return { deleted: id };
    },
  }),
};

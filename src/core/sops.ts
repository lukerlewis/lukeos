import "server-only";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";

const { sops } = schema;

/**
 * SOPs work like skills: Claude only ever sees each one's title and
 * description (a line or two), and reads the full instructions with get_sop
 * when a request matches. So having many SOPs costs Claude very little.
 */

/** What Claude sees for every SOP, before deciding which to read. */
export type SopSummary = {
  id: string;
  title: string;
  description: string;
  madeBy: ReturnType<typeof madeByOf>;
  createdAt: Date;
  updatedAt: Date;
};

export type Sop = SopSummary & { body: string };

/** The longest description allowed, the same as for Claude's own skills. */
export const SOP_DESCRIPTION_MAX = 1024;

const live = isNull(sops.deletedAt);

function summaryOf(row: typeof sops.$inferSelect | Omit<typeof sops.$inferSelect, "body">): SopSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    madeBy: madeByOf(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every SOP, A to Z, without the long part. */
export async function listSops(): Promise<SopSummary[]> {
  const rows = await db
    .select({
      id: sops.id,
      title: sops.title,
      description: sops.description,
      createdByKind: sops.createdByKind,
      createdByName: sops.createdByName,
      createdByRoutine: sops.createdByRoutine,
      createdAt: sops.createdAt,
      updatedAt: sops.updatedAt,
      deletedAt: sops.deletedAt,
    })
    .from(sops)
    .where(live)
    .orderBy(sql`lower(${sops.title})`, asc(sops.createdAt));
  return rows.map(summaryOf);
}

export async function getSop(id: string): Promise<Sop> {
  const [row] = await db
    .select()
    .from(sops)
    .where(and(eq(sops.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That SOP doesn't exist, or it's in Trash.", 404);
  return { ...summaryOf(row), body: row.body };
}

/** Finds an SOP by its title: an exact match first, then the one title that contains the words. */
async function sopByTitle(title: string): Promise<Sop> {
  const wanted = title.trim();
  const exact = await db
    .select({ id: sops.id })
    .from(sops)
    .where(and(live, sql`lower(${sops.title}) = lower(${wanted})`))
    .limit(1);
  if (exact[0]) return getSop(exact[0].id);
  const close = await db
    .select({ id: sops.id, title: sops.title })
    .from(sops)
    .where(and(live, ilike(sops.title, `%${wanted.replace(/[\\%_]/g, "\\$&")}%`)))
    .limit(5);
  if (close.length === 1) return getSop(close[0].id);
  if (close.length > 1)
    throw new OperationError(`More than one SOP matches "${wanted}": ${close.map((c) => `"${c.title}"`).join(", ")}. Use its id.`, 404);
  throw new OperationError(`There's no SOP called "${wanted}". list_sops shows them all.`, 404);
}

/**
 * The SOPs as short lines for Claude's instructions, e.g.
 * - "Weekly review": Use when Luke asks for his weekly review...
 */
export async function sopIndex() {
  const list = await listSops();
  return list
    .filter((s) => s.title.trim() || s.description.trim())
    .map((s) => `- "${s.title.trim() || "Untitled"}": ${s.description.trim().replace(/\s+/g, " ") || "(no description yet)"}`)
    .join("\n");
}

/** Rough size in tokens (about 4 characters each), so Luke can see what an SOP costs Claude to read. */
export function roughTokens(text: string) {
  return Math.ceil(text.trim().length / 4);
}

const id = z.uuid().describe("The SOP's id, from list_sops.");
const title = z.string().trim().max(200).describe("A short name, e.g. \"Weekly review\" or \"Writing LinkedIn posts\".");
const description = z
  .string()
  .trim()
  .max(SOP_DESCRIPTION_MAX)
  .describe(
    "One or two sentences saying what the SOP is for and when to use it, with the words Luke would use when asking (e.g. \"How to write Luke's weekly review. Use when he asks for a weekly review, week summary or Friday wrap-up.\"). Claude sees this every time, so keep it short.",
  );
const body = z
  .string()
  .max(200_000)
  .describe(
    "The full instructions in Markdown: steps, rules, examples. Only read when needed, but keep it focused on what Claude wouldn't know on its own. For a big topic, split detail into a separate SOP and refer to it by title.",
  );

export const sopOperations = {
  list_sops: defineOperation({
    name: "list_sops",
    description:
      "Luke's SOPs: his instructions for how to do particular things. Returns each one's id, title and description only (no full text). Check this before doing something Luke asks, then get_sop to read any whose description fits the request.",
    input: z.object({}),
    run: async () =>
      (await listSops()).map((s) => ({ id: s.id, title: s.title, description: s.description, updatedAt: s.updatedAt })),
  }),

  get_sop: defineOperation({
    name: "get_sop",
    description:
      "Read one of Luke's SOPs in full, by id or title, and follow it. If it refers to another SOP by title, read that one too only when you need it.",
    input: z
      .object({
        id: id.optional(),
        title: z.string().trim().min(1).max(200).optional().describe("The SOP's title, if you don't have its id."),
      })
      .refine((v) => v.id || v.title, "Give the SOP's id or its title."),
    run: async ({ id, title }) => (id ? getSop(id) : sopByTitle(title!)),
  }),

  create_sop: defineOperation({
    name: "create_sop",
    description:
      "Add an SOP to Luke's Agents section: a title, a short description of what it's for and when to use it, and the full instructions. Only when Luke asks for one (e.g. \"save this as an SOP\").",
    input: z.object({
      title: title.optional(),
      description: description.optional(),
      body: body.optional(),
    }),
    run: async (input, { actor }) => {
      const [row] = await db
        .insert(sops)
        .values({
          title: input.title ?? "",
          description: input.description ?? "",
          body: input.body ?? "",
          ...madeByColumns(actor),
        })
        .returning({ id: sops.id });
      return getSop(row.id);
    },
  }),

  update_sop: defineOperation({
    name: "update_sop",
    description:
      "Change one of Luke's SOPs: its title, description or full instructions. Only when Luke asks. Fields left out stay as they are.",
    input: z.object({
      id,
      title: z.string().trim().max(200).optional(),
      description: z.string().trim().max(SOP_DESCRIPTION_MAX).optional().describe("What it's for and when to use it (see create_sop)."),
      body: z.string().max(200_000).optional().describe("The full instructions, in Markdown."),
    }),
    run: async ({ id, title, description, body }) => {
      await getSop(id);
      await db
        .update(sops)
        .set({
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(body !== undefined && { body }),
          updatedAt: new Date(),
        })
        .where(eq(sops.id, id));
      return getSop(id);
    },
  }),

  delete_sop: defineOperation({
    name: "delete_sop",
    description: "Move an SOP to Trash, where it's kept for 30 days. Only when Luke asks.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await getSop(id);
      await db.update(sops).set({ deletedAt: new Date() }).where(eq(sops.id, id));
      return { deleted: id };
    },
  }),
};

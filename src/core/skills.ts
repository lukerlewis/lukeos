import "server-only";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";

const { skills } = schema;

/**
 * Skills work like Claude's own skills: Claude only ever sees each one's title and
 * description (a line or two), and reads the full instructions with get_skill
 * when a request matches. So having many skills costs Claude very little.
 */

/** What Claude sees for every skill, before deciding which to read. */
export type SkillSummary = {
  id: string;
  title: string;
  description: string;
  madeBy: ReturnType<typeof madeByOf>;
  createdAt: Date;
  updatedAt: Date;
};

export type Skill = SkillSummary & { body: string };

/** The longest description allowed, the same as for Claude's own skills. */
export const SKILL_DESCRIPTION_MAX = 1024;

const live = isNull(skills.deletedAt);

function summaryOf(row: typeof skills.$inferSelect | Omit<typeof skills.$inferSelect, "body">): SkillSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    madeBy: madeByOf(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every skill, A to Z, without the long part. */
export async function listSkills(): Promise<SkillSummary[]> {
  const rows = await db
    .select({
      id: skills.id,
      title: skills.title,
      description: skills.description,
      createdByKind: skills.createdByKind,
      createdByName: skills.createdByName,
      createdByRoutine: skills.createdByRoutine,
      createdAt: skills.createdAt,
      updatedAt: skills.updatedAt,
      deletedAt: skills.deletedAt,
    })
    .from(skills)
    .where(live)
    .orderBy(sql`lower(${skills.title})`, asc(skills.createdAt));
  return rows.map(summaryOf);
}

export async function getSkill(id: string): Promise<Skill> {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, id), live))
    .limit(1);
  if (!row) throw new OperationError("That skill doesn't exist, or it's in Trash.", 404);
  return { ...summaryOf(row), body: row.body };
}

/** Finds a skill by its title: an exact match first, then the one title that contains the words. */
async function skillByTitle(title: string): Promise<Skill> {
  const wanted = title.trim();
  const exact = await db
    .select({ id: skills.id })
    .from(skills)
    .where(and(live, sql`lower(${skills.title}) = lower(${wanted})`))
    .limit(1);
  if (exact[0]) return getSkill(exact[0].id);
  const close = await db
    .select({ id: skills.id, title: skills.title })
    .from(skills)
    .where(and(live, ilike(skills.title, `%${wanted.replace(/[\\%_]/g, "\\$&")}%`)))
    .limit(5);
  if (close.length === 1) return getSkill(close[0].id);
  if (close.length > 1)
    throw new OperationError(`More than one skill matches "${wanted}": ${close.map((c) => `"${c.title}"`).join(", ")}. Use its id.`, 404);
  throw new OperationError(`There's no skill called "${wanted}". list_skills shows them all.`, 404);
}

/**
 * The skills as short lines for Claude's instructions, e.g.
 * - "Weekly review": Use when Luke asks for his weekly review...
 */
export async function skillIndex() {
  const list = await listSkills();
  return list
    .filter((s) => s.title.trim() || s.description.trim())
    .map((s) => `- "${s.title.trim() || "Untitled"}": ${s.description.trim().replace(/\s+/g, " ") || "(no description yet)"}`)
    .join("\n");
}

/** Rough size in tokens (about 4 characters each), so Luke can see what a skill costs Claude to read. */
export function roughTokens(text: string) {
  return Math.ceil(text.trim().length / 4);
}

const id = z.uuid().describe("The skill's id, from list_skills.");
const title = z.string().trim().max(200).describe("A short name, e.g. \"Weekly review\" or \"Writing LinkedIn posts\".");
const description = z
  .string()
  .trim()
  .max(SKILL_DESCRIPTION_MAX)
  .describe(
    "One or two sentences saying what the skill is for and when to use it, with the words Luke would use when asking (e.g. \"How to write Luke's weekly review. Use when he asks for a weekly review, week summary or Friday wrap-up.\"). Claude sees this every time, so keep it short.",
  );
const body = z
  .string()
  .max(200_000)
  .describe(
    "The full instructions in Markdown: steps, rules, examples. Only read when needed, but keep it focused on what Claude wouldn't know on its own. For a big topic, split detail into a separate skill and refer to it by title.",
  );

export const skillOperations = {
  list_skills: defineOperation({
    name: "list_skills",
    description:
      "Luke's skills: his instructions for how to do particular things. Returns each one's id, title and description only (no full text). Check this before doing something Luke asks, then get_skill to read any whose description fits the request.",
    input: z.object({}),
    run: async () =>
      (await listSkills()).map((s) => ({ id: s.id, title: s.title, description: s.description, updatedAt: s.updatedAt })),
  }),

  get_skill: defineOperation({
    name: "get_skill",
    description:
      "Read one of Luke's skills in full, by id or title, and follow it. If it refers to another skill by title, read that one too only when you need it.",
    input: z
      .object({
        id: id.optional(),
        title: z.string().trim().min(1).max(200).optional().describe("The skill's title, if you don't have its id."),
      })
      .refine((v) => v.id || v.title, "Give the skill's id or its title."),
    run: async ({ id, title }) => (id ? getSkill(id) : skillByTitle(title!)),
  }),

  create_skill: defineOperation({
    name: "create_skill",
    description:
      "Add a skill to Luke's Agents section: a title, a short description of what it's for and when to use it, and the full instructions. Only when Luke asks for one (e.g. \"save this as a skill\").",
    input: z.object({
      title: title.optional(),
      description: description.optional(),
      body: body.optional(),
    }),
    run: async (input, { actor }) => {
      const [row] = await db
        .insert(skills)
        .values({
          title: input.title ?? "",
          description: input.description ?? "",
          body: input.body ?? "",
          ...madeByColumns(actor),
        })
        .returning({ id: skills.id });
      return getSkill(row.id);
    },
  }),

  update_skill: defineOperation({
    name: "update_skill",
    description:
      "Change one of Luke's skills: its title, description or full instructions. Only when Luke asks. Fields left out stay as they are.",
    input: z.object({
      id,
      title: z.string().trim().max(200).optional(),
      description: z.string().trim().max(SKILL_DESCRIPTION_MAX).optional().describe("What it's for and when to use it (see create_skill)."),
      body: z.string().max(200_000).optional().describe("The full instructions, in Markdown."),
    }),
    run: async ({ id, title, description, body }) => {
      await getSkill(id);
      await db
        .update(skills)
        .set({
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(body !== undefined && { body }),
          updatedAt: new Date(),
        })
        .where(eq(skills.id, id));
      return getSkill(id);
    },
  }),

  delete_skill: defineOperation({
    name: "delete_skill",
    description: "Move a skill to Trash, where it's kept for 30 days. Only when Luke asks.",
    input: z.object({ id }),
    run: async ({ id }) => {
      await getSkill(id);
      await db.update(skills).set({ deletedAt: new Date() }).where(eq(skills.id, id));
      return { deleted: id };
    },
  }),
};

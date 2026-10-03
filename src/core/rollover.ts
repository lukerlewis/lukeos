import "server-only";
import { and, eq, isNull, lt } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import { today } from "./settings";

const { appSettings, tasks } = schema;
const KEY = "lists_rolled_over";

/** The last day this server instance knows the move was done, so most calls skip the database. */
let doneFor: string | null = null;

/**
 * At midnight in Luke's time zone, his Tomorrow list becomes Today: every task
 * in Tomorrow moves to Today. Due dates aren't touched, and This week and Later
 * stay put. Done lazily, the first time anything reads tasks on a new day, so
 * it needs no timer and catches up after days away (one move, however many
 * midnights passed). The very first run only records the day, since tasks in
 * Tomorrow then were put there meaning the day after.
 */
export const rollOverLists = cache(async () => {
  const day = await today();
  if (doneFor === day) return;
  // Claim the day in one step, so two requests at once can't both move tasks.
  const claimed = await db
    .update(appSettings)
    .set({ value: day })
    .where(and(eq(appSettings.key, KEY), lt(appSettings.value, day)))
    .returning();
  if (claimed.length > 0) {
    await db
      .update(tasks)
      .set({ bucket: "today" })
      .where(and(eq(tasks.bucket, "tomorrow"), isNull(tasks.deletedAt)));
  } else {
    await db.insert(appSettings).values({ key: KEY, value: day }).onConflictDoNothing();
  }
  doneFor = day;
});

import "server-only";
import { desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addDays, todayIn } from "@/lib/dates";
import { DEFAULT_FOCUS_SETTINGS, FOCUS_LIMITS, parseFocusSettings, type FocusSettings } from "@/lib/focus";
import { defineOperation, madeByColumns, madeByOf, OperationError } from "./define";
import { getTimeZone } from "./settings";

/**
 * Focus: a pomodoro timer, a regular timer and brown noise. The timers run on
 * Luke's device; what's kept here is the pomodoro lengths and a log of the
 * time he spent focusing.
 */

const KEY = "focus_settings";

export async function getFocusSettings(): Promise<FocusSettings> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  if (!row) return DEFAULT_FOCUS_SETTINGS;
  try {
    return parseFocusSettings(JSON.parse(row.value));
  } catch {
    return DEFAULT_FOCUS_SETTINGS;
  }
}

/** Today's and the last 7 days' focus time, in Luke's time zone, plus the latest sessions. */
export async function focusSummary(recent = 10) {
  const timeZone = await getTimeZone();
  const today = todayIn(timeZone);
  const weekStart = addDays(today, -6);
  const rows = await db
    .select()
    .from(schema.focusSessions)
    .where(gte(schema.focusSessions.endedAt, new Date(Date.now() - 8 * 86400_000)))
    .orderBy(desc(schema.focusSessions.endedAt));
  let todaySeconds = 0;
  let weekSeconds = 0;
  for (const r of rows) {
    const day = todayIn(timeZone, r.endedAt);
    if (day === today) todaySeconds += r.seconds;
    if (day >= weekStart) weekSeconds += r.seconds;
  }
  const latest = rows.length >= recent ? rows.slice(0, recent) : await latestSessions(recent);
  return { today, todaySeconds, last7DaysSeconds: weekSeconds, recent: latest.map(sessionOut) };
}

async function latestSessions(limit: number) {
  return db.select().from(schema.focusSessions).orderBy(desc(schema.focusSessions.endedAt)).limit(limit);
}

function sessionOut(r: typeof schema.focusSessions.$inferSelect) {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    seconds: r.seconds,
    madeBy: madeByOf(r),
  };
}

const whole = (key: keyof FocusSettings, what: string) =>
  z
    .number()
    .int()
    .min(FOCUS_LIMITS[key][0])
    .max(FOCUS_LIMITS[key][1])
    .optional()
    .describe(what);

export const focusOperations = {
  get_focus: defineOperation({
    name: "get_focus",
    description:
      "Luke's Focus section: his pomodoro lengths, how long he has focused today and over the last 7 days, and his latest focus sessions (finished pomodoros and regular timer runs). Times are in seconds.",
    input: z.object({ recent: z.number().int().min(1).max(100).optional().describe("How many recent sessions to list (default 10).") }),
    run: async ({ recent }) => ({ settings: await getFocusSettings(), ...(await focusSummary(recent ?? 10)) }),
  }),

  update_focus_settings: defineOperation({
    name: "update_focus_settings",
    description:
      "Change Luke's pomodoro lengths, in minutes: focus, short break, long break, and how many focus rounds come before a long break. Fields left out stay as they are. Only change these when Luke asks.",
    input: z.object({
      focusMinutes: whole("focusMinutes", "Length of a focus round."),
      shortBreakMinutes: whole("shortBreakMinutes", "Length of a short break."),
      longBreakMinutes: whole("longBreakMinutes", "Length of a long break."),
      roundsBeforeLongBreak: whole("roundsBeforeLongBreak", "Focus rounds before a long break."),
    }),
    run: async (changes) => {
      const current = await getFocusSettings();
      const settings = parseFocusSettings({
        ...current,
        ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
      });
      const value = JSON.stringify(settings);
      await db
        .insert(schema.appSettings)
        .values({ key: KEY, value })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
      return settings;
    },
  }),

  log_focus_session: defineOperation({
    name: "log_focus_session",
    description:
      "Record time Luke spent focusing. The app does this itself when a pomodoro finishes or he stops the regular timer, so only use it when Luke asks you to log focus time he did elsewhere.",
    input: z.object({
      kind: z.enum(["pomodoro", "timer"]).default("timer"),
      seconds: z.number().int().min(1).max(24 * 3600).describe("Time focused, leaving out pauses."),
      endedAt: z.iso.datetime({ offset: true }).optional().describe("When it ended (default: now)."),
      startedAt: z.iso.datetime({ offset: true }).optional().describe("When it started (default: endedAt minus seconds)."),
      label: z.string().max(200).optional().describe("What it was for, if Luke said."),
    }),
    run: async (input, { actor }) => {
      const endedAt = input.endedAt ? new Date(input.endedAt) : new Date();
      const startedAt = input.startedAt ? new Date(input.startedAt) : new Date(endedAt.getTime() - input.seconds * 1000);
      if (startedAt > endedAt) throw new OperationError("startedAt is after endedAt.");
      const { createdByKind, createdByName, createdByRoutine } = madeByColumns(actor);
      const [row] = await db
        .insert(schema.focusSessions)
        .values({
          kind: input.kind,
          label: input.label?.trim() || null,
          startedAt,
          endedAt,
          seconds: input.seconds,
          createdByKind,
          createdByName,
          createdByRoutine,
        })
        .returning();
      return sessionOut(row);
    },
  }),
};

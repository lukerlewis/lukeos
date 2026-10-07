import "server-only";
import { eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_FOCUS_SETTINGS, FOCUS_LIMITS, parseFocusSettings, type FocusSettings } from "@/lib/focus";
import { addDays, todayIn } from "@/lib/dates";
import { defineOperation, madeByColumns, OperationError } from "./define";
import { getTimeZone } from "./settings";

/**
 * Focus: a pomodoro timer, a regular timer and brown noise. The timers run on
 * Luke's device; what's kept here is the pomodoro lengths and a log of the
 * time he spent focusing, shown as a daily chart under Stats.
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

/** Focus time per day for the last `days` days (oldest first, today last), in Luke's time zone. */
export async function focusByDay(days: number) {
  const timeZone = await getTimeZone();
  const today = todayIn(timeZone);
  const first = addDays(today, -(days - 1));
  const rows = await db
    .select({ endedAt: schema.focusSessions.endedAt, seconds: schema.focusSessions.seconds })
    .from(schema.focusSessions)
    .where(gte(schema.focusSessions.endedAt, new Date(Date.now() - (days + 1) * 86400_000)));
  const totals = new Map<string, number>();
  for (const r of rows) {
    const day = todayIn(timeZone, r.endedAt);
    if (day >= first) totals.set(day, (totals.get(day) ?? 0) + r.seconds);
  }
  const list = Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i);
    return { date, seconds: totals.get(date) ?? 0 };
  });
  return { today, days: list, totalSeconds: list.reduce((n, d) => n + d.seconds, 0) };
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
      "Luke's Focus section: his pomodoro lengths (focus, short break, long break, in minutes, and rounds before a long break).",
    input: z.object({}),
    run: async () => ({ settings: await getFocusSettings() }),
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

  get_focus_stats: defineOperation({
    name: "get_focus_stats",
    description:
      "How long Luke focused each day (pomodoro focus rounds and the regular timer; breaks and brown noise on its own don't count), for the last N days in his time zone, oldest first. Times are in seconds.",
    input: z.object({ days: z.number().int().min(1).max(366).default(7).describe("How many days back, including today (default 7).") }),
    run: async ({ days }) => focusByDay(days),
  }),

  log_focus_session: defineOperation({
    name: "log_focus_session",
    description:
      "Record time Luke spent focusing. The app does this itself when a pomodoro focus round ends or he restarts the regular timer, so only use it when Luke asks you to log focus time he did elsewhere.",
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
      const [row] = await db
        .insert(schema.focusSessions)
        .values({ kind: input.kind, label: input.label?.trim() || null, startedAt, endedAt, seconds: input.seconds, ...madeByColumns(actor) })
        .returning();
      return { id: row.id, kind: row.kind, label: row.label, startedAt: row.startedAt, endedAt: row.endedAt, seconds: row.seconds };
    },
  }),
};


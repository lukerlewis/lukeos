import "server-only";
import { asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_FOCUS_SETTINGS, FOCUS_LIMITS, parseFocusSettings, type FocusSettings } from "@/lib/focus";
import { addDays, todayIn } from "@/lib/dates";
import { defineOperation, madeByColumns, OperationError } from "./define";
import { getTimeZone } from "./settings";

/**
 * Focus: a pomodoro timer, a regular timer, focus sprints and brown noise. The timers run on
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

type FocusRow = typeof schema.focusSessions.$inferSelect;

const kinds = ["pomodoro", "timer", "sprint"] as const;
type FocusKind = (typeof kinds)[number];

/** A logged session, with the day it counts towards (the day it ended, in Luke's time zone). */
const sessionOut = (r: FocusRow, timeZone: string) => ({
  id: r.id,
  kind: r.kind as FocusKind,
  label: r.label,
  startedAt: r.startedAt,
  endedAt: r.endedAt,
  seconds: r.seconds,
  day: todayIn(timeZone, r.endedAt),
});

/**
 * Focus time per day for the last `days` days (oldest first, today last), in
 * Luke's time zone, and the sessions that make it up (oldest first).
 */
export async function focusByDay(days: number) {
  const timeZone = await getTimeZone();
  const today = todayIn(timeZone);
  const first = addDays(today, -(days - 1));
  const rows = await db
    .select()
    .from(schema.focusSessions)
    .where(gte(schema.focusSessions.endedAt, new Date(Date.now() - (days + 1) * 86400_000)))
    .orderBy(asc(schema.focusSessions.startedAt));
  const sessions = rows.map((r) => sessionOut(r, timeZone)).filter((s) => s.day >= first);
  const totals = new Map<string, number>();
  for (const s of sessions) totals.set(s.day, (totals.get(s.day) ?? 0) + s.seconds);
  const list = Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i);
    return { date, seconds: totals.get(date) ?? 0 };
  });
  return { today, timeZone, days: list, totalSeconds: list.reduce((n, d) => n + d.seconds, 0), sessions };
}

async function findSession(id: string) {
  const [row] = await db.select().from(schema.focusSessions).where(eq(schema.focusSessions.id, id)).limit(1);
  if (!row) throw new OperationError("No focus session with that id.");
  return row;
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
      "How long Luke focused each day (pomodoro focus rounds, the regular timer and focus sprints, whose label lists the tasks he picked for it; breaks and brown noise on its own don't count), for the last N days in his time zone, oldest first, plus each logged session with its id (sessions count towards the day they ended). Times are in seconds.",
    input: z.object({ days: z.number().int().min(1).max(366).default(7).describe("How many days back, including today (default 7).") }),
    run: async ({ days }) => focusByDay(days),
  }),

  log_focus_session: defineOperation({
    name: "log_focus_session",
    description:
      "Record time Luke spent focusing. The app does this itself as his timers run (finished or not), so only use it when Luke asks you to log focus time he did elsewhere. Passing the id of an existing session replaces its time instead of adding a new one.",
    input: z.object({
      id: z.uuid().optional().describe("Optional id for the session; if it already exists, its time is updated."),
      kind: z.enum(kinds).default("timer"),
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
        .values({
          ...(input.id ? { id: input.id } : {}),
          kind: input.kind,
          label: input.label?.trim() || null,
          startedAt,
          endedAt,
          seconds: input.seconds,
          ...madeByColumns(actor),
        })
        .onConflictDoUpdate({
          target: schema.focusSessions.id,
          set: { endedAt, seconds: input.seconds, ...(input.label?.trim() ? { label: input.label.trim() } : {}) },
        })
        .returning();
      return { id: row.id, kind: row.kind, label: row.label, startedAt: row.startedAt, endedAt: row.endedAt, seconds: row.seconds };
    },
  }),

  update_focus_session: defineOperation({
    name: "update_focus_session",
    description:
      "Fix a logged focus session (ids come from get_focus_stats): how long Luke focused, when it started or ended, what it was for. Fields left out stay as they are. Only when Luke asks.",
    input: z.object({
      id: z.uuid(),
      seconds: z.number().int().min(1).max(24 * 3600).optional().describe("Time focused, leaving out pauses."),
      startedAt: z.iso.datetime({ offset: true }).optional(),
      endedAt: z.iso.datetime({ offset: true }).optional().describe("Decides which day the time counts towards."),
      label: z.string().max(200).nullable().optional(),
      kind: z.enum(kinds).optional(),
    }),
    run: async (input) => {
      const row = await findSession(input.id);
      const startedAt = input.startedAt ? new Date(input.startedAt) : row.startedAt;
      const endedAt = input.endedAt ? new Date(input.endedAt) : row.endedAt;
      if (startedAt > endedAt) throw new OperationError("It can't start after it ends.");
      const [updated] = await db
        .update(schema.focusSessions)
        .set({
          startedAt,
          endedAt,
          seconds: input.seconds ?? row.seconds,
          ...(input.label !== undefined ? { label: input.label?.trim() || null } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
        })
        .where(eq(schema.focusSessions.id, input.id))
        .returning();
      return sessionOut(updated, await getTimeZone());
    },
  }),

  delete_focus_session: defineOperation({
    name: "delete_focus_session",
    description: "Delete a logged focus session for good (ids come from get_focus_stats). Only when Luke asks.",
    input: z.object({ id: z.uuid() }),
    run: async ({ id }) => {
      const row = await findSession(id);
      await db.delete(schema.focusSessions).where(eq(schema.focusSessions.id, id));
      return sessionOut(row, await getTimeZone());
    },
  }),
};


import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_FOCUS_SETTINGS, FOCUS_LIMITS, parseFocusSettings, type FocusSettings } from "@/lib/focus";
import { defineOperation } from "./define";

/**
 * Focus: a pomodoro timer, a regular timer and brown noise. The timers run on
 * Luke's device; what's kept here is the pomodoro lengths. (The focus_sessions
 * table is unused for now: Luke asked to drop focus-time tracking, 2026-10-07.)
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
};

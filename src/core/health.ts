import "server-only";
import { z } from "zod";
import { addDays, isoDay, todayIn } from "@/lib/dates";
import { emptySummary, type HealthDay } from "@/lib/health";
import { defineOperation, OperationError } from "./define";
import { disconnect, HealthError, healthDayDetail, healthDays, healthProbe, healthRaw, healthStatus, syncHealth } from "./health-google";
import { getTimeZone } from "./settings";

/**
 * Health: Luke's Fitbit numbers (steps, sleep, heart rate and more), one row per day.
 * See health-google.ts for how they come in.
 */

/** The last `days` days, oldest first, today last; days with nothing recorded have nulls. */
export async function getHealth(days: number) {
  const timeZone = await getTimeZone();
  const today = todayIn(timeZone);
  const first = addDays(today, -(days - 1));
  const [status, rows] = await Promise.all([healthStatus(), healthDays(first, today)]);
  const byDate = new Map(rows.map((r) => [r.date, r.summary]));
  const list: HealthDay[] = Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i);
    return { date, ...emptySummary(), ...byDate.get(date) };
  });
  return { ...status, today, timeZone, days: list };
}

const wrap = async <T>(work: () => Promise<T>) => {
  try {
    return await work();
  } catch (err) {
    if (err instanceof HealthError) throw new OperationError(err.message);
    throw err;
  }
};

export const healthOperations = {
  get_health: defineOperation({
    name: "get_health",
    description:
      "Luke's Fitbit numbers per day, for the last N days in his time zone, oldest first (today last): steps, distanceMeters, activeMinutes (active zone minutes), caloriesOut, restingHeartRate (bpm), hrvMs (heart rate variability), breathingRate (breaths/min asleep), spo2 (blood oxygen %, asleep), skinTempDeviation (°C vs his usual), vo2Max, sleep (minutes asleep, start/end, deep/light/REM/awake minutes; a night counts towards the day he woke up) and workouts. Unknown numbers are null. Also says whether Fitbit is connected and when it last synced. Health data is private: only mention it to Luke himself.",
    input: z.object({ days: z.number().int().min(1).max(90).default(30).describe("How many days back, including today (default 30).") }),
    run: async ({ days }) => getHealth(days),
  }),

  get_health_raw: defineOperation({
    name: "get_health_raw",
    description:
      "Google Health's own data points saved for one day (by data type: steps, sleep with every stage, exercise, daily-resting-heart-rate...). Only needed for details get_health doesn't have, like the exact sleep stage timeline.",
    input: z.object({ date: z.string().regex(isoDay).describe("The day, YYYY-MM-DD.") }),
    run: async ({ date }) => ({ date, raw: (await healthRaw(date)) ?? {} }),
  }),

  get_health_day: defineOperation({
    name: "get_health_day",
    description:
      "One day of Luke's Fitbit in detail, fetched live from Google Health: the day's summary (as in get_health), stepsByHour (24 numbers from midnight, null = nothing recorded), heartRate in 5-minute buckets ({time, bpm, min, max}) and sleepStages ({stage: AWAKE/LIGHT/DEEP/REM/ASLEEP/RESTLESS, start, end}) for the night that ended that morning. Health data is private: only mention it to Luke himself.",
    input: z.object({ date: z.string().regex(isoDay).describe("The day, YYYY-MM-DD, in Luke's time zone.") }),
    run: async ({ date }) =>
      wrap(async () => {
        const [rows, detail] = await Promise.all([healthDays(date, date), healthDayDetail(date)]);
        return { date, ...emptySummary(), ...rows[0]?.summary, ...detail };
      }),
  }),

  get_health_probe: defineOperation({
    name: "get_health_probe",
    description: "Google Health's first page of raw data points for one data type (e.g. sleep, exercise, heart-rate), with an optional AIP-160 filter. Only for working out why some data doesn't come in.",
    input: z.object({ dataType: z.string().regex(/^[a-z0-9-]+$/), filter: z.string().optional() }),
    run: async ({ dataType, filter }) => wrap(() => healthProbe(dataType, filter)),
  }),

  sync_health: defineOperation({
    name: "sync_health",
    description:
      "Fetch Luke's latest Fitbit numbers from Google Health now (they also come in by themselves through the day). Returns when it last synced and any data types that failed.",
    input: z.object({ days: z.number().int().min(1).max(90).default(3).describe("How many days back to fetch again (default 3).") }),
    run: async ({ days }) => wrap(() => syncHealth({ days })),
  }),

  disconnect_health: defineOperation({
    name: "disconnect_health",
    description: "Stop reading Luke's Fitbit: forgets the Google sign-in. The numbers already saved stay. Only when Luke asks.",
    input: z.object({}),
    run: async () => {
      await disconnect();
      return { connected: false };
    },
  }),
};

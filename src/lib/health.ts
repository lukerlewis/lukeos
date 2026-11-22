/**
 * Shapes and formatting for Health: Luke's Fitbit numbers, one summary per day.
 * Shared by the server (which builds summaries from Google's data) and the Health page.
 * Every number is null when the Fitbit didn't record it that day.
 */

export type HealthSleep = {
  /** Time asleep, in minutes. */
  minutes: number;
  /** When he fell asleep and woke up (ISO). */
  start: string;
  end: string;
  deepMinutes: number | null;
  lightMinutes: number | null;
  remMinutes: number | null;
  awakeMinutes: number | null;
};

export type HealthWorkout = {
  /** Google's exercise type, e.g. RUNNING, WALKING, STRENGTH_TRAINING. */
  type: string;
  /** The name shown in the Fitbit app, when there is one. */
  name: string | null;
  minutes: number;
  startedAt: string;
  calories: number | null;
  distanceMeters: number | null;
};

/** One day's numbers. The day of a night's sleep is the day he woke up. */
export type HealthSummary = {
  steps: number | null;
  distanceMeters: number | null;
  /** Active zone minutes (cardio and peak count double, as Fitbit counts them). */
  activeMinutes: number | null;
  caloriesOut: number | null;
  restingHeartRate: number | null;
  /** Heart rate variability (RMSSD), in milliseconds. */
  hrvMs: number | null;
  /** Breaths per minute while asleep. */
  breathingRate: number | null;
  /** Blood oxygen while asleep, percent. */
  spo2: number | null;
  /** Skin temperature while asleep, °C above (+) or below (−) his usual. */
  skinTempDeviation: number | null;
  vo2Max: number | null;
  sleep: HealthSleep | null;
  workouts: HealthWorkout[];
};

export type HealthDay = HealthSummary & { date: string };

export const emptySummary = (): HealthSummary => ({
  steps: null,
  distanceMeters: null,
  activeMinutes: null,
  caloriesOut: null,
  restingHeartRate: null,
  hrvMs: null,
  breathingRate: null,
  spo2: null,
  skinTempDeviation: null,
  vo2Max: null,
  sleep: null,
  workouts: [],
});

/** 7h 32m, or 45m. */
export function hoursMinutes(minutes: number) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export const thousands = (n: number) => Math.round(n).toLocaleString("en-US");

/** Miles with one decimal (Luke's in the US). */
export const miles = (meters: number) => `${(meters / 1609.344).toFixed(1)} mi`;

/** A °C difference as a signed °F difference, e.g. +0.4°F. */
export const fahrenheitDelta = (c: number) => {
  const f = c * 1.8;
  return `${f > 0 ? "+" : f < 0 ? "−" : ""}${Math.abs(f).toFixed(1)}°F`;
};

/** RUNNING → Running, STRENGTH_TRAINING → Strength training. */
export function workoutLabel(w: Pick<HealthWorkout, "type" | "name">) {
  if (w.name) return w.name;
  const words = w.type.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Average of the numbers that aren't null, or null if there are none. */
export function averageOf(values: (number | null | undefined)[]) {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

import { fahrenheitDelta, hoursMinutes, thousands, type HealthDay } from "./health";

/** The Health sections Luke can tap into, each with its own page at /health/<id>. */
export type HealthSection = {
  id: string;
  title: string;
  value: (d: HealthDay) => number | null;
  format: (v: number) => string;
  chart: "bar" | "line";
  /** Adding up days means something (steps, minutes). */
  total?: boolean;
  /** Which within-the-day detail the day view shows. */
  day?: "sleep" | "steps" | "heart";
  /** Tick labels for bar charts. */
  tick?: (v: number) => string;
  goal?: number;
};

const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

export const healthSections: HealthSection[] = [
  { id: "sleep", title: "Sleep", value: (d) => d.sleep?.minutes ?? null, format: hoursMinutes, chart: "bar", day: "sleep", tick: (v) => `${Math.round(v / 60)}h` },
  { id: "steps", title: "Steps", value: (d) => d.steps, format: thousands, chart: "bar", total: true, day: "steps", tick: k, goal: 10_000 },
  { id: "heart-rate", title: "Resting heart rate", value: (d) => d.restingHeartRate, format: (v) => `${Math.round(v)} bpm`, chart: "line", day: "heart" },
  { id: "hrv", title: "Heart rate variability", value: (d) => d.hrvMs, format: (v) => `${Math.round(v)} ms`, chart: "line" },
  { id: "active-zone-minutes", title: "Active zone minutes", value: (d) => d.activeMinutes, format: (v) => String(Math.round(v)), chart: "bar", total: true, day: "heart", tick: (v) => String(Math.round(v)) },
  { id: "breathing-rate", title: "Breathing rate", value: (d) => d.breathingRate, format: (v) => `${v.toFixed(1)} /min`, chart: "line" },
  { id: "blood-oxygen", title: "Blood oxygen", value: (d) => d.spo2, format: (v) => `${v.toFixed(1)}%`, chart: "line" },
  { id: "skin-temperature", title: "Skin temperature", value: (d) => d.skinTempDeviation, format: fahrenheitDelta, chart: "line" },
  { id: "vo2-max", title: "Cardio fitness (VO₂ max)", value: (d) => d.vo2Max, format: (v) => v.toFixed(1), chart: "line" },
];

export const sectionById = (id: string) => healthSections.find((s) => s.id === id);

/** Link to a section's page, keeping the range and the picked day. */
export const sectionHref = (id: string, date?: string, range?: number) => {
  const q = new URLSearchParams();
  if (range && range !== 30) q.set("range", String(range));
  if (date) q.set("date", date);
  const s = q.toString();
  return `/health/${id}${s ? `?${s}` : ""}`;
};

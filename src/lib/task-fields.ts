/** The choices for a task's fields, and how they're shown. Shared by the app and its operations. */

export const statuses = ["todo", "doing", "done"] as const;
export const priorities = ["low", "medium", "high"] as const;
/** The kind of attention a task needs (shown as "Focus type"). Stored in the task's `effort` field. */
export const efforts = ["shallow", "focus", "deep"] as const;
/** Aya, Work or Life. Every task and project is in one; Aya and Work hold projects, Life has none. */
export const areas = ["aya", "work", "life"] as const;
/** The areas that have projects, and whose Today is split into Signal and Noise. */
export const projectAreas = ["aya", "work"] as const;
/** When in the day a Life task is for: its card in Life's Today. New ones go in Day. */
export const timesOfDay = ["morning", "day", "evening"] as const;
/** Which card an Aya or Work task sits in on its Today: Signal (what matters) or Noise. New ones go in Noise. */
export const lanes = ["signal", "noise"] as const;
export const repeats = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
export const repeatUnits = ["days", "weeks", "months", "years"] as const;
/** A repeat with a gap: "every_2_days" is every other day, "every_3_weeks" every three weeks. */
export const repeatEvery = /^every_(\d{1,3})_(days|weeks|months|years)$/;
/** Luke's own lists for when he'll get to a task. Set by hand; they have nothing to do with the due date. */
export const buckets = ["today", "tomorrow", "this_week", "later"] as const;
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type Effort = (typeof efforts)[number];
export type Area = (typeof areas)[number];
export type ProjectArea = (typeof projectAreas)[number];
export type TimeOfDay = (typeof timesOfDay)[number];
export type Lane = (typeof lanes)[number];
export type RepeatUnit = (typeof repeatUnits)[number];
export type Repeat = (typeof repeats)[number] | `every_${number}_${RepeatUnit}`;
export type Bucket = (typeof buckets)[number];

export const statusLabel: Record<Status, string> = { todo: "To do", doing: "Doing", done: "Done" };
export const priorityLabel: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };
export const effortLabel: Record<Effort, string> = { shallow: "Shallow", focus: "Focus", deep: "Deep work" };
/** Older names for the focus types, still accepted from anything that sends them. */
export const oldEfforts: Record<string, Effort> = { small: "shallow", medium: "focus", large: "deep" };
export const areaLabel: Record<Area, string> = { aya: "Aya", work: "Work", life: "Life" };
/** Aya and Work work the same way (projects, focus type, Signal and Noise); Life keeps it simple. */
export function isProjectArea(area: Area): area is ProjectArea {
  return area !== "life";
}
/** How many flames a priority shows. */
export const priorityFlames: Record<Priority, number> = { low: 1, medium: 2, high: 3 };
export const timeOfDayLabel: Record<TimeOfDay, string> = { morning: "Morning", day: "Day", evening: "Evening" };
export const laneLabel: Record<Lane, string> = { signal: "Signal", noise: "Noise" };
export const repeatLabel: Record<(typeof repeats)[number], string> = {
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
};
/** The gap and unit of a repeat: "weekly" is 1 week, "every_3_days" is 3 days. Weekdays has none. */
export function repeatStep(repeat: Repeat): { n: number; unit: RepeatUnit } | null {
  const base: Partial<Record<string, RepeatUnit>> = { daily: "days", weekly: "weeks", monthly: "months", yearly: "years" };
  if (base[repeat]) return { n: 1, unit: base[repeat] };
  const m = repeatEvery.exec(repeat);
  return m ? { n: Number(m[1]), unit: m[2] as RepeatUnit } : null;
}

/** A repeat every `n` days, weeks, months or years, using the plain names for a gap of one. */
export function repeatOf(n: number, unit: RepeatUnit): Repeat {
  if (n === 1) return ({ days: "daily", weeks: "weekly", months: "monthly", years: "yearly" } as const)[unit];
  return `every_${n}_${unit}`;
}

/** "Every day", "Every other week", "Every 3 days". */
export function repeatName(repeat: Repeat) {
  if (repeat in repeatLabel) return repeatLabel[repeat as (typeof repeats)[number]];
  const step = repeatStep(repeat);
  if (!step) return "Repeats";
  const unit = step.unit.slice(0, -1);
  return step.n === 2 && (unit === "day" || unit === "week") ? `Every other ${unit}` : `Every ${step.n} ${step.unit}`;
}

/** A repeat value from outside (a tool call, an old row), tidied, or null if it isn't one. */
export function toRepeat(value: string): Repeat | null {
  if ((repeats as readonly string[]).includes(value)) return value as Repeat;
  const m = repeatEvery.exec(value);
  if (!m || Number(m[1]) < 1) return null;
  return repeatOf(Number(m[1]), m[2] as RepeatUnit);
}

export const bucketLabel: Record<Bucket, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This week",
  later: "Later",
};

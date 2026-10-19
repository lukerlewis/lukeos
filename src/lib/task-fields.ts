/** The choices for a task's fields, and how they're shown. Shared by the app and its operations. */

export const statuses = ["todo", "doing", "done"] as const;
export const priorities = ["low", "medium", "high"] as const;
/** The kind of attention a task needs (shown as "Focus type"). Stored in the task's `effort` field. */
export const efforts = ["shallow", "focus", "deep"] as const;
/** Work or Life. Every task and project is in one; Work holds Luke's work projects. */
export const areas = ["work", "life"] as const;
/** When in the day a Life task is for: its card in Life's Today. New ones go in Day. */
export const timesOfDay = ["morning", "day", "evening"] as const;
export const repeats = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
/** Luke's own lists for when he'll get to a task. Set by hand; they have nothing to do with the due date. */
export const buckets = ["today", "tomorrow", "this_week", "later"] as const;
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type Effort = (typeof efforts)[number];
export type Area = (typeof areas)[number];
export type TimeOfDay = (typeof timesOfDay)[number];
export type Repeat = (typeof repeats)[number];
export type Bucket = (typeof buckets)[number];

export const statusLabel: Record<Status, string> = { todo: "To do", doing: "Doing", done: "Done" };
export const priorityLabel: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };
export const effortLabel: Record<Effort, string> = { shallow: "Shallow", focus: "Focus", deep: "Deep work" };
/** Older names for the focus types, still accepted from anything that sends them. */
export const oldEfforts: Record<string, Effort> = { small: "shallow", medium: "focus", large: "deep" };
export const areaLabel: Record<Area, string> = { work: "Work", life: "Life" };
/** How many flames a priority shows. */
export const priorityFlames: Record<Priority, number> = { low: 1, medium: 2, high: 3 };
export const timeOfDayLabel: Record<TimeOfDay, string> = { morning: "Morning", day: "Day", evening: "Evening" };
export const repeatLabel: Record<Repeat, string> = {
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
};
export const bucketLabel: Record<Bucket, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This week",
  later: "Later",
};

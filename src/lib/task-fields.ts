/** The choices for a task's fields, and how they're shown. Shared by the app and its operations. */

export const statuses = ["todo", "doing", "done"] as const;
export const priorities = ["low", "medium", "high"] as const;
export const efforts = ["small", "medium", "large"] as const;
export const repeats = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
/** Luke's own lists for when he'll get to a task. Set by hand; they have nothing to do with the due date. */
export const buckets = ["today", "tomorrow", "this_week", "later"] as const;
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type Effort = (typeof efforts)[number];
export type Repeat = (typeof repeats)[number];
export type Bucket = (typeof buckets)[number];

export const statusLabel: Record<Status, string> = { todo: "To do", doing: "Doing", done: "Done" };
export const priorityLabel: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };
export const effortLabel: Record<Effort, string> = { small: "Small", medium: "Medium", large: "Large" };
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

/** The choices for a task's fields, and how they're shown. Shared by the app and its operations. */

export const statuses = ["todo", "doing", "done"] as const;
export const priorities = ["low", "medium", "high"] as const;
export const efforts = ["small", "medium", "large"] as const;
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type Effort = (typeof efforts)[number];

export const statusLabel: Record<Status, string> = { todo: "To do", doing: "Doing", done: "Done" };
export const priorityLabel: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };
export const effortLabel: Record<Effort, string> = { small: "Small", medium: "Medium", large: "Large" };

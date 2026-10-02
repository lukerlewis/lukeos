/**
 * The board's columns and what moving a card between them means. Shared by
 * the board screen and the get_board / move_task operations, so a drag in the
 * app and a move by Claude do exactly the same thing.
 */
import type { Task } from "@/core/tasks";
import { whenOf } from "./dates";
import { bucketLabel, buckets, statuses, statusLabel, type Bucket, type Status } from "./task-fields";

/** "when" sorts cards into Luke's lists (Today, Tomorrow, This week, Later); "status" by To do, Doing, Done. */
export const boardViews = ["when", "status"] as const;
export type BoardView = (typeof boardViews)[number];

export const whenColumns = buckets;
export type WhenColumn = Bucket;
export type ColumnId = WhenColumn | Status;
export const columnIds = [...whenColumns, ...statuses] as const;

export type Column = { id: ColumnId; title: string };

/** The columns for a view. When grouping by status, only the statuses in `show` get a column. */
export function columnsFor(view: BoardView, show: readonly Status[] = statuses): Column[] {
  if (view === "status") return statuses.filter((s) => show.includes(s)).map((s) => ({ id: s, title: statusLabel[s] }));
  return buckets.map((b) => ({ id: b, title: bucketLabel[b] }));
}

type Placeable = Pick<Task, "bucket" | "status">;

/** The column a task sits in: its list, or its status. The due date plays no part. */
export function columnOf(task: Placeable, view: BoardView): ColumnId {
  return view === "status" ? task.status : task.bucket;
}

/**
 * What changes when a task moves to a column, or null if it's already there.
 * List columns set the list (never the due date); status columns set the status.
 */
export function changesForMove(task: Placeable, to: ColumnId): { bucket: Bucket } | { status: Status } | null {
  if ((statuses as readonly string[]).includes(to)) {
    return task.status === to ? null : { status: to as Status };
  }
  return task.bucket === to ? null : { bucket: to as Bucket };
}

/**
 * The list a due date points to (Today if there's no date). Only used when a task is first made (or a
 * repeat's next one); after that the list and the date are separate.
 */
export function bucketForDate(dueDate: string | null, today: string): Bucket {
  const when = whenOf(dueDate, today);
  if (when === "none" || when === "overdue" || when === "today") return "today";
  if (when === "tomorrow") return "tomorrow";
  if (when === "week") return "this_week";
  return "later";
}

const statusRank: Record<Status, number> = { doing: 0, todo: 1, done: 2 };
const priorityRank = { high: 0, medium: 1, low: 2 } as const;

/** Card order within a column: Doing, To do, then Done; soonest due; highest priority; oldest. */
export function compareTasks(a: Task, b: Task) {
  return (
    statusRank[a.status] - statusRank[b.status] ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    (a.priority ? priorityRank[a.priority] : 3) - (b.priority ? priorityRank[b.priority] : 3) ||
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

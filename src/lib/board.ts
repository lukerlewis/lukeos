/**
 * The board's columns and what moving a card between them means. Shared by
 * the board screen and the get_board / move_task operations, so a drag in the
 * app and a move by Claude do exactly the same thing.
 */
import type { Task } from "@/core/tasks";
import { addDays, dayAndMonth, weekdayDayAndMonth, whenOf, whenWindows } from "./dates";
import { statuses, statusLabel, type Status } from "./task-fields";

/** "when" sorts cards by due date (Today, This week...); "status" by To do, Doing, Done. */
export const boardViews = ["when", "status"] as const;
export type BoardView = (typeof boardViews)[number];

export const whenColumns = ["today", "this_week", "this_month", "later"] as const;
export type WhenColumn = (typeof whenColumns)[number];
export type ColumnId = WhenColumn | Status;
export const columnIds = [...whenColumns, ...statuses] as const;

export type Column = { id: ColumnId; title: string; hint?: string };

/** The columns for a view. When grouping by status, only the statuses in `show` get a column. */
export function columnsFor(view: BoardView, today: string, show: readonly Status[] = statuses): Column[] {
  if (view === "status") return statuses.filter((s) => show.includes(s)).map((s) => ({ id: s, title: statusLabel[s] }));
  const { weekEnd, monthEnd } = whenWindows(today);
  return [
    { id: "today", title: "Today", hint: "And anything late" },
    { id: "this_week", title: "This week", hint: `Until ${weekdayDayAndMonth(weekEnd)}` },
    { id: "this_month", title: "This month", hint: `${dayAndMonth(addDays(weekEnd, 1))} to ${dayAndMonth(monthEnd)}` },
    { id: "later", title: "Later", hint: `After ${dayAndMonth(monthEnd)}, or no date` },
  ];
}

type Placeable = Pick<Task, "dueDate" | "status">;

/** The column a task sits in. Late tasks sit in Today; tasks with no date sit in Later. */
export function columnOf(task: Placeable, view: BoardView, today: string): ColumnId {
  if (view === "status") return task.status;
  switch (whenOf(task.dueDate, today)) {
    case "overdue":
    case "today":
      return "today";
    case "week":
      return "this_week";
    case "month":
      return "this_month";
    default:
      return "later";
  }
}

/**
 * What changes when a task moves to a column, or null if it's already there.
 * Today sets the due date to today; This week and This month set it to the
 * last day of that stretch; Later clears it. Status columns set the status.
 */
export function changesForMove(
  task: Placeable,
  to: ColumnId,
  today: string,
): { dueDate: string | null } | { status: Status } | null {
  if ((statuses as readonly string[]).includes(to)) {
    return task.status === to ? null : { status: to as Status };
  }
  if (columnOf(task, "when", today) === to) return null;
  const { weekEnd, monthEnd } = whenWindows(today);
  const dueDate = { today, this_week: weekEnd, this_month: monthEnd, later: null }[to as WhenColumn];
  return { dueDate };
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

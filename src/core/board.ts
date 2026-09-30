import "server-only";
import { z } from "zod";
import { boardViews, changesForMove, columnIds, columnOf, columnsFor, compareTasks, type BoardView } from "@/lib/board";
import { todayIn } from "@/lib/dates";
import { defineOperation } from "./define";
import { assertProject } from "./projects";
import { getTimeZone } from "./settings";
import { getTask, listTasks, taskOperations, type Task } from "./tasks";

/**
 * The tasks a board shows. Open tasks always; done ones only while they're
 * fresh: finished today on the "when" board, the 30 most recent in the Done
 * column of the status board.
 */
export async function boardTasks(view: BoardView, projectId?: string) {
  const timeZone = await getTimeZone();
  const date = todayIn(timeZone);
  const [open, done] = await Promise.all([
    listTasks({ projectId }),
    listTasks({ projectId, status: "done", limit: 200 }),
  ]);
  const recentDone = done
    .filter((t) => t.completedAt)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
  const shownDone =
    view === "status" ? recentDone.slice(0, 30) : recentDone.filter((t) => todayIn(timeZone, t.completedAt!) === date);
  return { date, tasks: [...open, ...shownDone] };
}

export async function getBoard(view: BoardView, projectId?: string) {
  const { date, tasks } = await boardTasks(view, projectId);
  const columns = columnsFor(view, date).map((c) => ({
    ...c,
    tasks: tasks.filter((t) => columnOf(t, view, date) === c.id).sort(compareTasks),
  }));
  return { today: date, view, columns };
}

const moveTargets = columnIds.map((id) => `"${id}"`).join(", ");

export const boardOperations = {
  get_board: defineOperation({
    name: "get_board",
    description:
      'Luke\'s task board, column by column. view "when" (the default) has columns Today (including late tasks), This week, This month and Later (after this month, or no due date). view "status" has To do, Doing and Done. Done tasks only show while fresh: finished today, or the 30 most recent in the Done column.',
    input: z.object({
      view: z.enum(boardViews).optional().describe('"when" (default) or "status".'),
      projectId: z.uuid().optional().describe("Only this project's tasks. Leave out for every project."),
    }),
    run: async ({ view, projectId }) => {
      if (projectId) await assertProject(projectId);
      return getBoard(view ?? "when", projectId);
    },
  }),

  move_task: defineOperation({
    name: "move_task",
    description: `Move a task to a board column, just like dragging its card. One of: ${moveTargets}. today sets the due date to today; this_week to the last day of this week; this_month to the last day of the month; later clears the due date. todo, doing and done set the status. Moving to the column it's already in changes nothing. To pick an exact due date instead, use update_task.`,
    input: z.object({
      id: z.uuid().describe("The task's id."),
      to: z.enum(columnIds),
    }),
    run: async ({ id, to }, ctx): Promise<{ moved: boolean; task: Task }> => {
      const task = await getTask(id);
      const timeZone = await getTimeZone();
      const changes = changesForMove(task, to, todayIn(timeZone));
      if (!changes) return { moved: false, task };
      return { moved: true, task: await taskOperations.update_task.run({ id, ...changes }, ctx) };
    },
  }),
};

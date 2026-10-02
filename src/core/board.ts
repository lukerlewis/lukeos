import "server-only";
import { z } from "zod";
import { boardViews, changesForMove, columnIds, columnOf, columnsFor, compareTasks, type BoardView } from "@/lib/board";
import { todayIn } from "@/lib/dates";
import { statuses, type Status } from "@/lib/task-fields";
import { defineOperation } from "./define";
import { assertProject } from "./projects";
import { getTimeZone } from "./settings";
import { getTask, listTasks, taskOperations, type Task } from "./tasks";

/**
 * The tasks a board shows, limited to the statuses in `show` (all of them if
 * left out). Done ones only while they're fresh: finished today when grouped
 * by when, the 30 most recent when grouped by status.
 */
export async function boardTasks(view: BoardView, projectId?: string, show: readonly Status[] = statuses) {
  const timeZone = await getTimeZone();
  const date = todayIn(timeZone);
  const [allOpen, done] = await Promise.all([
    show.includes("todo") || show.includes("doing") ? listTasks({ projectId }) : [],
    show.includes("done") ? listTasks({ projectId, status: "done", limit: 200 }) : [],
  ]);
  const open = allOpen.filter((t) => show.includes(t.status));
  const recentDone = done
    .filter((t) => t.completedAt)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
  const shownDone =
    view === "status" ? recentDone.slice(0, 30) : recentDone.filter((t) => todayIn(timeZone, t.completedAt!) === date);
  return { date, tasks: [...open, ...shownDone] };
}

export async function getBoard(view: BoardView, projectId?: string, show: readonly Status[] = statuses) {
  const { date, tasks } = await boardTasks(view, projectId, show);
  const columns = columnsFor(view, show).map((c) => ({
    ...c,
    tasks: tasks.filter((t) => columnOf(t, view) === c.id).sort(compareTasks),
  }));
  return { today: date, view, columns };
}

export const showField = z.array(z.enum(statuses)).min(1, "Show at least one status.");

const moveTargets = columnIds.map((id) => `"${id}"`).join(", ");

export const boardOperations = {
  get_board: defineOperation({
    name: "get_board",
    description:
      'Luke\'s task board, column by column. view "when" (the default) has Luke\'s lists: Today, Tomorrow, This week and Later. He puts tasks in these by hand; they have nothing to do with due dates, and tasks never move between them on their own. view "status" has To do, Doing and Done. Done tasks only show while fresh: finished today, or the 30 most recent in the Done column. Use show to leave out some statuses.',
    input: z.object({
      view: z.enum(boardViews).optional().describe('"when" (default) or "status".'),
      projectId: z.uuid().optional().describe("Only this project's tasks. Leave out for every project."),
      show: showField.optional().describe("Only tasks with these statuses. Leave out for all of them."),
    }),
    run: async ({ view, projectId, show }) => {
      if (projectId) await assertProject(projectId);
      return getBoard(view ?? "when", projectId, show);
    },
  }),

  move_task: defineOperation({
    name: "move_task",
    description: `Move a task to a board column, just like dragging its card. One of: ${moveTargets}. today, tomorrow, this_week and later put it in that list and leave its due date alone. todo, doing and done set the status. Moving to the column it's already in changes nothing. To set a due date, use update_task.`,
    input: z.object({
      id: z.uuid().describe("The task's id."),
      to: z.enum(columnIds),
    }),
    run: async ({ id, to }, ctx): Promise<{ moved: boolean; task: Task }> => {
      const task = await getTask(id);
      const changes = changesForMove(task, to);
      if (!changes) return { moved: false, task };
      return { moved: true, task: await taskOperations.update_task.run({ id, ...changes }, ctx) };
    },
  }),
};

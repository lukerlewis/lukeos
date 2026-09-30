import Link from "next/link";
import { Board } from "@/components/board/board";
import { DashboardControls } from "@/components/dashboard/controls";
import { activityDays } from "@/components/from-claude/activity-days";
import { ActivityList } from "@/components/from-claude/activity-list";
import { Greeting, TodayDate } from "@/components/greeting";
import { QuickNote } from "@/components/notes/quick-note";
import { EmptyState, Page } from "@/components/shell/page";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card, CardHeader } from "@/components/ui/card";
import { listActivity } from "@/core/activity";
import { boardTasks } from "@/core/board";
import { getDashboardView } from "@/core/dashboard";
import { getTimeZone } from "@/core/settings";
import { columnOf, compareTasks } from "@/lib/board";
import type { DashboardView } from "@/lib/dashboard";
import { statusLabel, type Status } from "@/lib/task-fields";

export default async function DashboardPage() {
  const view = await getDashboardView();
  const board = view.layout === "board";
  const [{ date, tasks }, activity, timeZone] = await Promise.all([
    boardTasks("when", undefined, view.show),
    // The board is only the board; the other cards are on the Today tab.
    board ? [] : listActivity({ limit: 8 }),
    getTimeZone(),
  ]);

  return (
    <Page title="Dashboard" eyebrow={<TodayDate />} heading={<Greeting />}>
      <DashboardControls view={view} />
      {board ? (
        <Board tasks={tasks} view="when" today={date} show={view.show} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TodayTasks tasks={tasks.filter((t) => columnOf(t, "when", date) === "today")} view={view} today={date} />
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader title="Quick note" />
              <QuickNote />
            </Card>
            <Card>
              <CardHeader
                title="Agents"
                aside={
                  <Link href="/agents?view=activity" className="hover:text-foreground">
                    See all
                  </Link>
                }
              />
              {activity.length === 0 ? (
                <EmptyState>When Claude adds, edits or moves something, it shows up here.</EmptyState>
              ) : (
                <ActivityList days={activityDays(activity, timeZone)} />
              )}
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}

/** The Today tab: only tasks due today or late. Everything later is on the Board. */
function TodayTasks({
  tasks,
  view,
  today,
}: {
  tasks: Awaited<ReturnType<typeof boardTasks>>["tasks"];
  view: DashboardView;
  today: string;
}) {
  const hidden = (["todo", "doing", "done"] as Status[]).filter((s) => !view.show.includes(s));
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <h2 className="text-sm font-semibold">Today</h2>
          <span className="text-xs text-muted-foreground">{tasks.length}</span>
          <span className="ml-auto truncate text-xs text-muted-foreground">And anything late</span>
        </div>
        <TaskList tasks={[...tasks].sort(compareTasks)} today={today} empty={<EmptyState>Nothing due today.</EmptyState>} />
        {/* "Add a task" makes a To do task, so it only shows while To do tasks do. */}
        {view.show.includes("todo") && <QuickAdd dueDate={today} placeholder="Add a task for today" />}
      </Card>
      {hidden.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {hidden.map((s) => statusLabel[s]).join(" and ")} tasks are hidden. Turn them on in Filters to see them.
        </p>
      )}
    </div>
  );
}

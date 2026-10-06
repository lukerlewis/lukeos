import Link from "next/link";
import { Board } from "@/components/board/board";
import { DashboardControls } from "@/components/dashboard/controls";
import { activityDays } from "@/components/from-claude/activity-days";
import { ActivityList } from "@/components/from-claude/activity-list";
import { DoneTags } from "@/components/notes/done-tags";
import { ScratchPad } from "@/components/notes/scratch-pad-lazy";
import { Greeting, TodayDate } from "@/components/greeting";
import { EmptyState, Page } from "@/components/shell/page";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card, CardHeader } from "@/components/ui/card";
import { listActivity } from "@/core/activity";
import { boardTasks } from "@/core/board";
import { getDashboardView } from "@/core/dashboard";
import { doneMentionIds } from "@/core/mentions";
import { getScratchPad } from "@/core/notes";
import { getTimeZone } from "@/core/settings";
import { compareTasks } from "@/lib/board";
import type { DashboardView } from "@/lib/dashboard";

export default async function DashboardPage() {
  const view = await getDashboardView();
  const board = view.layout === "board";
  const [{ date, tasks }, activity, scratch, timeZone] = await Promise.all([
    boardTasks("when", undefined, view.show),
    // The board is only the board; the other cards are on the Today tab.
    board ? [] : listActivity({ limit: 8 }),
    board ? null : getScratchPad(),
    getTimeZone(),
  ]);
  const doneTags = scratch ? await doneMentionIds("note", scratch.id) : [];

  return (
    <Page title="Dashboard" eyebrow={<TodayDate />} heading={<Greeting />} addNew>
      <DashboardControls view={view} />
      {board ? (
        <Board tasks={tasks} view="when" today={date} show={view.show} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TodayTasks tasks={tasks.filter((t) => t.bucket === "today")} view={view} today={date} />
          <div className="flex flex-col gap-6">
            {scratch && (
              <Card>
                <DoneTags ids={doneTags} />
                <CardHeader
                  title="Scratch pad"
                  aside={
                    <Link href="/agents?view=claude" className="hover:text-foreground">
                      @claude requests
                    </Link>
                  }
                />
                <ScratchPad id={scratch.id} content={scratch.content} />
              </Card>
            )}
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
                <EmptyState>Nothing yet.</EmptyState>
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

/** The Today tab: only the tasks in the Today list. The other lists are on the Board. */
function TodayTasks({
  tasks,
  view,
  today,
}: {
  tasks: Awaited<ReturnType<typeof boardTasks>>["tasks"];
  view: DashboardView;
  today: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <h2 className="text-sm font-medium">Today</h2>
          <span className="text-meta text-muted-foreground">{tasks.length}</span>
        </div>
        <TaskList tasks={[...tasks].sort(compareTasks)} today={today} empty={<EmptyState>Nothing for today.</EmptyState>} />
        {/* "Add a task" makes a To do task, so it only shows while To do tasks do. */}
        {view.show.includes("todo") && <QuickAdd bucket="today" today={today} placeholder="Add a task for today" />}
      </Card>
    </div>
  );
}

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { Board } from "@/components/board/board";
import { DashboardControls } from "@/components/dashboard/controls";
import { activityDays } from "@/components/from-claude/activity-days";
import { ActivityList } from "@/components/from-claude/activity-list";
import { DoneTags } from "@/components/notes/done-tags";
import { ScratchPad } from "@/components/notes/scratch-pad-lazy";
import { Greeting, TodayDate } from "@/components/greeting";
import { EmptyState, Page } from "@/components/shell/page";
import { WorkBoard, WorkToday } from "@/components/dashboard/work-today";
import { QuickAdd, TaskList } from "@/components/tasks/task-list";
import { Card, CardHeader } from "@/components/ui/card";
import { listActivity } from "@/core/activity";
import { boardTasks } from "@/core/board";
import { getDashboardView } from "@/core/dashboard";
import { doneMentionIds } from "@/core/mentions";
import { getScratchPad } from "@/core/notes";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { colorHex } from "@/lib/project-colors";
import { AREA_COOKIE, defaultAreaFor, parseArea } from "@/lib/area";
import { sortTasks } from "@/lib/board";
import type { DashboardView } from "@/lib/dashboard";
import type { Area } from "@/lib/task-fields";

export default async function DashboardPage() {
  const view = await getDashboardView();
  const board = view.layout === "board";
  // Work or Life is picked on each device: computers start on Work, phones on Life.
  const area = parseArea((await cookies()).get(AREA_COOKIE)?.value) ?? defaultAreaFor((await headers()).get("user-agent"));
  const [{ date, tasks }, activity, scratch, timeZone, projects] = await Promise.all([
    boardTasks("when", undefined, view.show, area),
    // The board is only the board; the other cards are on the Today tab.
    board ? [] : listActivity({ limit: 8 }),
    board ? null : getScratchPad(),
    getTimeZone(),
    area === "work" ? listProjects() : [],
  ]);
  const workProjects = projects.map((p) => ({ id: p.id, name: p.name, color: p.color, hex: colorHex(p.color) }));
  const doneTags = scratch ? await doneMentionIds("note", scratch.id) : [];

  return (
    <Page title="Dashboard" eyebrow={<TodayDate />} heading={<Greeting />} addNew>
      <DashboardControls view={view} area={area} />
      {board ? (
        area === "work" ? (
          <WorkBoard tasks={tasks} projects={workProjects} today={date} show={view.show} />
        ) : (
          <Board tasks={tasks} view="when" today={date} show={view.show} />
        )
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {area === "work" ? (
            <WorkToday
              tasks={sortTasks(
                tasks.filter((t) => t.bucket === "today"),
                view.sort,
              )}
              projects={workProjects}
              canAdd={view.show.includes("todo")}
              today={date}
            />
          ) : (
            <TodayTasks tasks={tasks.filter((t) => t.bucket === "today")} view={view} area={area} today={date} />
          )}
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
  area,
  today,
}: {
  tasks: Awaited<ReturnType<typeof boardTasks>>["tasks"];
  view: DashboardView;
  area: Area;
  today: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <h2 className="text-sm font-medium">Today</h2>
          <span className="text-meta text-muted-foreground">{tasks.length}</span>
        </div>
        <TaskList tasks={sortTasks(tasks, view.sort)} today={today} empty={<EmptyState>Nothing for today.</EmptyState>} />
        {/* "Add a task" makes a To do task, so it only shows while To do tasks do. */}
        {view.show.includes("todo") && <QuickAdd bucket="today" area={area} today={today} placeholder={area === "life" ? "Add to Life" : "Add to Work"} />}
      </Card>
    </div>
  );
}

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
import { LifeToday } from "@/components/dashboard/life-today";
import { WorkBoard, WorkToday } from "@/components/dashboard/work-today";
import { Card, CardHeader } from "@/components/ui/card";
import { listActivity } from "@/core/activity";
import { boardTasks } from "@/core/board";
import { getDashboardView } from "@/core/dashboard";
import { doneMentionIds } from "@/core/mentions";
import { getScratchPad } from "@/core/notes";
import { listProjects } from "@/core/projects";
import { getTimeZone } from "@/core/settings";
import { DASHBOARD_AGENTS_ON } from "@/lib/features";
import { colorHex } from "@/lib/project-colors";
import { AREA_COOKIE, areaFor } from "@/lib/area";
import { sortTasks } from "@/lib/board";
import { isProjectArea } from "@/lib/task-fields";

export default async function DashboardPage() {
  const view = await getDashboardView();
  const board = view.layout === "board";
  // Aya, Work or Life is picked on each device: computers start on Work, phones on Life.
  // Aya is for computers only.
  const area = areaFor((await cookies()).get(AREA_COOKIE)?.value, (await headers()).get("user-agent"));
  const [{ date, tasks }, activity, scratch, timeZone, projects] = await Promise.all([
    boardTasks("when", undefined, view.show, area),
    // The board is only the board; the other cards are on the Today tab.
    board || !DASHBOARD_AGENTS_ON ? [] : listActivity({ limit: 8 }),
    board ? null : getScratchPad(),
    getTimeZone(),
    isProjectArea(area) ? listProjects() : [],
  ]);
  const areaProjects = projects
    .filter((p) => p.area === area)
    .map((p) => ({ id: p.id, name: p.name, color: p.color, hex: colorHex(p.color) }));
  const doneTags = scratch ? await doneMentionIds("note", scratch.id) : [];

  // The Scratch pad and Agents cards, beside the Today card. Agents is on ice for now.
  const side = (
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
      {DASHBOARD_AGENTS_ON && (
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
      )}
    </div>
  );

  return (
    <Page
      title="Dashboard"
      eyebrow={<TodayDate />}
      heading={<Greeting />}
      addNew
      fill={board && "phone"}
      // Computers put the switches beside the greeting; phones keep them on their own row below it.
      actions={
        <div className="hidden md:block">
          <DashboardControls view={view} area={area} />
        </div>
      }
    >
      <div className="md:hidden">
        <DashboardControls view={view} area={area} />
      </div>
      {board ? (
        isProjectArea(area) ? (
          <WorkBoard tasks={tasks} projects={areaProjects} area={area} today={date} show={view.show} sort={view.sort} />
        ) : (
          <Board tasks={tasks} view="when" today={date} show={view.show} sort={view.sort} area={area} fill />
        )
      ) : isProjectArea(area) ? (
        // Aya and Work put their project chips above both columns, so the Today card lines up with the Scratch pad.
        <WorkToday
          tasks={sortTasks(
            tasks.filter((t) => t.bucket === "today"),
            view.sort,
          )}
          projects={areaProjects}
          area={area}
          show={view.show}
          canAdd={view.show.includes("todo")}
          today={date}
          side={side}
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Life's Today is split into Morning, Day and Evening. */}
          <LifeToday
            tasks={tasks.filter((t) => t.bucket === "today")}
            today={date}
            sort={view.sort}
            show={view.show}
            canAdd={view.show.includes("todo")}
          />
          {side}
        </div>
      )}
    </Page>
  );
}

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { activityDays } from "@/components/from-claude/activity-days";
import { ActivityList } from "@/components/from-claude/activity-list";
import { DoneTags } from "@/components/notes/done-tags";
import { ScratchPad } from "@/components/notes/scratch-pad-lazy";
import { EmptyState } from "@/components/shell/page";
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

export default async function DashboardPage() {
  const view = await getDashboardView();
  // Aya, Work or Life is picked on each device: computers start on Work, phones on Life.
  const area = areaFor((await cookies()).get(AREA_COOKIE)?.value, (await headers()).get("user-agent"));
  // Every area's tasks and both tabs come at once, so switching between them is instant.
  const [{ date, tasks }, activity, scratch, timeZone, projects] = await Promise.all([
    boardTasks("when", undefined, view.show),
    DASHBOARD_AGENTS_ON ? listActivity({ limit: 8 }) : [],
    getScratchPad(),
    getTimeZone(),
    listProjects(),
  ]);
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
    <DashboardScreen
      view={view}
      area={area}
      tasks={tasks}
      projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color, hex: colorHex(p.color), area: p.area }))}
      today={date}
      side={side}
    />
  );
}

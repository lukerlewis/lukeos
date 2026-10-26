"use client";

import { AudioWaveform, CalendarDays, Signal, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Task } from "@/core/tasks";
import type { DashboardSort } from "@/lib/dashboard";
import { areaLabel, laneLabel, lanes, type Lane, type ProjectArea, type Status } from "@/lib/task-fields";
import { Board } from "@/components/board/board";
import { QuickAdd, TaskList, type CellProject } from "@/components/tasks/task-list";
import { Card } from "@/components/ui/card";
import { countByProject, ProjectChips } from "@/components/ui/project-chips";
import { useLiveTasks } from "@/lib/live-tasks";
import { DraggableRow, DropCard, TaskCards } from "./task-cards";

const laneIcon: Record<Lane, LucideIcon> = { signal: Signal, noise: AudioWaveform };

/**
 * Aya's or Work's Today: chips to show only some of its projects (any number at once), then the tasks. Work splits them into two cards, Signal (what really matters)
 * on top and Noise. New tasks go in Noise; drag one to the other card to move it (press and hold on a phone). Aya keeps them all in one Today card.
 * Computers show the tasks as a table (focus type, priority, name, project); phones get plain rows without chips.
 */
export function WorkToday({
  tasks,
  projects,
  area,
  show,
  canAdd,
  today,
  side,
}: {
  tasks: Task[];
  projects: CellProject[];
  area: ProjectArea;
  /** The statuses the dashboard shows. */
  show: Status[];
  canAdd: boolean;
  today: string;
  /** The cards beside the Today card (Scratch pad, Agents), lined up with its top. */
  side: React.ReactNode;
}) {
  // A task just added or changed in the task box shows (or leaves) at once.
  const fits = (t: Task) => t.area === area && t.bucket === "today" && show.includes(t.status);
  const filter = useProjectFilter(useLiveTasks(tasks, fits), projects);

  return (
    <div className="flex flex-col gap-3">
      <ProjectFilter tasks={tasks} projects={projects} area={area} picked={filter.picked} onPick={filter.setPicked} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {area === "aya" ? (
          <Card aria-label="Today">
            <div className="flex items-center gap-2 border-b px-4 py-3.5">
              <CalendarDays className="size-[18px] text-icon" aria-hidden />
              <h2 className="text-heading font-medium">Today</h2>
              <span className="text-meta text-muted-foreground">{filter.shown.length}</span>
            </div>
            {filter.shown.length > 0 && (
              <TaskList tasks={filter.shown} today={today} columns projects={projects} />
            )}
            {canAdd && <QuickAdd bucket="today" area={area} projectId={filter.only} today={today} placeholder="Add to Today" />}
          </Card>
        ) : (
          <TaskCards tasks={filter.shown} field="lane" labels={laneLabel} fits={fits}>
            {(items) => (
              <div className="flex flex-col gap-6">
                {lanes.map((lane) => {
                  const here = items.filter((t) => t.lane === lane);
                  return (
                    <DropCard key={lane} id={lane} label={laneLabel[lane]} icon={laneIcon[lane]} count={here.length}>
                      {here.length > 0 && (
                        <TaskList
                          tasks={here}
                          today={today}
                          columns
                          projects={projects}
                          row={(t) => <DraggableRow task={t} today={today} columns projects={projects} />}
                        />
                      )}
                      {/* "Add a task" makes a To do task, so it only shows while To do tasks do. A lone picked project gets it. */}
                      {canAdd && (
                        <QuickAdd
                          bucket="today"
                          area={area}
                          lane={lane}
                          projectId={filter.only}
                          today={today}
                          placeholder={`Add to ${laneLabel[lane]}`}
                        />
                      )}
                    </DropCard>
                  );
                })}
              </div>
            )}
          </TaskCards>
        )}
        {side}
      </div>
    </div>
  );
}

/** Aya's or Work's Board: the same project chips above it, then the columns. */
export function WorkBoard({
  tasks,
  projects,
  area,
  today,
  show,
  sort,
}: {
  tasks: Task[];
  projects: CellProject[];
  area: ProjectArea;
  today: string;
  show: Status[];
  sort: DashboardSort;
}) {
  const filter = useProjectFilter(tasks, projects);
  return (
    <div className="flex grow flex-col gap-3">
      <ProjectFilter tasks={tasks} projects={projects} area={area} picked={filter.picked} onPick={filter.setPicked} />
      <Board
        tasks={filter.shown}
        view="when"
        today={today}
        show={show}
        sort={sort}
        projectId={filter.only ?? undefined}
        area={area}
        fill
      />
    </div>
  );
}

/**
 * The picked projects (none picked shows the whole area) and the tasks they leave showing.
 * New tasks only get a project when exactly one is picked.
 */
function useProjectFilter(tasks: Task[], projects: CellProject[]) {
  const [chosen, setPicked] = useState<string[]>([]);
  // Projects that are gone since they were picked drop out; if none are left, everything shows again.
  const picked = chosen.filter((id) => projects.some((p) => p.id === id));
  const shown = picked.length ? tasks.filter((t) => t.project && picked.includes(t.project.id)) : tasks;
  const only = picked.length === 1 ? picked[0] : null;
  return { picked, setPicked, shown, only };
}

/** Chips to show only some projects' tasks, on computers; tap several to show them together. Projects with no tasks here stay out of the way. */
function ProjectFilter({
  tasks,
  projects,
  area,
  picked,
  onPick,
}: {
  tasks: Task[];
  projects: CellProject[];
  area: ProjectArea;
  picked: string[];
  onPick: (ids: string[]) => void;
}) {
  return (
    <ProjectChips
      projects={projects}
      counts={countByProject(tasks.map((t) => t.project?.id))}
      total={tasks.length}
      picked={picked}
      onPick={onPick}
      allLabel={`All ${area === "work" ? "work" : areaLabel[area]}`}
      label={`${areaLabel[area]} projects`}
      className="hidden md:flex"
    />
  );
}

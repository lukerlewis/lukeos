"use client";

import { AudioWaveform, Signal, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Task } from "@/core/tasks";
import type { DashboardSort } from "@/lib/dashboard";
import { areaLabel, laneLabel, lanes, type Lane, type ProjectArea, type Status } from "@/lib/task-fields";
import { Board } from "@/components/board/board";
import { QuickAdd, TaskList, type CellProject } from "@/components/tasks/task-list";
import { cn } from "@/lib/utils";
import { DraggableRow, DropCard, TaskCards } from "./task-cards";

const laneIcon: Record<Lane, LucideIcon> = { signal: Signal, noise: AudioWaveform };

const chip = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-meta";

/**
 * Aya's or Work's Today (both work the same way): chips to show only some of its projects (any number at once), then two cards, Signal (what really matters)
 * on top and Noise. New tasks go in Noise; drag one to the other card to move it (press and hold on a phone).
 * Computers show the tasks as a table (focus type, priority, name, project); phones get plain rows without chips.
 */
export function WorkToday({
  tasks,
  projects,
  area,
  canAdd,
  today,
  side,
}: {
  tasks: Task[];
  projects: CellProject[];
  area: ProjectArea;
  canAdd: boolean;
  today: string;
  /** The cards beside the Today card (Scratch pad, Agents), lined up with its top. */
  side: React.ReactNode;
}) {
  const filter = useProjectFilter(tasks, projects);

  return (
    <div className="flex flex-col gap-3">
      <ProjectFilter tasks={tasks} projects={projects} area={area} picked={filter.picked} onPick={filter.setPicked} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <TaskCards tasks={filter.shown} field="lane" labels={laneLabel}>
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
  const count = (id: string) => tasks.filter((t) => t.project?.id === id).length;
  const chips = projects.filter((p) => picked.includes(p.id) || count(p.id) > 0);
  if (chips.length === 0) return null;
  const all = picked.length === 0;
  return (
    <div role="group" aria-label={`${areaLabel[area]} projects`} className="hidden flex-wrap items-center gap-1.5 md:flex">
      <button
        type="button"
        aria-pressed={all}
        onClick={() => onPick([])}
        className={cn(chip, all ? "bg-selected font-medium text-ink" : "border bg-card text-muted-foreground hover:bg-muted")}
      >
        All {area === "work" ? "work" : areaLabel[area]}
        <span className="text-muted-foreground">{tasks.length}</span>
      </button>
      {chips.map((p) => {
        const on = picked.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? picked.filter((id) => id !== p.id) : [...picked, p.id])}
            className={cn(chip, on ? "bg-selected font-medium text-ink" : "border bg-card text-muted-foreground hover:bg-muted")}
          >
            <span className="size-2 rounded-[3px]" style={{ background: p.hex }} aria-hidden />
            {p.name}
            <span className="text-muted-foreground">{count(p.id)}</span>
          </button>
        );
      })}
    </div>
  );
}

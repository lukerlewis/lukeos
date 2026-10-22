"use client";

import { AudioWaveform, Signal, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Task } from "@/core/tasks";
import type { DashboardSort } from "@/lib/dashboard";
import { laneLabel, lanes, type Lane, type Status } from "@/lib/task-fields";
import { Board } from "@/components/board/board";
import { QuickAdd, TaskList, type CellProject } from "@/components/tasks/task-list";
import { cn } from "@/lib/utils";
import { DraggableRow, DropCard, TaskCards } from "./task-cards";

const laneIcon: Record<Lane, LucideIcon> = { signal: Signal, noise: AudioWaveform };

const chip = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-meta";

/**
 * Work's Today: chips to show one work project at a time, then two cards, Signal (what really matters)
 * on top and Noise. New tasks go in Noise; drag one to the other card to move it (press and hold on a phone).
 * Computers show the tasks as a table (focus type, priority, name, project); phones get plain rows without chips.
 */
export function WorkToday({
  tasks,
  projects,
  canAdd,
  today,
  side,
}: {
  tasks: Task[];
  projects: CellProject[];
  canAdd: boolean;
  today: string;
  /** The cards beside the Today card (Scratch pad, Agents), lined up with its top. */
  side: React.ReactNode;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // A project that's gone since it was picked shows everything again.
  const project = projects.find((p) => p.id === picked) ?? null;
  const shown = project ? tasks.filter((t) => t.project?.id === project.id) : tasks;

  return (
    <div className="flex flex-col gap-3">
      <ProjectFilter tasks={tasks} projects={projects} picked={project?.id ?? null} onPick={setPicked} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <TaskCards tasks={shown} field="lane" labels={laneLabel}>
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
                    {/* "Add a task" makes a To do task, so it only shows while To do tasks do. A picked project gets it. */}
                    {canAdd && (
                      <QuickAdd
                        bucket="today"
                        area="work"
                        lane={lane}
                        projectId={project?.id ?? null}
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

/** Work's Board: the same project chips above it, then the columns. */
export function WorkBoard({
  tasks,
  projects,
  today,
  show,
  sort,
}: {
  tasks: Task[];
  projects: CellProject[];
  today: string;
  show: Status[];
  sort: DashboardSort;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const project = projects.find((p) => p.id === picked) ?? null;
  return (
    <div className="flex grow flex-col gap-3">
      <ProjectFilter tasks={tasks} projects={projects} picked={project?.id ?? null} onPick={setPicked} />
      <Board
        tasks={project ? tasks.filter((t) => t.project?.id === project.id) : tasks}
        view="when"
        today={today}
        show={show}
        sort={sort}
        projectId={project?.id}
        fill
      />
    </div>
  );
}

/** Chips to show one project's tasks at a time, on computers. Projects with no tasks here stay out of the way. */
function ProjectFilter({
  tasks,
  projects,
  picked,
  onPick,
}: {
  tasks: Task[];
  projects: CellProject[];
  picked: string | null;
  onPick: (id: string | null) => void;
}) {
  const count = (id: string) => tasks.filter((t) => t.project?.id === id).length;
  const chips = projects.filter((p) => p.id === picked || count(p.id) > 0);
  if (chips.length === 0) return null;
  return (
    <div role="group" aria-label="Work projects" className="hidden flex-wrap items-center gap-1.5 md:flex">
      <button
        type="button"
        aria-pressed={!picked}
        onClick={() => onPick(null)}
        className={cn(chip, !picked ? "bg-selected font-medium text-ink" : "border bg-card text-muted-foreground hover:bg-muted")}
      >
        All work
        <span className="text-muted-foreground">{tasks.length}</span>
      </button>
      {chips.map((p) => {
        const on = picked === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? null : p.id)}
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

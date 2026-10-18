"use client";

import { useState } from "react";
import type { Task } from "@/core/tasks";
import type { Status } from "@/lib/task-fields";
import { Board } from "@/components/board/board";
import { QuickAdd, TaskList, type CellProject } from "@/components/tasks/task-list";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const chip = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-meta";

/**
 * Work's Today list: chips to show one work project at a time, then the tasks as a table
 * (focus type, priority, name, project) on computers. Phones get the plain list without chips.
 */
export function WorkToday({
  tasks,
  projects,
  canAdd,
  today,
}: {
  tasks: Task[];
  projects: CellProject[];
  canAdd: boolean;
  today: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // A project that's gone since it was picked shows everything again.
  const project = projects.find((p) => p.id === picked) ?? null;
  const shown = project ? tasks.filter((t) => t.project?.id === project.id) : tasks;

  return (
    <div className="flex flex-col gap-3">
      <ProjectFilter tasks={tasks} projects={projects} picked={project?.id ?? null} onPick={setPicked} />
      <Card>
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <h2 className="text-sm font-medium">Today</h2>
          <span className="text-meta text-muted-foreground">{shown.length}</span>
        </div>
        <TaskList
          tasks={shown}
          today={today}
          columns
          projects={projects}
          empty={<p className="px-4 py-6 text-center text-meta text-muted-foreground">Nothing for today.</p>}
        />
        {/* "Add a task" makes a To do task, so it only shows while To do tasks do. A picked project gets it. */}
        {canAdd && <QuickAdd bucket="today" area="work" projectId={project?.id ?? null} today={today} placeholder="Add to Work" />}
      </Card>
    </div>
  );
}

/** Work's Board: the same project chips above it, then the columns. */
export function WorkBoard({
  tasks,
  projects,
  today,
  show,
}: {
  tasks: Task[];
  projects: CellProject[];
  today: string;
  show: Status[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const project = projects.find((p) => p.id === picked) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <ProjectFilter tasks={tasks} projects={projects} picked={project?.id ?? null} onPick={setPicked} />
      <Board
        tasks={project ? tasks.filter((t) => t.project?.id === project.id) : tasks}
        view="when"
        today={today}
        show={show}
        projectId={project?.id}
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

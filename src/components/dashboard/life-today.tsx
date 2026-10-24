"use client";

import { Coffee, Moon, Sun, type LucideIcon } from "lucide-react";
import type { Task } from "@/core/tasks";
import { QuickAdd } from "@/components/tasks/task-list";
import { sortTasks } from "@/lib/board";
import type { DashboardSort } from "@/lib/dashboard";
import { timeOfDayLabel, timesOfDay, type Status, type TimeOfDay } from "@/lib/task-fields";
import { DraggableRow, DropCard, TaskCards } from "./task-cards";

const timeIcon: Record<TimeOfDay, LucideIcon> = { morning: Coffee, day: Sun, evening: Moon };

/**
 * Life's Today: three cards, Morning, Day and Evening. New tasks go in Day.
 * Drag a task to another card to move it (press and hold on a phone).
 */
export function LifeToday({
  tasks,
  today,
  sort,
  show,
  canAdd,
}: {
  tasks: Task[];
  today: string;
  sort: DashboardSort;
  /** The statuses the dashboard shows. */
  show: Status[];
  /** "Add a task" makes a To do task, so it only shows while To do tasks do. */
  canAdd: boolean;
}) {
  return (
    <TaskCards
      tasks={tasks}
      field="timeOfDay"
      labels={timeOfDayLabel}
      fits={(t) => t.area === "life" && t.bucket === "today" && show.includes(t.status)}
    >
      {(items) => (
        <div className="flex flex-col gap-6">
          {timesOfDay.map((time) => {
            const here = sortTasks(
              items.filter((t) => t.timeOfDay === time),
              sort,
            );
            const label = timeOfDayLabel[time];
            return (
              <DropCard key={time} id={time} label={label} icon={timeIcon[time]} count={here.length}>
                {here.length > 0 && (
                  <ul>
                    {here.map((t) => (
                      <DraggableRow key={t.id} task={t} today={today} />
                    ))}
                  </ul>
                )}
                {canAdd && <QuickAdd bucket="today" area="life" timeOfDay={time} today={today} placeholder={`Add to ${label}`} />}
              </DropCard>
            );
          })}
        </div>
      )}
    </TaskCards>
  );
}

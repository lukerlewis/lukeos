"use client";

import { Plus, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import type { Task } from "@/core/tasks";
import { friendlyDay, nextRepeat } from "@/lib/dates";
import { op } from "@/lib/ops-client";
import { effortLabel, priorityLabel, repeatLabel, type Status } from "@/lib/task-fields";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/shell/toast";
import { ClaudeBadge } from "./made-by";
import { StatusIcon } from "./status-circle";
import { useTaskEditor } from "./task-editor";

/** A list of task rows, e.g. inside a Card. */
export function TaskList({
  tasks,
  today,
  showProject = true,
  empty,
}: {
  tasks: Task[];
  today: string;
  showProject?: boolean;
  empty?: React.ReactNode;
}) {
  if (tasks.length === 0 && empty) return <>{empty}</>;
  return (
    <ul>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} today={today} showProject={showProject} />
      ))}
    </ul>
  );
}

export function TaskRow({ task, today, showProject }: { task: Task; today: string; showProject: boolean }) {
  const router = useRouter();
  const { openTask } = useTaskEditor();
  const [, startTransition] = useTransition();
  const [status, setOptimisticStatus] = useOptimistic(task.status);

  // Tapping the circle ticks a task off, or un-ticks a done one.
  function toggle() {
    const next: Status = status === "done" ? "todo" : "done";
    startTransition(async () => {
      setOptimisticStatus(next);
      try {
        await op("update_task", { id: task.id, status: next });
        if (next === "done" && task.repeat) {
          const label = friendlyDay(nextRepeat(task.dueDate, task.repeat, today), today);
          showToast(`Done. The next one is due ${label === "Tomorrow" ? "tomorrow" : `on ${label}`}.`);
        }
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  }

  const done = status === "done";
  const due = task.dueDate;
  const late = !done && due !== null && due < today;
  const dueToday = !done && due === today;

  return (
    <li className="flex items-start gap-3 border-b px-4 last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className="-mx-2 flex size-11 shrink-0 items-center justify-center md:size-10"
      >
        <StatusIcon status={status} className="size-[22px] md:size-[18px]" />
      </button>
      <button
        type="button"
        onClick={() => openTask(task)}
        className="flex min-w-0 grow flex-col gap-0.5 py-3 text-left md:flex-row md:items-center md:gap-3"
      >
        <span
          className={cn(
            "min-w-0 grow text-[15px] font-medium break-words md:text-sm",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground empty:hidden md:shrink-0 md:flex-nowrap">
          <ClaudeBadge madeBy={task.madeBy} />
          {task.priority === "high" && <span className="font-medium text-danger">{priorityLabel.high} priority</span>}
          {task.effort && <span>{effortLabel[task.effort]}</span>}
          {task.repeat && (
            <span className="inline-flex items-center gap-1" title={repeatLabel[task.repeat]}>
              <Repeat className="size-3" aria-hidden />
              <span className="sr-only">{repeatLabel[task.repeat]}</span>
            </span>
          )}
          {task.notes && <span title="Has notes">Notes</span>}
          {showProject && task.project && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[3px]" style={{ background: task.project.hex }} aria-hidden />
              {task.project.name}
            </span>
          )}
          {due && (
            <span
              className={cn(
                "font-medium md:w-20 md:text-right",
                (late || dueToday) && "text-accent-today",
                late && "text-danger",
              )}
            >
              {friendlyDay(due, today)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** "Add a task" line at the bottom of a list: type and press Enter. */
export function QuickAdd({
  projectId,
  dueDate,
  placeholder = "Add a task",
}: {
  projectId?: string | null;
  dueDate?: string | null;
  placeholder?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setTitle("");
    startTransition(async () => {
      try {
        await op("create_task", { title: clean, projectId: projectId ?? null, dueDate: dueDate ?? null });
        router.refresh();
      } catch (err) {
        setTitle(clean);
        alert((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-3 border-t px-4">
      <Plus className="size-[22px] shrink-0 text-muted-foreground md:size-[18px]" aria-hidden />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-busy={pending}
        enterKeyHint="done"
        className="h-12 min-w-0 grow bg-transparent text-[15px] outline-none placeholder:text-muted-foreground md:h-11 md:text-sm"
      />
    </form>
  );
}

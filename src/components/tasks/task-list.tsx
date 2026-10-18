"use client";

import { Plus, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import type { Task } from "@/core/tasks";
import { currentArea } from "@/lib/area";
import { bucketForDate } from "@/lib/board";
import { friendlyDay, nextRepeat } from "@/lib/dates";
import { SmartChips, useSmartEntry } from "./smart-chips";
import { op } from "@/lib/ops-client";
import { useHidden } from "@/lib/background";
import { bucketLabel, effortLabel, priorityLabel, repeatLabel, type Area, type Bucket, type Status } from "@/lib/task-fields";
import { cn, pause } from "@/lib/utils";
import { showToast } from "@/components/shell/toast";
import { ClaudeBadge } from "./made-by";
import { StatusIcon } from "./status-circle";
import { FocusChip, PriorityChip } from "./task-chips";
import { useTaskEditor } from "./task-editor";

/** How long the tick animation takes to play out. */
export const TICK_MS = 400;

/** A list of task rows, e.g. inside a Card. */
export function TaskList({
  tasks,
  today,
  showProject = true,
  columns = false,
  empty,
}: {
  tasks: Task[];
  today: string;
  showProject?: boolean;
  /** Work's table on computers: focus type, priority, name and project in columns, like Luke's Notion. Phones keep plain rows. */
  columns?: boolean;
  empty?: React.ReactNode;
}) {
  if (tasks.length === 0 && empty) return <>{empty}</>;
  return (
    <ul>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} today={today} showProject={showProject} columns={columns} />
      ))}
    </ul>
  );
}

/** The column widths of Work's table: tick, focus type, priority, name, project. */
const tableColumns = "28px 96px 68px minmax(0, 1fr) 104px";

export function TaskRow({
  task,
  today,
  showProject,
  columns = false,
}: {
  task: Task;
  today: string;
  showProject: boolean;
  columns?: boolean;
}) {
  const router = useRouter();
  const { openTask } = useTaskEditor();
  const [, startTransition] = useTransition();
  const [status, setOptimisticStatus] = useOptimistic(task.status);
  // Counts taps on the circle, so the tick animates afresh each time.
  const [taps, setTaps] = useState(0);
  const gone = useHidden(task.id);

  // Tapping the circle ticks a task off, or un-ticks a done one.
  function toggle() {
    const next: Status = status === "done" ? "todo" : "done";
    setTaps((n) => n + 1);
    startTransition(async () => {
      setOptimisticStatus(next);
      try {
        await Promise.all([op("update_task", { id: task.id, status: next }), pause(TICK_MS)]);
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

  if (gone) return null;
  const done = status === "done";
  const due = task.dueDate;
  const late = !done && due !== null && due < today;
  const dueToday = !done && due === today;

  return (
    <li
      className={cn("flex items-start gap-3 border-b px-4 last:border-b-0", columns && "md:grid md:items-center")}
      style={columns ? { gridTemplateColumns: tableColumns } : undefined}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className="-mx-2 flex size-11 shrink-0 items-center justify-center md:size-10"
      >
        <StatusIcon key={taps} status={status} className={cn("size-[26px] md:size-[18px]", taps > 0 && "motion-tick")} />
      </button>
      {columns && (
        <>
          <span className="hidden md:flex">{task.effort && <FocusChip effort={task.effort} />}</span>
          <span className="hidden md:flex">{task.priority && <PriorityChip priority={task.priority} />}</span>
        </>
      )}
      <button
        type="button"
        onClick={() => openTask(task)}
        className="press-tint -mr-4 flex min-w-0 grow flex-col gap-0.5 py-3 pr-4 text-left md:flex-row md:items-center md:gap-3"
      >
        <span
          className={cn(
            "min-w-0 grow text-control font-medium break-words",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-muted-foreground empty:hidden md:shrink-0 md:flex-nowrap">
          <ClaudeBadge madeBy={task.madeBy} />
          {task.priority === "high" && <span className={cn("tag", columns && "md:hidden")}>{priorityLabel.high} priority</span>}
          {task.effort && <span className={cn(columns && "md:hidden")}>{effortLabel[task.effort]}</span>}
          {task.repeat && (
            <span className="inline-flex items-center gap-1" title={repeatLabel[task.repeat]}>
              <Repeat className="size-3" aria-hidden />
              <span className="sr-only">{repeatLabel[task.repeat]}</span>
            </span>
          )}
          {task.notes && <span title="Has notes">Notes</span>}
          {showProject && task.project && (
            <span className={cn("inline-flex items-center gap-1.5", columns && "md:hidden")}>
              <span className="size-2 rounded-[3px]" style={{ background: task.project.hex }} aria-hidden />
              {task.project.name}
            </span>
          )}
          {due && (
            <span
              className={cn(
                "font-medium md:w-20 md:text-right",
                (late || dueToday) && "text-ink",
                late && "font-medium text-ink",
              )}
            >
              {friendlyDay(due, today)}
            </span>
          )}
        </span>
      </button>
      {columns && (
        <span className="hidden min-w-0 items-center gap-1.5 text-meta text-muted-foreground md:flex">
          {task.project && (
            <>
              <span className="size-2 shrink-0 rounded-[3px]" style={{ background: task.project.hex }} aria-hidden />
              <span className="truncate">{task.project.name}</span>
            </>
          )}
        </span>
      )}
    </li>
  );
}

/** "Add a task" line at the bottom of a list: type and press Enter. */
export function QuickAdd({
  projectId,
  area,
  bucket,
  placeholder = "Add a task",
  today,
}: {
  projectId?: string | null;
  /** Work or Life. A project's tasks go in its own; otherwise the one this device shows if left out. */
  area?: Area;
  /** The list it goes in. Today if left out. */
  bucket?: Bucket;
  placeholder?: string;
  /** Today in Luke's time zone, for reading "tomorrow" or "every monday" out of the name. */
  today: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  // Tasks just typed, shown at once (faded) until they're saved and the list catches up.
  const [adding, addOne] = useOptimistic<{ key: number; title: string }[], { key: number; title: string }>([], (s, t) => [...s, t]);
  const smart = useSmartEntry(title, today);
  const { parsed } = smart;
  const due = parsed.dueDate ?? (parsed.repeat ? today : null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const typed = title;
    const clean = parsed.title;
    if (!clean) return;
    // A list typed in the name ("this week") wins, then a typed date picks the list; otherwise it goes in this one.
    const list = parsed.bucket ?? (parsed.dueDate ? bucketForDate(parsed.dueDate, today) : bucket);
    const fields = { title: clean, projectId: projectId ?? null, area: area ?? currentArea(), bucket: list, dueDate: due, repeat: parsed.repeat };
    setTitle("");
    smart.reset();
    // One going to another list ("tomorrow") doesn't show here, so a toast says where it went.
    const here = !bucket || list === bucket;
    if (!here && list) showToast(`Added to ${bucketLabel[list]}`);
    startTransition(async () => {
      if (here) addOne({ key: Date.now(), title: clean });
      try {
        await op("create_task", fields);
        router.refresh();
      } catch (err) {
        setTitle((t) => t || typed);
        showToast(`Couldn't add the task. ${(err as Error).message}`);
      }
    });
  }

  return (
    <>
      {adding.length > 0 && (
        <ul aria-busy>
          {adding.map((t) => (
            <li key={t.key} className="flex items-start gap-3 border-t px-4 opacity-60">
              <span className="-mx-2 flex size-11 shrink-0 items-center justify-center md:size-10">
                <StatusIcon status="todo" className="size-[26px] md:size-[18px]" />
              </span>
              <span className="min-w-0 grow py-3 text-control font-medium break-words">{t.title}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex items-center gap-3 border-t px-4">
        <Plus className="size-[22px] shrink-0 text-muted-foreground md:size-[18px]" aria-hidden />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-busy={pending}
          enterKeyHint="done"
          className="h-12 w-0 min-w-0 grow bg-transparent text-body outline-none placeholder:text-muted-foreground md:h-11 md:text-sm"
        />
        <SmartChips parsed={parsed} dueDate={due} repeat={parsed.repeat} today={today} onDismiss={smart.dismiss} className="flex-nowrap" />
      </form>
    </>
  );
}

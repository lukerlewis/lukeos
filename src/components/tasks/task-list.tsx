"use client";

import { Plus, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useOptimistic, useState, useTransition } from "react";
import type { Task } from "@/core/tasks";
import { currentArea } from "@/lib/area";
import { bucketForDate } from "@/lib/board";
import { friendlyDay, nextRepeat } from "@/lib/dates";
import { SmartChips, useSmartEntry } from "./smart-chips";
import { op } from "@/lib/ops-client";
import { useHidden } from "@/lib/background";
import { isUnsaved, useLiveTasks } from "@/lib/live-tasks";
import {
  bucketLabel,
  effortLabel,
  efforts,
  priorities,
  priorityLabel,
  repeatName,
  type Area,
  type Bucket,
  type Effort,
  type Lane,
  type Priority,
  type Status,
  type TimeOfDay,
} from "@/lib/task-fields";
import { askClaudeAbout } from "@/lib/ask-claude";
import { cn, pause } from "@/lib/utils";
import { showToast } from "@/components/shell/toast";
import { ClaudeBadge } from "./made-by";
import { StatusIcon } from "./status-circle";
import { CellMenu } from "./cell-menu";
import { FocusChip, PriorityChip, ProjectChip } from "./task-chips";
import { useTaskEditor } from "./task-editor";

/** How long the tick animation takes to play out. */
export const TICK_MS = 400;

/** A project a table cell can put a task in. */
export type CellProject = NonNullable<Task["project"]>;

/** A list of task rows, e.g. inside a Card. */
export function TaskList({
  tasks: saved,
  today,
  showProject = true,
  columns = false,
  projects = [],
  empty,
  row,
}: {
  tasks: Task[];
  today: string;
  showProject?: boolean;
  /**
   * Work's table on computers: focus type, priority, name and project in columns, like Luke's Notion,
   * each one clickable to set it. Phones keep plain rows.
   */
  columns?: boolean;
  /** The projects the Project column offers. */
  projects?: CellProject[];
  empty?: React.ReactNode;
  /** Draws each row instead of the plain one, e.g. to make it draggable. */
  row?: (task: Task) => React.ReactNode;
}) {
  useColumnWidths(columns);
  // Edits made in the task box show at once.
  const tasks = useLiveTasks(saved);
  if (tasks.length === 0 && empty) return <>{empty}</>;
  return (
    <>
      {columns && (
        <div
          aria-hidden
          className="hidden border-b bg-muted/40 px-4 text-xs font-medium text-muted-foreground md:grid"
          style={{ gridTemplateColumns: tableColumns(showProject) }}
        >
          <span />
          <span className={headCell}>
            Focus type
            <ColumnHandle column="focus" />
          </span>
          <span className={headCell}>
            Priority
            <ColumnHandle column="priority" />
          </span>
          <span className={cn(headCell, "pl-3")}>
            Name
            {showProject && <ColumnHandle column="project" />}
          </span>
          {showProject && <span className={headCell}>Project</span>}
        </div>
      )}
      <ul>
        {tasks.map((t) =>
          row ? (
            <Fragment key={t.id}>{row(t)}</Fragment>
          ) : (
            <TaskRow key={t.id} task={t} today={today} showProject={showProject} columns={columns} projects={projects} />
          ),
        )}
      </ul>
    </>
  );
}

/**
 * The column widths of the table: tick, focus type, priority, name, and project unless it's left out (on a project's page).
 * Luke drags the header lines to change them; they're kept on this device and shared by every table.
 * When the table is narrow the other columns give way first, so the name keeps room for a line of text.
 */
export const tableColumns = (project: boolean) =>
  `28px ${fit("focus", 120)} ${fit("priority", 76)} minmax(${nameMin}px, 1fr)${project ? ` ${fit("project", 120)}` : ""}`;
const fit = (column: Column, width: number) => `minmax(${minWidth}px, var(--col-${column}, ${width}px))`;
const nameMin = 180;
const headCell = "relative border-l px-2 py-1.5";

type Column = "focus" | "priority" | "project";
const defaultWidths: Record<Column, number> = { focus: 120, priority: 76, project: 120 };
const minWidth = 48;
const widthsKey = "lukeos:column-widths";

function savedWidths(): Record<Column, number> {
  try {
    return { ...defaultWidths, ...JSON.parse(localStorage.getItem(widthsKey) ?? "{}") };
  } catch {
    return { ...defaultWidths };
  }
}

function applyWidths(widths: Record<Column, number>) {
  for (const c of Object.keys(widths) as Column[]) document.documentElement.style.setProperty(`--col-${c}`, `${widths[c]}px`);
}

/** Puts the saved column widths in place once the table shows. */
export function useColumnWidths(on: boolean) {
  useEffect(() => {
    if (on) applyWidths(savedWidths());
  }, [on]);
}

/**
 * A line in the table header to drag sideways, changing a column's width. It sits on the column's
 * right edge (the Project column's left edge, so dragging left widens it). Double-click puts it back.
 */
function ColumnHandle({ column }: { column: Column }) {
  function start(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const widths = savedWidths();
    const from = widths[column];
    const x = e.clientX;
    const move = (ev: PointerEvent) => {
      const dx = column === "project" ? x - ev.clientX : ev.clientX - x;
      widths[column] = Math.max(minWidth, Math.round(from + dx));
      applyWidths(widths);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      try {
        localStorage.setItem(widthsKey, JSON.stringify(widths));
      } catch {}
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end, { once: true });
    handle.addEventListener("pointercancel", end, { once: true });
  }
  function reset() {
    const widths = { ...savedWidths(), [column]: defaultWidths[column] };
    applyWidths(widths);
    try {
      localStorage.setItem(widthsKey, JSON.stringify(widths));
    } catch {}
  }
  return (
    <span
      onPointerDown={start}
      onDoubleClick={reset}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 hover:after:bg-stroke-strong"
    />
  );
}

const focusOptions = [
  { value: null, label: <span className="text-muted-foreground">None</span> },
  ...efforts.map((e) => ({ value: e, label: <FocusChip effort={e} /> })),
];
const priorityOptions = [
  { value: null, label: <span className="text-muted-foreground">None</span> },
  ...[...priorities].reverse().map((p) => ({ value: p, label: <PriorityChip priority={p} /> })),
];

export function TaskRow({
  task,
  today,
  showProject,
  columns = false,
  projects = [],
  li,
}: {
  task: Task;
  today: string;
  showProject: boolean;
  columns?: boolean;
  projects?: CellProject[];
  /** Extra props for the row itself, e.g. to make it draggable. */
  li?: React.ComponentProps<"li">;
}) {
  const router = useRouter();
  const { openTask, openId } = useTaskEditor();
  const [, startTransition] = useTransition();
  const [status, setOptimisticStatus] = useOptimistic(task.status);
  // Counts taps on the circle, so the tick animates afresh each time.
  const [taps, setTaps] = useState(0);
  const gone = useHidden(task.id);
  // A value picked in a table cell shows at once, before the list catches up.
  const [cells, setCells] = useOptimistic(
    { effort: task.effort, priority: task.priority, project: task.project },
    (now, change: Partial<Pick<Task, "effort" | "priority" | "project">>) => ({ ...now, ...change }),
  );

  function setCell(change: Partial<Pick<Task, "effort" | "priority" | "project">>, input: { effort?: Effort | null; priority?: Priority | null; projectId?: string | null }) {
    startTransition(async () => {
      setCells(change);
      try {
        await op("update_task", { id: task.id, ...input });
      } catch (err) {
        showToast(`Couldn't save. ${(err as Error).message}`);
      }
      router.refresh();
    });
  }

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
      {...askClaudeAbout({ kind: "task", id: task.id, title: task.title })}
      {...li}
      className={cn("flex items-start gap-3 border-b px-4 last:border-b-0", columns && "md:grid md:items-stretch md:gap-0", li?.className, openId === task.id && "md:bg-selected", isUnsaved(task.id) && "pointer-events-none opacity-60")}
      style={columns ? { gridTemplateColumns: tableColumns(showProject) } : undefined}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className={cn("-mx-2 flex size-11 shrink-0 items-center justify-center md:size-10", columns && "md:self-center")}
      >
        <StatusIcon key={taps} status={status} className={cn("size-[26px] md:size-[18px]", taps > 0 && "motion-tick")} />
      </button>
      {columns && (
        <>
          <span className="hidden min-w-0 overflow-hidden border-l md:flex">
            <CellMenu
              label={`Focus type of "${task.title}"`}
              value={cells.effort}
              options={focusOptions}
              onPick={(effort) => setCell({ effort }, { effort })}
            >
              {cells.effort && <FocusChip effort={cells.effort} />}
            </CellMenu>
          </span>
          <span className="hidden min-w-0 overflow-hidden border-l md:flex">
            <CellMenu
              label={`Priority of "${task.title}"`}
              value={cells.priority}
              options={priorityOptions}
              onPick={(priority) => setCell({ priority }, { priority })}
            >
              {cells.priority && <PriorityChip priority={cells.priority} />}
            </CellMenu>
          </span>
        </>
      )}
      <button
        type="button"
        onClick={() => openTask(task)}
        className={cn(
          "press-tint -mr-4 flex min-w-0 grow flex-col gap-0.5 py-3 pr-4 text-left md:flex-row md:items-center md:gap-3",
          columns && "md:mr-0 md:border-l md:px-3",
        )}
      >
        <span
          className={cn(
            "min-w-0 grow text-body font-medium md:text-control break-words",
            // In the table a long name stays on one line and ends in "…"; the full name is in the task box.
            columns && "md:truncate",
            done && "text-muted-foreground line-through",
          )}
          title={columns ? task.title : undefined}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-muted-foreground empty:hidden md:shrink-0 md:flex-nowrap">
          <ClaudeBadge madeBy={task.madeBy} />
          {task.priority === "high" && <span className={cn("tag", columns && "md:hidden")}>{priorityLabel.high} priority</span>}
          {task.effort && <span className={cn(columns && "md:hidden")}>{effortLabel[task.effort]}</span>}
          {task.repeat && (
            <span className="inline-flex items-center gap-1" title={repeatName(task.repeat)}>
              <Repeat className="size-3" aria-hidden />
              <span className="sr-only">{repeatName(task.repeat)}</span>
            </span>
          )}
          {task.notes && <span title="Has notes">Notes</span>}
          {showProject && task.project && (
            <ProjectChip project={task.project} className={cn(columns && "md:hidden")} />
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
      {columns && showProject && (
        <span className="-mr-4 hidden min-w-0 overflow-hidden border-l md:flex">
          <CellMenu
            label={`Project of "${task.title}"`}
            value={cells.project?.id ?? null}
            options={[
              { value: null, label: <span className="text-muted-foreground">No project</span> },
              ...projects.map((p) => ({ value: p.id, label: <ProjectChip project={p} /> })),
            ]}
            onPick={(id) => setCell({ project: projects.find((p) => p.id === id) ?? null }, { projectId: id })}
            className="pr-4"
          >
            {cells.project && <ProjectChip project={cells.project} />}
          </CellMenu>
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
  timeOfDay,
  lane,
  placeholder = "Add a task",
  today,
}: {
  projectId?: string | null;
  /** Work or Life. A project's tasks go in its own; otherwise the one this device shows if left out. */
  area?: Area;
  /** The list it goes in. Today if left out. */
  bucket?: Bucket;
  /** Morning, day or evening, for Life's Today cards. */
  timeOfDay?: TimeOfDay;
  /** Signal or noise, for Work's Today cards. */
  lane?: Lane;
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
    const fields = { title: clean, projectId: projectId ?? null, area: area ?? currentArea(), bucket: list, dueDate: due, repeat: parsed.repeat, timeOfDay, lane };
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

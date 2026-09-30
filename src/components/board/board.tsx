"use client";

import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { StatusIcon } from "@/components/tasks/status-circle";
import { useTaskEditor } from "@/components/tasks/task-editor";
import type { Task } from "@/core/tasks";
import { changesForMove, columnOf, columnsFor, compareTasks, type BoardView, type Column, type ColumnId } from "@/lib/board";
import { friendlyDay } from "@/lib/dates";
import { op } from "@/lib/ops-client";
import { effortLabel, priorityLabel, type Status } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

type Change = { id: string; changes: Partial<Pick<Task, "dueDate" | "status">> };

// Tapping a card's circle steps it along: To do, Doing, Done, and back to To do.
const nextStatus: Record<Status, Status> = { todo: "doing", doing: "done", done: "todo" };

// The column under the pointer or finger wins; failing that, the one the card overlaps most.
const findColumn: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
};

/**
 * The board: tasks as cards in columns, either by when they're due or by
 * status. Drag a card to another column to move it (press and hold on a
 * phone); tap it to open it.
 */
export function Board({
  tasks,
  view,
  today,
  projectId,
  showProject = true,
  show,
}: {
  tasks: Task[];
  view: BoardView;
  today: string;
  projectId?: string;
  showProject?: boolean;
  /** Only these statuses get a column when grouping by status. */
  show?: Status[];
}) {
  const router = useRouter();
  // A fixed id keeps dnd-kit's screen reader ids the same on the server and in the browser.
  const dndId = useId();
  const { newTask } = useTaskEditor();
  const [, startTransition] = useTransition();
  const [items, applyChange] = useOptimistic(tasks, (state, { id, changes }: Change) =>
    state.map((t) => (t.id === id ? { ...t, ...changes } : t)),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const columns = columnsFor(view, today, show);
  const dragging = items.find((t) => t.id === draggingId);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A short press and hold, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // Space picks a card up and drops it; Enter is left for opening it.
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );

  function save(change: Change, request: () => Promise<unknown>) {
    startTransition(async () => {
      applyChange(change);
      try {
        await request();
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  }

  function drop({ active, over }: DragEndEvent) {
    setDraggingId(null);
    const task = items.find((t) => t.id === active.id);
    if (!task || !over) return;
    const to = over.id as ColumnId;
    const changes = changesForMove(task, to, today);
    if (!changes) return;
    save({ id: task.id, changes }, () => op("move_task", { id: task.id, to }));
  }

  function cycle(task: Task) {
    const status = nextStatus[task.status];
    save({ id: task.id, changes: { status } }, () => op("update_task", { id: task.id, status }));
  }

  function addTo(column: Column) {
    const placed = changesForMove({ dueDate: null, status: "todo" }, column.id, today);
    newTask({ projectId: projectId ?? null, ...placed });
  }

  const titleOf = (id: string | number) => items.find((t) => t.id === id)?.title ?? "task";
  const columnTitle = (id: string | number | undefined) => columns.find((c) => c.id === id)?.title;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up "${titleOf(active.id)}".`,
    onDragOver: ({ active, over }) =>
      over ? `"${titleOf(active.id)}" is over ${columnTitle(over.id)}.` : `"${titleOf(active.id)}" is not over a column.`,
    onDragEnd: ({ active, over }) =>
      over ? `"${titleOf(active.id)}" moved to ${columnTitle(over.id)}.` : `"${titleOf(active.id)}" put back.`,
    onDragCancel: ({ active }) => `Cancelled. "${titleOf(active.id)}" put back.`,
  };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={findColumn}
      onDragStart={({ active }) => setDraggingId(String(active.id))}
      onDragEnd={drop}
      onDragCancel={() => setDraggingId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "Press Space to pick up the task, use the arrow keys to move it, and Space again to drop it. Press Enter to open it.",
        },
      }}
    >
      <div
        className={cn(
          // Phones and small windows: columns side by side that you swipe through.
          "-mx-5 flex scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 md:-mx-10 md:scroll-px-10 md:px-10",
          "lg:mx-0 lg:grid lg:overflow-visible lg:px-0",
          ["lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"][columns.length - 1],
          !draggingId && "snap-x snap-mandatory",
        )}
      >
        {columns.map((column) => {
          const cards = items.filter((t) => columnOf(t, view, today) === column.id).sort(compareTasks);
          return (
            <BoardColumn key={column.id} column={column} view={view} count={cards.length} onAdd={() => addTo(column)}>
              {cards.map((t) => (
                <DraggableCard key={t.id} task={t} today={today} showProject={showProject} onCycle={() => cycle(t)} />
              ))}
            </BoardColumn>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && <CardBody task={dragging} today={today} showProject={showProject} className="rotate-1 shadow-lg" />}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  column,
  view,
  count,
  onAdd,
  children,
}: {
  column: Column;
  view: BoardView;
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={column.title}
      className={cn(
        "flex min-h-48 w-[82vw] max-w-80 shrink-0 snap-start flex-col gap-2.5 rounded-xl border bg-sidebar p-2.5 transition-colors lg:w-auto lg:max-w-none",
        isOver && "border-ring bg-muted",
      )}
    >
      <header className="flex items-start gap-2 px-1.5 pt-1">
        {view === "status" && <StatusIcon status={column.id as Status} className="mt-px size-4" />}
        <div className="min-w-0 grow">
          <h2 className="flex items-baseline gap-2 text-sm font-semibold">
            {column.title}
            <span className="text-xs font-normal text-muted-foreground">{count}</span>
          </h2>
          {column.hint && <p className="text-xs text-muted-foreground">{column.hint}</p>}
        </div>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add a task to ${column.title}`}
          className="-m-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </header>
      <ul className="flex flex-col gap-2">
        {count === 0 ? (
          <li className="flex h-16 items-center justify-center rounded-[10px] border border-dashed text-xs text-muted-foreground">
            Nothing here
          </li>
        ) : (
          children
        )}
      </ul>
    </section>
  );
}

function DraggableCard({
  task,
  today,
  showProject,
  onCycle,
}: {
  task: Task;
  today: string;
  showProject: boolean;
  onCycle: () => void;
}) {
  const { openTask } = useTaskEditor();
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: task.id });

  return (
    <li ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <CardBody
        task={task}
        today={today}
        showProject={showProject}
        onCycle={onCycle}
        {...attributes}
        {...listeners}
        aria-roledescription="task card"
        aria-label={task.title}
        onClick={() => openTask(task)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isDragging) openTask(task);
          else listeners?.onKeyDown?.(e);
        }}
      />
    </li>
  );
}

function CardBody({
  task,
  today,
  showProject,
  onCycle,
  className,
  ...rest
}: {
  task: Task;
  today: string;
  showProject: boolean;
  onCycle?: () => void;
} & React.ComponentProps<"div">) {
  const done = task.status === "done";
  const due = task.dueDate;
  const late = !done && due !== null && due < today;
  const dueToday = !done && due === today;
  const meta = [
    task.madeBy.kind === "agent",
    task.priority === "high",
    task.effort,
    task.notes,
    showProject && task.project,
    due,
  ].some(Boolean);

  return (
    <div
      {...rest}
      className={cn(
        "flex cursor-grab touch-manipulation flex-col gap-2 rounded-[10px] border bg-card p-3 text-left shadow-xs select-none [-webkit-touch-callout:none] active:cursor-grabbing",
        done && "opacity-60",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCycle?.();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`"${task.title}" is ${task.status === "todo" ? "to do" : task.status}. Tap to move it along.`}
          className="-m-2 flex size-9 shrink-0 items-center justify-center"
        >
          <StatusIcon status={task.status} className="size-[18px]" />
        </button>
        <span className={cn("min-w-0 grow pt-px font-medium break-words", done && "text-muted-foreground line-through")}>
          {task.title}
        </span>
      </div>
      {meta && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[26px] text-xs text-muted-foreground">
          {due && (
            <span className={cn("font-medium", dueToday && "text-accent-today", late && "text-danger")}>
              {friendlyDay(due, today)}
            </span>
          )}
          {task.priority === "high" && <span className="font-medium text-danger">{priorityLabel.high}</span>}
          {task.effort && <span>{effortLabel[task.effort]}</span>}
          {task.notes && <span>Notes</span>}
          {showProject && task.project && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-[3px]" style={{ background: task.project.hex }} aria-hidden />
              <span className="truncate">{task.project.name}</span>
            </span>
          )}
          <ClaudeBadge madeBy={task.madeBy} />
        </div>
      )}
    </div>
  );
}

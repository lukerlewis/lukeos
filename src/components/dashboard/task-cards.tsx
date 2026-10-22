"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";
import type { Task } from "@/core/tasks";
import { showToast } from "@/components/shell/toast";
import { TaskRow, type CellProject } from "@/components/tasks/task-list";
import { Card } from "@/components/ui/card";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";

/** The task field that says which card a task is in: Life's time of day, or Work's signal or noise. */
type CardField = "timeOfDay" | "lane";

// The card under the pointer or finger wins; failing that, the one the row overlaps most.
const findCard: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
};

/**
 * Today split into cards by one task field, with drag and drop between them (press and hold on a phone).
 * Dropping a task on another card sets that field. `children` gets the tasks with any move already shown.
 */
export function TaskCards<F extends CardField>({
  tasks,
  field,
  labels,
  children,
}: {
  tasks: Task[];
  field: F;
  /** Each card's name, by its value of the field. */
  labels: Record<Task[F], string>;
  children: (tasks: Task[]) => React.ReactNode;
}) {
  const router = useRouter();
  // A fixed id keeps dnd-kit's screen reader ids the same on the server and in the browser.
  const dndId = useId();
  const [, startTransition] = useTransition();
  const [items, move] = useOptimistic(tasks, (state, { id, value }: { id: string; value: Task[F] }) =>
    state.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragging = items.find((t) => t.id === draggingId);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A short press and hold, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );

  function drop({ active, over }: DragEndEvent) {
    setDraggingId(null);
    const task = items.find((t) => t.id === active.id);
    const value = over?.id as Task[F] | undefined;
    if (!task || !value || task[field] === value) return;
    startTransition(async () => {
      move({ id: task.id, value });
      try {
        await op("update_task", { id: task.id, [field]: value });
      } catch (err) {
        showToast(`Couldn't move it. ${(err as Error).message}`);
      }
      router.refresh();
    });
  }

  const titleOf = (id: string | number) => items.find((t) => t.id === id)?.title ?? "task";
  const cardTitle = (id: string | number | undefined) => labels[id as Task[F]];
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up "${titleOf(active.id)}".`,
    onDragOver: ({ active, over }) =>
      over ? `"${titleOf(active.id)}" is over ${cardTitle(over.id)}.` : `"${titleOf(active.id)}" is not over a card.`,
    onDragEnd: ({ active, over }) =>
      over ? `"${titleOf(active.id)}" moved to ${cardTitle(over.id)}.` : `"${titleOf(active.id)}" put back.`,
    onDragCancel: ({ active }) => `Cancelled. "${titleOf(active.id)}" put back.`,
  };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={findCard}
      onDragStart={({ active }) => setDraggingId(String(active.id))}
      onDragEnd={drop}
      onDragCancel={() => setDraggingId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "Press Space to pick up the task, use the arrow keys to move it, and Space again to drop it.",
        },
      }}
    >
      {children(items)}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="motion-lift scale-[1.03] rotate-1 rounded-xl border bg-card px-4 py-3 text-control font-medium">
            {dragging.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** One card to drop tasks on: its icon, name and count, then whatever goes inside. */
export function DropCard({
  id,
  label,
  icon: Icon,
  count,
  children,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <Card ref={setNodeRef} aria-label={label} className={cn("transition-colors", isOver && "border-ring")}>
      <div className="flex items-center gap-2 border-b px-4 py-3.5">
        <Icon className="size-[18px] text-icon" aria-hidden />
        <h2 className="text-heading font-medium">{label}</h2>
        <span className="text-meta text-muted-foreground">{count}</span>
      </div>
      {children}
    </Card>
  );
}

/** A task row that can be picked up and dropped on another card. */
export function DraggableRow({
  task,
  today,
  columns,
  projects,
}: {
  task: Task;
  today: string;
  columns?: boolean;
  projects?: CellProject[];
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({ id: task.id });
  return (
    <TaskRow
      task={task}
      today={today}
      showProject
      columns={columns}
      projects={projects}
      li={{
        ref: (el) => {
          setNodeRef(el);
          // Only Space on the row itself picks it up, so Space still presses the buttons inside it.
          setActivatorNodeRef(el);
        },
        ...attributes,
        ...listeners,
        "aria-roledescription": "task",
        "aria-label": task.title,
        className: cn("touch-manipulation select-none [-webkit-touch-callout:none]", isDragging && "opacity-40"),
      }}
    />
  );
}

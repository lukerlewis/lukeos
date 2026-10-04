"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Check, CheckSquare, Columns3, MessageSquare, Paperclip, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useState, useTransition } from "react";
import { Fab } from "@/components/shell/fab";
import { showToast } from "@/components/shell/toast";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import { Card as Panel } from "@/components/ui/card";
import type { CardSummary, PipelineColumn } from "@/core/pipeline";
import { isInbox } from "@/lib/inbox";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { CardDialog, type CardDraft } from "./card-dialog";
import { ColumnsDialog } from "./columns-dialog";

export type PipelineData = (PipelineColumn & { cards: CardSummary[] })[];

const findColumn: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
};

/**
 * A project's pipeline: its columns side by side, each holding cards. Drag a
 * card to another column to move it along (press and hold on a phone); tap it
 * to open it.
 */
export function PipelineBoard({
  projectId,
  columns,
  openCardId,
  timeZone,
  today,
  toolbar,
}: {
  projectId: string;
  columns: PipelineData;
  /** A card to open straight away (from a link like /cards/<id>). */
  openCardId?: string;
  timeZone: string;
  today: string;
  /** The Board switch, shown on the same row as the pipeline's buttons. */
  toolbar?: React.ReactNode;
}) {
  const router = useRouter();
  const dndId = useId();
  const [, startTransition] = useTransition();
  const cards = columns.flatMap((c) => c.cards.map((card) => ({ ...card, columnId: c.id })));
  // to: null hides the card (a rejected idea).
  const [items, move] = useOptimistic(cards, (state, { id, to }: { id: string; to: string | null }) => {
    const card = state.find((c) => c.id === id);
    if (!card) return state;
    const rest = state.filter((c) => c.id !== id);
    return to ? [...rest, { ...card, columnId: to }] : rest;
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(openCardId ? { id: openCardId } : null);
  const [editingColumns, setEditingColumns] = useState(false);
  const dragging = items.find((c) => c.id === draggingId);
  const list = columns.map(({ id, name, position }) => ({ id, name, position }));

  // A link to a card opens it once, then the address goes back to plain.
  useEffect(() => {
    if (!openCardId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("card");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, [openCardId]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );

  function drop({ active, over }: DragEndEvent) {
    setDraggingId(null);
    const card = items.find((c) => c.id === active.id);
    if (!card || !over || over.id === card.columnId) return;
    const to = String(over.id);
    startTransition(async () => {
      move({ id: card.id, to });
      try {
        await op("move_card", { id: card.id, to });
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  }

  /** Inbox: Approve moves an idea on to the next column. */
  function approve(card: CardSummary) {
    const next = list[list.findIndex((c) => c.id === card.columnId) + 1];
    if (!next) return;
    startTransition(async () => {
      move({ id: card.id, to: next.id });
      try {
        await op("approve_card", { id: card.id });
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  }

  /** Inbox: Reject hides an idea, but Claude keeps it so it isn't suggested again. */
  function reject(card: CardSummary) {
    startTransition(async () => {
      move({ id: card.id, to: null });
      try {
        await op("reject_card", { id: card.id });
        showToast("Idea rejected", async () => {
          await op("unreject_card", { id: card.id });
          router.refresh();
        });
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  }

  const titleOf = (id: string | number) => items.find((c) => c.id === id)?.title ?? "card";
  const columnName = (id: string | number | undefined) => list.find((c) => c.id === id)?.name;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up "${titleOf(active.id)}".`,
    onDragOver: ({ active, over }) =>
      over ? `"${titleOf(active.id)}" is over ${columnName(over.id)}.` : `"${titleOf(active.id)}" is not over a column.`,
    onDragEnd: ({ active, over }) =>
      over ? `"${titleOf(active.id)}" moved to ${columnName(over.id)}.` : `"${titleOf(active.id)}" put back.`,
    onDragCancel: ({ active }) => `Cancelled. "${titleOf(active.id)}" put back.`,
  };

  const newCard = (columnId?: string) => setDraft({ projectId, columnId: columnId ?? list[0]?.id });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="grow" />
        {list.length > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditingColumns(true)} aria-label="Columns" className="max-md:size-9 max-md:px-0">
              <Columns3 className="size-4" aria-hidden />
              <span className="max-md:hidden">Columns</span>
            </Button>
            <Button size="sm" onClick={() => newCard()} className="max-md:hidden">
              <Plus className="size-4" aria-hidden />
              New card
            </Button>
          </>
        )}
      </div>

      {list.length === 0 ? (
        <StartPipeline projectId={projectId} />
      ) : (
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
              draggable:
                "Press Space to pick up the card, use the arrow keys to move it, and Space again to drop it. Press Enter to open it.",
            },
          }}
        >
          <div
            data-no-pull
            className={cn(
              "-mx-5 flex scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 md:-mx-10 md:scroll-px-10 md:px-10",
              !draggingId && "snap-x snap-mandatory md:snap-none",
            )}
          >
            {list.map((column) => {
              const inColumn = items.filter((c) => c.columnId === column.id);
              return (
                <Column key={column.id} column={column} count={inColumn.length} onAdd={() => newCard(column.id)}>
                  {inColumn.map((card) => (
                    <DraggableCard
                      key={card.id}
                      card={card}
                      onOpen={() => setDraft({ id: card.id })}
                      review={isInbox(column) ? { onApprove: () => approve(card), onReject: () => reject(card), canApprove: column.id !== list.at(-1)?.id } : undefined}
                    />
                  ))}
                </Column>
              );
            })}
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging && <CardBody card={dragging} className="motion-lift scale-[1.03] rotate-1 shadow-lg" />}
          </DragOverlay>
        </DndContext>
      )}

      {list.length > 0 && <Fab label="New card" onClick={() => newCard()} />}

      {draft && (
        <CardDialog
          key={draft.id ?? "new"}
          initial={draft}
          columns={list}
          timeZone={timeZone}
          today={today}
          onClose={() => setDraft(null)}
        />
      )}
      {editingColumns && (
        <ColumnsDialog
          projectId={projectId}
          columns={columns.map((c) => ({ ...c, count: items.filter((card) => card.columnId === c.id).length }))}
          onClose={() => setEditingColumns(false)}
        />
      )}
    </>
  );
}

/** A project with no pipeline yet: one button to start one with the usual columns. */
function StartPipeline({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      await op("set_up_pipeline", { projectId });
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Panel className="flex max-w-3xl flex-col items-center gap-3 px-4 py-8">
      <p className="text-[13px] text-muted-foreground">No pipeline yet.</p>
      <Button onClick={start} disabled={busy}>
        <Plus className="size-4" aria-hidden />
        Start a pipeline
      </Button>
    </Panel>
  );
}

function Column({
  column,
  count,
  onAdd,
  children,
}: {
  column: PipelineColumn;
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={column.name}
      className={cn(
        "flex min-h-48 w-[82vw] max-w-80 shrink-0 snap-start flex-col gap-2.5 rounded-xl border bg-sidebar p-2.5 transition-colors md:w-64 lg:w-auto lg:min-w-52 lg:flex-1",
        isOver && "border-ring bg-muted",
      )}
    >
      <header className="flex items-start gap-2 px-1.5 pt-1">
        <h2 className="flex min-w-0 grow items-baseline gap-2 text-sm font-semibold">
          <span className="truncate">{column.name}</span>
          <span className="text-xs font-normal text-muted-foreground">{count}</span>
        </h2>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add a card to ${column.name}`}
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

type Review = { onApprove: () => void; onReject: () => void; canApprove: boolean };

function DraggableCard({ card, onOpen, review }: { card: CardSummary; onOpen: () => void; review?: Review }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: card.id });
  return (
    <li ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <CardBody
        card={card}
        {...attributes}
        {...listeners}
        aria-roledescription="card"
        aria-label={card.title}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isDragging) onOpen();
          else listeners?.onKeyDown?.(e);
        }}
      >
        {review && <ReviewButtons {...review} />}
      </CardBody>
    </li>
  );
}

/** Approve / Reject on an Inbox card. Pressing them never drags or opens the card. */
function ReviewButtons({ onApprove, onReject, canApprove }: Review) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const button =
    "pressable flex h-9 grow items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium md:h-8 md:text-xs";
  return (
    <div className="flex gap-2 pt-1" onPointerDown={stop} onKeyDown={stop} onClick={stop}>
      <button type="button" onClick={onReject} className={cn(button, "text-muted-foreground hover:bg-muted hover:text-foreground")}>
        <X className="size-3.5" aria-hidden />
        Reject
      </button>
      {canApprove && (
        <button type="button" onClick={onApprove} className={cn(button, "border-transparent bg-primary text-primary-foreground hover:opacity-90")}>
          <Check className="size-3.5" aria-hidden />
          Approve
        </button>
      )}
    </div>
  );
}

function CardBody({ card, className, children, ...rest }: { card: CardSummary } & React.ComponentProps<"div">) {
  const tasks = card.taskCount.open + card.taskCount.done;
  const meta = tasks > 0 || card.attachmentCount > 0 || card.openComments > 0 || card.madeBy.kind === "agent";
  return (
    <div
      {...rest}
      className={cn(
        "pressable flex cursor-grab touch-manipulation flex-col gap-1.5 rounded-[10px] border bg-card p-3 text-left shadow-xs select-none [-webkit-touch-callout:none] active:cursor-grabbing",
        className,
      )}
    >
      <span className="font-medium break-words">{card.title}</span>
      {card.excerpt && <span className="line-clamp-2 text-xs text-muted-foreground">{card.excerpt}</span>}
      {meta && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5 text-xs text-muted-foreground">
          {tasks > 0 && (
            <span className="inline-flex items-center gap-1" title={`${card.taskCount.done} of ${tasks} tasks done`}>
              <CheckSquare className="size-3.5" aria-hidden />
              {card.taskCount.done}/{tasks}
            </span>
          )}
          {card.attachmentCount > 0 && (
            <span className="inline-flex items-center gap-1" title={`${card.attachmentCount} attached`}>
              <Paperclip className="size-3.5" aria-hidden />
              {card.attachmentCount}
            </span>
          )}
          {card.openComments > 0 && (
            <span className="inline-flex items-center gap-1" title={`${card.openComments} open comments`}>
              <MessageSquare className="size-3.5" aria-hidden />
              {card.openComments}
            </span>
          )}
          <ClaudeBadge madeBy={card.madeBy} />
        </div>
      )}
      {children}
    </div>
  );
}

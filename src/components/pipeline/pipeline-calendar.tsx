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
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";
import { Fab } from "@/components/shell/fab";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import type { CardSummary } from "@/core/pipeline";
import { addDays, addMonths, endOfMonth, endOfWeek } from "@/lib/dates";
import { useWithoutHidden } from "@/lib/background";
import { isInbox } from "@/lib/inbox";
import { op } from "@/lib/ops-client";
import { cn } from "@/lib/utils";
import { CardDialog, type BoardChange, type CardDraft } from "./card-dialog";
import { StartPipeline, type PipelineData } from "./pipeline-board";

export type CalendarSpan = "week" | "month";

const NO_DATE = "no-date";
const dayId = (day: string) => `day:${day}`;
const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shortMonth = (day: string) => monthNames[Number(day.slice(5, 7)) - 1].slice(0, 3);
const dayOfMonth = (day: string) => Number(day.slice(8, 10));

/** The Monday of the week `day` is in. */
function startOfWeek(day: string) {
  return addDays(endOfWeek(day), -6);
}

/** Every day from `from` to `to`, both included. */
function daysFrom(from: string, to: string) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** "November 2026", or for a week "10 – 16 Nov 2026" / "27 Oct – 2 Nov 2026". */
function heading(span: CalendarSpan, day: string) {
  if (span === "month") return `${monthNames[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
  const from = startOfWeek(day);
  const to = endOfWeek(day);
  const start = from.slice(5, 7) === to.slice(5, 7) ? `${dayOfMonth(from)}` : `${dayOfMonth(from)} ${shortMonth(from)}`;
  const year = from.slice(0, 4) === to.slice(0, 4) ? "" : ` ${from.slice(0, 4)}`;
  return `${start}${year} – ${dayOfMonth(to)} ${shortMonth(to)} ${to.slice(0, 4)}`;
}

const findDrop: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
};

/**
 * A project's pipeline cards on a calendar, by the day each is planned for.
 * Month or Week; drag a card to another day to move it (press and hold on a
 * phone), or from "No date" onto a day to give it one. Tap a card to open it.
 */
export function PipelineCalendar({
  projectId,
  columns,
  span,
  day,
  base,
  timeZone,
  today,
  toolbar,
}: {
  projectId: string;
  columns: PipelineData;
  span: CalendarSpan;
  /** A day in the month or week shown. */
  day: string;
  /** This view's address, before its span and day. */
  base: string;
  timeZone: string;
  today: string;
  /** The Board switch, shown on the same row. */
  toolbar?: React.ReactNode;
}) {
  const router = useRouter();
  const dndId = useId();
  const [, startTransition] = useTransition();
  const list = columns.map(({ id, name, position }) => ({ id, name, position }));
  const columnName = (id: string | null) => list.find((c) => c.id === id)?.name ?? "";
  const cards = columns.flatMap((c) => c.cards.map((card) => ({ ...card, columnId: c.id })));
  const [all, change] = useOptimistic(cards, (state, { id, to, date }: BoardChange) =>
    to === null
      ? state.filter((c) => c.id !== id)
      : state.map((c) => (c.id === id ? { ...c, ...(to && { columnId: to }), ...(date !== undefined && { date }) } : c)),
  );
  const items = useWithoutHidden(all);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Phones show the month as a grid of days with dots; the picked day's cards are listed under it.
  const [picked, setPicked] = useState(day);
  const [showUndated, setShowUndated] = useState(false);
  const dragging = items.find((c) => c.id === draggingId);

  const href = (params: { span?: CalendarSpan; day?: string }) => {
    const q = new URLSearchParams({ span: params.span ?? span, ...(params.day && { day: params.day }) });
    return `${base}&${q}`;
  };
  const step = (n: number) => (span === "month" ? addMonths(day, n) : addDays(day, 7 * n));

  const days =
    span === "month"
      ? daysFrom(startOfWeek(`${day.slice(0, 7)}-01`), endOfWeek(endOfMonth(day)))
      : daysFrom(startOfWeek(day), endOfWeek(day));
  const byDay = new Map<string, CardSummary[]>();
  for (const card of items) if (card.date) byDay.set(card.date, [...(byDay.get(card.date) ?? []), card]);
  // Ideas still waiting in the Inbox aren't planned yet, so they stay off the No date list.
  const inboxIds = new Set(list.filter((c) => isInbox(c)).map((c) => c.id));
  const undated = items.filter((c) => !c.date && !inboxIds.has(c.columnId ?? ""));

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );

  function save(next: BoardChange, fields: Record<string, unknown>) {
    startTransition(async () => {
      change(next);
      try {
        await op("update_card", { id: next.id, ...fields });
      } catch (err) {
        showToast((err as Error).message);
      }
      router.refresh();
    });
  }

  function drop({ active, over }: DragEndEvent) {
    setDraggingId(null);
    const card = items.find((c) => c.id === active.id);
    if (!card || !over) return;
    const target = String(over.id);
    const date = target === NO_DATE ? null : target.slice(4);
    if (date === card.date) return;
    save({ id: card.id, date }, { date });
  }

  function inBoard(next: BoardChange | null, request: () => Promise<unknown>) {
    startTransition(async () => {
      if (next) change(next);
      try {
        await request();
      } catch (err) {
        showToast((err as Error).message);
      }
      router.refresh();
    });
  }

  /** Inbox: Approve or Reject from inside an open card. */
  function review(id: string, action: "approve" | "reject") {
    const card = items.find((c) => c.id === id);
    if (!card) return;
    const next = list[list.findIndex((c) => c.id === card.columnId) + 1];
    inBoard(action === "approve" ? (next ? { id, to: next.id } : null) : { id, to: null }, () =>
      op(action === "approve" ? "approve_card" : "reject_card", { id }),
    );
  }

  // A new card starts in the first column after the Inbox, on the day it was added from.
  const firstColumn = list.find((c) => !isInbox(c)) ?? list[0];
  const newCard = (date?: string) => setDraft({ projectId, columnId: firstColumn?.id, date });
  const open = (card: CardSummary) => setDraft({ id: card.id });

  const pickedCards = byDay.get(picked) ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="grow" />
        {list.length > 0 && (
          <Button size="sm" onClick={() => newCard()} className="max-md:hidden">
            <Plus className="size-4" aria-hidden />
            New card
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <StartPipeline projectId={projectId} />
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={findDrop}
          onDragStart={({ active }) => setDraggingId(String(active.id))}
          onDragEnd={drop}
          onDragCancel={() => setDraggingId(null)}
          accessibility={{
            screenReaderInstructions: {
              draggable: "Press Space to pick up the card, use the arrow keys to move it to another day, and Space again to drop it. Press Enter to open it.",
            },
          }}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <section className="flex min-w-0 grow flex-col gap-3" aria-label="Calendar">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center">
                  <NavLink href={href({ day: step(-1) })} label={span === "month" ? "Previous month" : "Previous week"}>
                    <ChevronLeft className="size-5" aria-hidden />
                  </NavLink>
                  <NavLink href={href({ day: step(1) })} label={span === "month" ? "Next month" : "Next week"}>
                    <ChevronRight className="size-5" aria-hidden />
                  </NavLink>
                </div>
                <h2 className="grow text-heading font-medium">{heading(span, day)}</h2>
                <Link
                  href={href({})}
                  replace
                  scroll={false}
                  onClick={() => setPicked(today)}
                  className="press inline-flex h-9 items-center rounded-lg border border-stroke px-3 text-preview font-medium hover:bg-muted"
                >
                  Today
                </Link>
                <SegmentedLinks
                  label="Calendar span"
                  options={[
                    { href: href({ span: "week", day }), label: "Week", active: span === "week" },
                    { href: href({ span: "month", day }), label: "Month", active: span === "month" },
                  ]}
                />
              </div>

              {span === "month" ? (
                <div className="overflow-hidden rounded-xl border">
                  <div className="grid grid-cols-7 border-b bg-sidebar">
                    {weekdayNames.map((name) => (
                      <div key={name} className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground md:text-left">
                        {name}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {days.map((d) => (
                      <MonthDay
                        key={d}
                        day={d}
                        today={today}
                        outside={d.slice(0, 7) !== day.slice(0, 7)}
                        picked={d === picked}
                        cards={byDay.get(d) ?? []}
                        columnName={columnName}
                        onPick={() => setPicked(d)}
                        onAdd={() => newCard(d)}
                        onOpen={open}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 md:grid md:grid-cols-7 md:gap-0 md:overflow-hidden md:rounded-xl md:border">
                  {days.map((d) => (
                    <WeekDay key={d} day={d} today={today} cards={byDay.get(d) ?? []} columnName={columnName} onAdd={() => newCard(d)} onOpen={open} />
                  ))}
                </div>
              )}

              {/* Phones: the picked day's cards, under the month. */}
              {span === "month" && (
                <section className="flex flex-col gap-2 md:hidden" aria-label="Picked day">
                  <h3 className="px-1 text-sm font-medium">{longDay(picked, today)}</h3>
                  {pickedCards.length ? (
                    <ul className="flex flex-col gap-2">
                      {pickedCards.map((card) => (
                        <li key={card.id}>
                          <DraggableCard card={card} column={columnName(card.columnId)} onOpen={() => open(card)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="flex h-14 items-center justify-center rounded-[10px] border border-dashed text-meta text-muted-foreground">Nothing planned</p>
                  )}
                </section>
              )}
            </section>

            <Undated
              cards={undated}
              columnName={columnName}
              open={showUndated}
              onToggle={() => setShowUndated((v) => !v)}
              onOpen={open}
            />
          </div>

          <DragOverlay dropAnimation={null}>
            {dragging && <CardChip card={dragging} column={columnName(dragging.columnId)} className="motion-lift scale-[1.03] rotate-1" />}
          </DragOverlay>
        </DndContext>
      )}

      {list.length > 0 && <Fab label="New card" onClick={() => newCard(span === "month" ? picked : undefined)} />}

      {draft && (
        <CardDialog
          key={draft.id ?? "new"}
          initial={draft}
          columns={list}
          timeZone={timeZone}
          today={today}
          onClose={() => setDraft(null)}
          inBoard={inBoard}
          onReview={review}
        />
      )}
    </>
  );
}

/** "Today", or "Wednesday 12 November". */
function longDay(day: string, today: string) {
  if (day === today) return "Today";
  const weekday = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
  return `${weekday} ${dayOfMonth(day)} ${monthNames[Number(day.slice(5, 7)) - 1]}`;
}

function NavLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      replace
      scroll={false}
      aria-label={label}
      title={label}
      className="press flex size-9 items-center justify-center rounded-lg text-icon hover:bg-muted hover:text-foreground"
    >
      {children}
    </Link>
  );
}

/** The day's number; today's sits in a dark circle. */
function DayNumber({ day, today, className }: { day: string; today: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-full text-meta",
        day === today && "bg-primary font-medium text-primary-foreground",
        className,
      )}
    >
      {dayOfMonth(day)}
    </span>
  );
}

function AddButton({ day, onAdd }: { day: string; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAdd();
      }}
      aria-label={`Add a card on ${day}`}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 max-md:hidden"
    >
      <Plus className="size-3.5" aria-hidden />
    </button>
  );
}

function MonthDay({
  day,
  today,
  outside,
  picked,
  cards,
  columnName,
  onPick,
  onAdd,
  onOpen,
}: {
  day: string;
  today: string;
  outside: boolean;
  picked: boolean;
  cards: CardSummary[];
  columnName: (id: string | null) => string;
  onPick: () => void;
  onAdd: () => void;
  onOpen: (card: CardSummary) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayId(day) });
  return (
    <div
      ref={setNodeRef}
      onClick={onPick}
      className={cn(
        "group flex min-h-14 min-w-0 flex-col gap-1 border-r border-b p-1 transition-colors md:min-h-28 md:p-1.5 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0",
        outside && "bg-sidebar text-muted-foreground",
        isOver && "bg-muted",
      )}
    >
      <div className="flex items-center justify-between max-md:justify-center">
        <DayNumber day={day} today={today} className={cn(picked && day !== today && "max-md:bg-selected max-md:text-ink")} />
        <AddButton day={day} onAdd={onAdd} />
      </div>
      {/* Phones: a dot for each card (up to three). */}
      {cards.length > 0 && (
        <div className="flex justify-center gap-0.5 md:hidden" aria-label={`${cards.length} ${cards.length === 1 ? "card" : "cards"}`}>
          {cards.slice(0, 3).map((c) => (
            <span key={c.id} className="size-1.5 rounded-full bg-foreground" />
          ))}
        </div>
      )}
      <ul className="flex flex-col gap-1 max-md:hidden">
        {cards.map((card) => (
          <li key={card.id}>
            <DraggableCard card={card} column={columnName(card.columnId)} compact onOpen={() => onOpen(card)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function WeekDay({
  day,
  today,
  cards,
  columnName,
  onAdd,
  onOpen,
}: {
  day: string;
  today: string;
  cards: CardSummary[];
  columnName: (id: string | null) => string;
  onAdd: () => void;
  onOpen: (card: CardSummary) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayId(day) });
  const weekday = weekdayNames[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
  return (
    <section
      ref={setNodeRef}
      aria-label={longDay(day, today)}
      className={cn(
        "group flex min-w-0 flex-col gap-2 rounded-xl border p-2 transition-colors md:min-h-80 md:rounded-none md:border-0 md:border-r md:last:border-r-0",
        isOver && "bg-muted",
      )}
    >
      <header className="flex items-center gap-1.5 px-0.5">
        <span className="text-xs font-medium text-muted-foreground">{weekday}</span>
        <DayNumber day={day} today={today} />
        <div className="grow" />
        <AddButton day={day} onAdd={onAdd} />
      </header>
      {cards.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {cards.map((card) => (
            <li key={card.id}>
              <DraggableCard card={card} column={columnName(card.columnId)} onOpen={() => onOpen(card)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Cards with no date yet: drag one onto a day to plan it. A box beside the calendar on wide screens, folded away on phones. */
function Undated({
  cards,
  columnName,
  open,
  onToggle,
  onOpen,
}: {
  cards: CardSummary[];
  columnName: (id: string | null) => string;
  open: boolean;
  onToggle: () => void;
  onOpen: (card: CardSummary) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: NO_DATE });
  return (
    <section
      ref={setNodeRef}
      aria-label="No date"
      className={cn(
        "flex shrink-0 flex-col gap-2 rounded-xl border bg-sidebar p-2.5 transition-colors lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:w-64 lg:overflow-y-auto",
        isOver && "border-ring bg-muted",
      )}
    >
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-2 px-1.5 pt-0.5 text-left md:pointer-events-none">
        <h2 className="flex grow items-baseline gap-2 text-sm font-medium">
          No date
          <span className="text-xs font-normal text-muted-foreground">{cards.length}</span>
        </h2>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform md:hidden", open && "rotate-180")} aria-hidden />
      </button>
      <ul className={cn("flex flex-col gap-1.5", !open && "max-md:hidden")}>
        {cards.length === 0 ? (
          <li className="flex h-12 items-center justify-center rounded-[10px] border border-dashed text-meta text-muted-foreground">Nothing here</li>
        ) : (
          cards.map((card) => (
            <li key={card.id}>
              <DraggableCard card={card} column={columnName(card.columnId)} onOpen={() => onOpen(card)} />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function DraggableCard({ card, column, compact, onOpen }: { card: CardSummary; column: string; compact?: boolean; onOpen: () => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: card.id });
  return (
    <CardChip
      ref={setNodeRef}
      card={card}
      column={column}
      compact={compact}
      {...attributes}
      {...listeners}
      aria-roledescription="card"
      aria-label={card.title}
      className={cn(isDragging && "opacity-40")}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isDragging) onOpen();
        else listeners?.onKeyDown?.(e);
      }}
    />
  );
}

/** A card on the calendar: its name, and the column it's in. Compact (in a month's day): the name on one line. */
function CardChip({
  card,
  column,
  compact,
  className,
  ...rest
}: { card: CardSummary; column: string; compact?: boolean } & React.ComponentProps<"div">) {
  return (
    <div
      {...rest}
      title={compact ? `${card.title} · ${column}` : undefined}
      className={cn(
        "pressable flex cursor-grab touch-manipulation flex-col rounded-lg border bg-card text-left border-stroke select-none [-webkit-touch-callout:none] active:cursor-grabbing",
        compact ? "px-1.5 py-1" : "gap-0.5 px-2.5 py-2",
        className,
      )}
    >
      <span lang="en" className={cn("break-words hyphens-auto", compact ? "line-clamp-2 text-xs font-medium" : "text-preview font-medium")}>
        {card.title}
      </span>
      {!compact && column && <span className="truncate text-xs text-muted-foreground">{column}</span>}
    </div>
  );
}

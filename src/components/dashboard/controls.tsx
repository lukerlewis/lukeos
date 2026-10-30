"use client";

import { ArrowDownUp, Check, ChevronDown, GripVertical, List, Plus, SlidersHorizontal, SquareKanban, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { StatusIcon } from "@/components/tasks/status-circle";
import { rememberArea } from "@/lib/area";
import {
  defaultDashboardView,
  defaultSortDir,
  sortDirLabel,
  sortDirs,
  sortKeys,
  sortLabel,
  sortSummary,
  type DashboardLayout,
  type DashboardSort,
  type DashboardView,
  type SortDir,
  type SortKey,
  type SortRule,
} from "@/lib/dashboard";
import { inBackground } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { pushUndo } from "@/lib/undo";
import { areaLabel, areas, statuses, statusLabel, type Area, type Status } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

const pill = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-preview font-medium whitespace-nowrap";

const phoneAreaOrder: Record<Area, string> = { life: "order-1 md:order-none", work: "order-2 md:order-none", aya: "order-3 md:order-none" };

/**
 * The switches at the top of the dashboard: Aya, Work or Life (Life, Work, Aya on phones), the Today list or the Board, a
 * Filters menu for which statuses show and a Sort menu for the Today list. The area is
 * remembered on this device; the rest is saved, so it's the same next time and on other devices.
 */
export function DashboardControls({
  view,
  area,
  onArea,
  onLayout,
  onSort,
}: {
  view: DashboardView;
  area: Area;
  /** The screen switches area, tab and sort itself, straight away; these save the choice behind it. */
  onArea: (area: Area) => void;
  onLayout: (layout: DashboardLayout) => void;
  onSort: (sort: DashboardSort) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(view);

  // Refreshing afterwards keeps the saved copy of this screen up to date, for coming back to it.
  const refreshBehind = () => startTransition(() => router.refresh());

  function pickArea(next: Area) {
    rememberArea(next);
    onArea(next);
    refreshBehind();
  }

  function pickLayout(layout: DashboardLayout, undoTo = current.layout) {
    onLayout(layout);
    void inBackground(() => op("set_dashboard_view", { layout }), {
      then: () => {
        pushUndo("changing the dashboard", async () => {
          onLayout(undoTo);
          await op("set_dashboard_view", { layout: undoTo });
          refreshBehind();
        });
        refreshBehind();
      },
      failed: () => onLayout(undoTo),
      failure: "Couldn't save that.",
    });
  }

  function pickSort(sort: DashboardSort, undoTo = view.sort) {
    onSort(sort);
    void inBackground(() => op("set_dashboard_view", { sort }), {
      then: () => {
        pushUndo("changing the sort", async () => {
          onSort(undoTo);
          await op("set_dashboard_view", { sort: undoTo });
          refreshBehind();
        });
        refreshBehind();
      },
      failed: () => onSort(undoTo),
      failure: "Couldn't save that.",
    });
  }

  function change(changes: Partial<DashboardView>) {
    const previous = Object.fromEntries(Object.keys(changes).map((k) => [k, current[k as keyof DashboardView]]));
    startTransition(async () => {
      setCurrent({ ...current, ...changes });
      try {
        await op("set_dashboard_view", changes);
        pushUndo("changing the dashboard", async () => {
          await op("set_dashboard_view", previous);
        });
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  }

  function toggle(status: Status) {
    const show = toggled(current.show, status);
    if (show) change({ show });
  }

  const changedFilters = current.show.join() !== defaultDashboardView.show.join() ? 1 : 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Choice<Area>
        label="Aya, Work or Life"
        value={area}
        onChange={pickArea}
        // Phones put them the other way round: Life, Work, Aya.
        options={areas.map((a) => ({ value: a, label: areaLabel[a], className: phoneAreaOrder[a] }))}
      />
      <Choice<DashboardLayout>
        label="View"
        value={view.layout}
        onChange={(layout) => pickLayout(layout)}
        options={[
          { value: "list", label: "Today", icon: List },
          { value: "board", label: "Board", icon: SquareKanban },
        ]}
      />
      {/* Filters and Sort are for the computer; the phone keeps it simple. */}
      <div className="hidden md:contents">
        <Filters count={changedFilters}>
          <ShowToggle show={current.show} onToggle={toggle} />
        </Filters>
        <SortMenu sort={view.sort} onChange={(sort) => pickSort(sort)} />
      </div>
    </div>
  );
}

/** Which statuses show after switching one on or off, or null if it's the last one on (one must stay). */
function toggled(show: Status[], status: Status): Status[] | null {
  const on = show.includes(status);
  if (on && show.length === 1) return null;
  return statuses.filter((s) => (s === status ? !on : show.includes(s)));
}

/** The To do / Doing / Done buttons inside Filters. */
function ShowToggle({ show, onToggle }: { show: Status[]; onToggle: (status: Status) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground" aria-hidden>
        Show
      </span>
      <div role="group" aria-label="Show tasks that are" className="inline-flex gap-0.5 self-start seg-track rounded-lg p-[3px]">
        {statuses.map((s) => {
          const on = show.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(s)}
              title={on ? `Hide ${statusLabel[s]}` : `Show ${statusLabel[s]}`}
              className={cn(pill, "text-muted-foreground", on && "seg-on text-foreground")}
            >
              <StatusIcon status={s} className={cn("size-3.5", !on && "opacity-50")} />
              {statusLabel[s]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Sort dropdown, like Notion's: a list of sorts, most important first, each with its field
 * and which way round. Add more, remove one, or drag them by the handle to change which counts first.
 */
function SortMenu({ sort, onChange }: { sort: DashboardSort; onChange: (sort: DashboardSort) => void }) {
  return (
    <Menu
      label={sortSummary(sort)}
      icon={ArrowDownUp}
      aria-label={
        sort.length ? `Sort by ${sort.map((r) => `${sortLabel[r.by]}, ${sortDirLabel[r.by][r.dir]}`).join(", then ")}` : "Sort"
      }
    >
      {(close) => <SortPanel sort={sort} onChange={onChange} close={close} />}
    </Menu>
  );
}

const ROW = 44;
const select = "h-9 min-w-0 rounded-lg border bg-card px-2 text-preview border-stroke-strong";

function SortPanel({ sort, onChange, close }: { sort: DashboardSort; onChange: (sort: DashboardSort) => void; close: () => void }) {
  const [picking, setPicking] = useState(sort.length === 0);
  // While a sort is being dragged: where it started, where it would land, and how far the pointer has gone.
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const unused = sortKeys.filter((k) => !sort.some((r) => r.by === k));

  const rows = drag ? moved(sort, drag.from, drag.to) : sort;
  const set = (i: number, rule: SortRule) => onChange(sort.map((r, j) => (j === i ? rule : r)));

  function add(by: SortKey) {
    setPicking(false);
    onChange([...sort, { by, dir: defaultSortDir(by) }]);
  }

  function grab(e: React.PointerEvent, from: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let to = from;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      to = Math.max(0, Math.min(sort.length - 1, from + Math.round(dy / ROW)));
      setDrag({ from, to, dy });
    };
    const drop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", drop);
      target.removeEventListener("pointercancel", drop);
      setDrag(null);
      if (to !== from) onChange(moved(sort, from, to));
    };
    setDrag({ from, to, dy: 0 });
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", drop);
    target.addEventListener("pointercancel", drop);
  }

  function nudge(e: React.KeyboardEvent, i: number) {
    const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!by || i + by < 0 || i + by >= sort.length) return;
    e.preventDefault();
    onChange(moved(sort, i, i + by));
  }

  if (picking)
    return (
      <div role="menu" className="flex w-56 flex-col gap-0.5">
        <span className="px-2.5 pt-1 pb-1 text-xs font-medium text-muted-foreground">Sort by</span>
        {unused.map((by) => (
          <MenuItem key={by} on={false} onClick={() => add(by)}>
            {sortLabel[by]}
          </MenuItem>
        ))}
      </div>
    );

  return (
    <div className="flex w-[22rem] flex-col gap-1">
      <ol aria-label="Sorts, most important first" className="flex flex-col">
        {rows.map((rule, i) => {
          const dragging = drag !== null && rule.by === sort[drag.from].by;
          return (
            <li
              key={rule.by}
              className={cn("relative flex h-11 items-center gap-1.5 rounded-lg px-1", dragging && "z-10 bg-muted")}
              style={dragging ? { transform: `translateY(${drag.dy - (drag.to - drag.from) * ROW}px)` } : undefined}
            >
              <button
                type="button"
                aria-label={`Move ${sortLabel[rule.by]} sort. Use the arrow keys to move it up or down.`}
                title="Drag to reorder"
                onPointerDown={(e) => grab(e, i)}
                onKeyDown={(e) => nudge(e, i)}
                className={cn(
                  "flex h-9 w-6 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted",
                  dragging ? "cursor-grabbing" : "cursor-grab",
                  sort.length === 1 && "invisible",
                )}
              >
                <GripVertical className="size-4" aria-hidden />
              </button>
              <select
                value={rule.by}
                onChange={(e) => {
                  const by = e.target.value as SortKey;
                  set(i, { by, dir: defaultSortDir(by) });
                }}
                aria-label={`Sort ${i + 1} field`}
                className={cn(select, "grow basis-0")}
              >
                {sortKeys
                  .filter((k) => k === rule.by || !sort.some((r) => r.by === k))
                  .map((k) => (
                    <option key={k} value={k}>
                      {sortLabel[k]}
                    </option>
                  ))}
              </select>
              <select
                value={rule.dir}
                onChange={(e) => set(i, { ...rule, dir: e.target.value as SortDir })}
                aria-label={`Sort ${i + 1} order`}
                className={cn(select, "grow-[1.3] basis-0")}
              >
                {sortDirs.map((d) => (
                  <option key={d} value={d}>
                    {sortDirLabel[rule.by][d]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove ${sortLabel[rule.by]} sort`}
                onClick={() => {
                  const next = sort.filter((_, j) => j !== i);
                  onChange(next);
                  if (!next.length) close();
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-0.5 border-t pt-1">
        {unused.length > 0 && (
          <button type="button" onClick={() => setPicking(true)} className={footerButton}>
            <Plus className="size-4" aria-hidden />
            Add sort
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            close();
            onChange([]);
          }}
          className={footerButton}
        >
          <Trash2 className="size-4" aria-hidden />
          Delete sort
        </button>
      </div>
    </div>
  );
}

const footerButton =
  "press-tint flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-preview text-muted-foreground hover:bg-muted hover:text-foreground";

/** The list with the item at `from` taken out and put back at `to`. */
function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The Sort dropdown on a project's list and board. It's the same saved sort as the dashboard's,
 * so tasks are ordered the same way everywhere. Computers only, like on the dashboard.
 */
export function TaskSortMenu({ sort }: { sort: DashboardSort }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(sort);

  function change(next: DashboardSort) {
    startTransition(async () => {
      setCurrent(next);
      try {
        await op("set_dashboard_view", { sort: next });
        pushUndo("changing the sort", async () => {
          await op("set_dashboard_view", { sort });
        });
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  }

  return (
    <div className="hidden md:contents">
      <SortMenu sort={current} onChange={change} />
    </div>
  );
}

/**
 * The Filters dropdown on a project's list. It's the same saved To do / Doing / Done choice as the
 * dashboard's, so Done is hidden in both until Luke switches it on. Computers only, like on the dashboard.
 */
export function TaskFilterMenu({ show }: { show: Status[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(show);

  function toggle(status: Status) {
    const next = toggled(current, status);
    if (!next) return;
    startTransition(async () => {
      setCurrent(next);
      try {
        await op("set_dashboard_view", { show: next });
        pushUndo("changing the filter", async () => {
          await op("set_dashboard_view", { show });
        });
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  }

  return (
    <div className="hidden md:contents">
      <Filters count={current.join() !== defaultDashboardView.show.join() ? 1 : 0}>
        <ShowToggle show={current} onToggle={toggle} />
      </Filters>
    </div>
  );
}

function MenuItem({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "press-tint flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-preview hover:bg-muted",
        on && "bg-selected font-medium text-ink hover:bg-selected",
      )}
    >
      <span className="grow">{children}</span>
      {on && <Check className="size-4" aria-hidden />}
    </button>
  );
}

/** A button like Filters that opens a small menu below it. Closes on a click outside or Escape. */
function Menu({
  label,
  icon: Icon,
  children,
  ...rest
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: (close: () => void) => React.ReactNode;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const click = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={rest["aria-label"]}
        onClick={() => setOpen((o) => !o)}
        className={cn(pill, "h-[38px] border bg-card text-foreground hover:bg-muted/50")}
      >
        <Icon className="size-3.5" aria-hidden />
        {label}
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        // Lines up with the button's right edge: Sort sits at the right of the page, and its panel is wide.
        <div className="motion-pop absolute right-0 z-30 mt-2 origin-top-right rounded-xl border bg-card p-1 border-stroke">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A "Filters" button that opens a small panel below it. Closes on a click outside or Escape. */
function Filters({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const click = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(pill, "h-[38px] border bg-card text-foreground hover:bg-muted/50")}
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filters
        {count > 0 && (
          <span className="rounded-full bg-foreground px-1.5 text-xs leading-4 text-background tabular-nums">{count}</span>
        )}
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="motion-pop absolute right-0 z-30 mt-2 origin-top-right sm:right-auto sm:left-0 sm:origin-top-left flex w-max flex-col gap-4 rounded-xl border bg-card p-4 border-stroke">{children}</div>
      )}
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }>; className?: string }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 seg-track rounded-lg p-[3px]">
      {options.map(({ value: v, label, icon: Icon, className }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => value !== v && onChange(v)}
          className={cn(pill, "text-muted-foreground", value === v && "seg-on text-foreground", className)}
        >
          {Icon && <Icon className="size-3.5" aria-hidden />}
          {label}
        </button>
      ))}
    </div>
  );
}

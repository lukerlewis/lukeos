"use client";

import { ArrowDownUp, Check, ChevronDown, List, SlidersHorizontal, SquareKanban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { StatusIcon } from "@/components/tasks/status-circle";
import { rememberArea } from "@/lib/area";
import {
  defaultDashboardView,
  sortDirLabel,
  sortDirs,
  sortKeys,
  sortLabel,
  type DashboardLayout,
  type DashboardView,
} from "@/lib/dashboard";
import { op } from "@/lib/ops-client";
import { pushUndo } from "@/lib/undo";
import { areaLabel, areas, statuses, statusLabel, type Area, type Status } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

const pill = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-preview font-medium whitespace-nowrap";

/**
 * The switches at the top of the dashboard: Work or Life, the Today list or the Board, a
 * Filters menu for which statuses show and a Sort menu for the Today list. Work or Life is
 * remembered on this device; the rest is saved, so it's the same next time and on other devices.
 */
export function DashboardControls({ view, area }: { view: DashboardView; area: Area }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(view);
  const [shownArea, setShownArea] = useOptimistic(area);

  function pickArea(next: Area) {
    rememberArea(next);
    startTransition(() => {
      setShownArea(next);
      router.refresh();
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
    const on = current.show.includes(status);
    // Always keep at least one status showing.
    if (on && current.show.length === 1) return;
    change({ show: statuses.filter((s) => (s === status ? !on : current.show.includes(s))) });
  }

  const changedFilters = current.show.join() !== defaultDashboardView.show.join() ? 1 : 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Choice<Area>
        label="Work or Life"
        value={shownArea}
        onChange={pickArea}
        options={areas.map((a) => ({ value: a, label: areaLabel[a] }))}
      />
      <Choice<DashboardLayout>
        label="View"
        value={current.layout}
        onChange={(layout) => change({ layout })}
        options={[
          { value: "list", label: "Today", icon: List },
          { value: "board", label: "Board", icon: SquareKanban },
        ]}
      />
      {/* Filters and Sort are for the computer; the phone keeps it simple. */}
      <div className="hidden md:contents">
        <Filters count={changedFilters}>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground" aria-hidden>
              Show
            </span>
            <div role="group" aria-label="Show tasks that are" className="inline-flex gap-0.5 self-start seg-track rounded-lg p-[3px]">
              {statuses.map((s) => {
                const on = current.show.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s)}
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
        </Filters>
        {current.layout === "list" && (
          <Menu
            label={sortLabel[current.sort.by]}
            icon={ArrowDownUp}
            aria-label={`Sort by ${sortLabel[current.sort.by]}, ${sortDirLabel[current.sort.by][current.sort.dir]}`}
          >
            {(close) => (
              <div role="menu" className="flex w-56 flex-col gap-0.5">
                <span className="px-2.5 pt-1 pb-1 text-xs font-medium text-muted-foreground">Sort by</span>
                {sortKeys.map((by) => (
                  <MenuItem
                    key={by}
                    on={current.sort.by === by}
                    onClick={() => {
                      close();
                      if (current.sort.by !== by) change({ sort: { by, dir: by === "name" || by === "project" ? "asc" : "desc" } });
                    }}
                  >
                    {sortLabel[by]}
                  </MenuItem>
                ))}
                <div className="my-1 border-t" />
                {sortDirs.map((dir) => (
                  <MenuItem
                    key={dir}
                    on={current.sort.dir === dir}
                    onClick={() => {
                      close();
                      if (current.sort.dir !== dir) change({ sort: { ...current.sort, dir } });
                    }}
                  >
                    {sortDirLabel[current.sort.by][dir]}
                  </MenuItem>
                ))}
              </div>
            )}
          </Menu>
        )}
      </div>
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

/** A button like Filters that opens a small menu below it. Closes on a pick, a click outside or Escape. */
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
        <div className="motion-pop absolute right-0 z-30 mt-2 origin-top-right sm:right-auto sm:left-0 sm:origin-top-left rounded-xl border bg-card p-1 border-stroke">
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
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 seg-track rounded-lg p-[3px]">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => value !== v && onChange(v)}
          className={cn(pill, "text-muted-foreground", value === v && "seg-on text-foreground")}
        >
          {Icon && <Icon className="size-3.5" aria-hidden />}
          {label}
        </button>
      ))}
    </div>
  );
}

"use client";

import { ChevronDown, List, SlidersHorizontal, SquareKanban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { StatusIcon } from "@/components/tasks/status-circle";
import { defaultDashboardView, type DashboardLayout, type DashboardView } from "@/lib/dashboard";
import { op } from "@/lib/ops-client";
import { pushUndo } from "@/lib/undo";
import { statuses, statusLabel, type Status } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

const pill = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap";

/**
 * The switches at the top of the dashboard: the Today list or the Board, and a
 * Filters menu for which statuses show. Each change is saved, so the
 * dashboard looks the same next time and on other devices.
 */
export function DashboardControls({ view }: { view: DashboardView }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(view);

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
      <Choice<DashboardLayout>
        label="View"
        value={current.layout}
        onChange={(layout) => change({ layout })}
        options={[
          { value: "list", label: "Today", icon: List },
          { value: "board", label: "Board", icon: SquareKanban },
        ]}
      />
      <Filters count={changedFilters}>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground" aria-hidden>
            Show
          </span>
          <div role="group" aria-label="Show tasks that are" className="inline-flex gap-0.5 self-start rounded-[10px] bg-muted p-[3px]">
            {statuses.map((s) => {
              const on = current.show.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s)}
                  title={on ? `Hide ${statusLabel[s]}` : `Show ${statusLabel[s]}`}
                  className={cn(pill, "text-muted-foreground", on && "bg-card text-foreground shadow-xs dark:bg-background")}
                >
                  <StatusIcon status={s} className={cn("size-3.5", !on && "opacity-50")} />
                  {statusLabel[s]}
                </button>
              );
            })}
          </div>
        </div>
      </Filters>
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
          <span className="rounded-full bg-foreground px-1.5 text-[11px] leading-4 text-background tabular-nums">{count}</span>
        )}
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="motion-pop absolute right-0 z-30 mt-2 origin-top-right sm:right-auto sm:left-0 sm:origin-top-left flex w-max flex-col gap-4 rounded-xl border bg-card p-4 shadow-lg">{children}</div>
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
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => value !== v && onChange(v)}
          className={cn(pill, "text-muted-foreground", value === v && "bg-card text-foreground shadow-xs dark:bg-background")}
        >
          {Icon && <Icon className="size-3.5" aria-hidden />}
          {label}
        </button>
      ))}
    </div>
  );
}

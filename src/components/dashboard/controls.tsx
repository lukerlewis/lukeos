"use client";

import { List, SquareKanban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { StatusIcon } from "@/components/tasks/status-circle";
import type { BoardView } from "@/lib/board";
import type { DashboardLayout, DashboardView } from "@/lib/dashboard";
import { op } from "@/lib/ops-client";
import { statuses, statusLabel, type Status } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

const pill = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap";

/**
 * The switches at the top of the dashboard: list or board, grouped by when or
 * by status, and which statuses show. Each change is saved, so the dashboard
 * looks the same next time and on other devices.
 */
export function DashboardControls({ view }: { view: DashboardView }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(view);

  function change(changes: Partial<DashboardView>) {
    const next = { ...current, ...changes };
    startTransition(async () => {
      setCurrent(next);
      try {
        await op("set_dashboard_view", changes);
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Choice<DashboardLayout>
        label="Layout"
        value={current.layout}
        onChange={(layout) => change({ layout })}
        options={[
          { value: "list", label: "List", icon: List },
          { value: "board", label: "Board", icon: SquareKanban },
        ]}
      />
      <Choice<BoardView>
        label="Group by"
        value={current.by}
        onChange={(by) => change({ by })}
        options={[
          { value: "when", label: "By when" },
          { value: "status", label: "By status" },
        ]}
      />
      <div className="flex items-center gap-2">
      <span className="pl-1 text-[13px] text-muted-foreground" aria-hidden>
        Show
      </span>
      <div role="group" aria-label="Show tasks that are" className="inline-flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
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

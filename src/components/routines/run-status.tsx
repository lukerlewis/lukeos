import { cn } from "@/lib/utils";
import type { RunStatus } from "@/core/routines";

export const runStatusLabel: Record<RunStatus, string> = {
  running: "Running",
  done: "Done",
  failed: "Couldn't finish",
  missed: "Missed",
  stalled: "Didn't finish",
};

/** A small coloured label for how a run went. */
export function RunStatusPill({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[11px] font-medium",
        status === "done" && "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
        status === "running" && "bg-sky-500/12 text-sky-700 dark:text-sky-400",
        (status === "failed" || status === "stalled") && "bg-amber-500/15 text-amber-800 dark:text-amber-400",
        status === "missed" && "bg-muted text-subtle-foreground",
      )}
    >
      {runStatusLabel[status]}
    </span>
  );
}

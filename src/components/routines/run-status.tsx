import { cn } from "@/lib/utils";
import type { RunStatus } from "@/core/routines";

export const runStatusLabel: Record<RunStatus, string> = {
  running: "Running",
  done: "Done",
  failed: "Couldn't finish",
  missed: "Missed",
  stalled: "Didn't finish",
};

/** A small label for how a run went. */
export function RunStatusPill({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        "tag shrink-0",
        (status === "failed" || status === "stalled") && "border-grey-500 text-ink",
        status === "missed" && "text-muted-foreground",
      )}
    >
      {runStatusLabel[status]}
    </span>
  );
}

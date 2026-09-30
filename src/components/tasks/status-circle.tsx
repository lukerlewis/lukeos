import type { Status } from "@/lib/task-fields";
import { cn } from "@/lib/utils";

/** The round tick: empty for To do, half filled for Doing, ticked for Done. */
export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(
        "shrink-0",
        status === "todo" && "stroke-muted-foreground",
        status === "doing" && "stroke-doing text-doing",
        status === "done" && "stroke-done",
        className,
      )}
    >
      <circle cx="12" cy="12" r="8.5" />
      {status === "doing" && <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />}
      {status === "done" && <path d="M8.5 12.5l2.4 2.4 4.6-5" />}
    </svg>
  );
}

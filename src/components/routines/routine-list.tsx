import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { ClaudeBadge } from "@/components/tasks/made-by";
import type { RoutineSummary } from "@/core/routines";
import { cn } from "@/lib/utils";
import { RunStatusPill } from "./run-status";
import { whenShort } from "./when";

/** Luke's routines, A to Z: when each runs, when it's next due, and how the last run went. */
export function RoutineList({ routines, timeZone }: { routines: RoutineSummary[]; timeZone: string }) {
  return (
    <ul>
      {routines.map((r) => (
        <li key={r.id} className="border-b last:border-b-0">
          <Link href={`/agents/routines/${r.id}`} className="press-tint flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
            <CalendarClock
              className={cn("mt-0.5 size-[18px] shrink-0 md:size-4", r.enabled ? "text-muted-foreground" : "text-muted-foreground/50")}
              aria-hidden
            />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="flex items-baseline gap-3">
                <span className={cn("min-w-0 grow truncate text-control font-medium", !r.enabled && "text-muted-foreground")}>
                  {r.title || "Untitled routine"}
                </span>
                <span className="shrink-0 text-meta text-muted-foreground">
                  {r.enabled ? (r.nextDueAt ? `Next ${whenShort(r.nextDueAt, timeZone)}` : "") : "Off"}
                </span>
              </span>
              <span className="truncate text-meta text-muted-foreground">
                {r.scheduleLabel}
                {r.skill && ` · follows ${r.skill.title}`}
              </span>
              {(r.lastRun || r.madeBy.kind === "agent") && (
                <span className="mt-1 flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
                  {r.lastRun && (
                    <>
                      <RunStatusPill status={r.lastRun.status} />
                      <span className="truncate">{whenShort(r.lastRun.finishedAt ?? r.lastRun.startedAt ?? r.lastRun.dueAt, timeZone)}</span>
                    </>
                  )}
                  <ClaudeBadge madeBy={r.madeBy} />
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

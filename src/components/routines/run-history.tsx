import { Package, Newspaper } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import type { RoutineRun } from "@/core/routines";
import { RunStatusPill } from "./run-status";
import { whenShort } from "./when";

/** Each time the routine was due, newest first: what the agent did, or that it was missed. */
export function RunHistory({ runs, timeZone }: { runs: RoutineRun[]; timeZone: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-medium text-muted-foreground">History</h2>
      <Card>
        {runs.length === 0 ? (
          <EmptyState>No runs yet.</EmptyState>
        ) : (
          <ul>
            {runs.map((run) => (
              <li key={run.id} className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0">
                <span className="flex items-center gap-2 text-[13px]">
                  <RunStatusPill status={run.status} />
                  <span className="font-medium">Due {whenShort(run.dueAt, timeZone)}</span>
                  <span className="grow" />
                  {run.finishedAt && (
                    <span className="text-xs text-muted-foreground">Finished {whenShort(run.finishedAt, timeZone)}</span>
                  )}
                </span>
                {run.summary && <p className="text-[13px] text-muted-foreground">{run.summary}</p>}
                {run.status === "missed" && (
                  <p className="text-[13px] text-muted-foreground">No check-in picked it up in time, so it was skipped.</p>
                )}
                {run.document && (
                  <Link
                    href={`/documents/${run.document.id}`}
                    className="press inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-foreground hover:underline"
                  >
                    <Newspaper className="size-3.5 text-muted-foreground" aria-hidden />
                    {run.document.title}
                  </Link>
                )}
                {run.artifact && (
                  <Link
                    href={`/artifacts/${run.artifact.id}`}
                    className="press inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-foreground hover:underline"
                  >
                    <Package className="size-3.5 text-muted-foreground" aria-hidden />
                    {run.artifact.title}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

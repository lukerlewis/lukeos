import { UserRound } from "lucide-react";
import Link from "next/link";
import { ClaudeBadge } from "@/components/tasks/made-by";
import type { ContextSummary } from "@/core/context";

/** Luke's context files, A to Z. Each row opens the file to read or edit. */
export function ContextList({ files, when }: { files: ContextSummary[]; when: Record<string, string> }) {
  return (
    <ul>
      {files.map((f) => (
        <li key={f.id} className="border-b last:border-b-0">
          <Link href={`/agents/context/${f.id}`} className="press-tint flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
            <UserRound className="mt-0.5 size-[18px] shrink-0 text-muted-foreground md:size-4" aria-hidden />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="flex items-baseline gap-3">
                <span className="min-w-0 grow truncate text-[15px] font-medium md:text-sm">{f.title || "Untitled"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{when[f.id]}</span>
              </span>
              <span className="line-clamp-2 text-[13px] text-muted-foreground">
                {f.description || "No description yet. Add one so Claude knows when it's useful."}
              </span>
              {f.madeBy.kind === "agent" && (
                <span className="mt-1 flex items-center gap-2.5 text-xs text-muted-foreground">
                  <ClaudeBadge madeBy={f.madeBy} />
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

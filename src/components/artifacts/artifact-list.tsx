import { Globe, MessageSquare, Package } from "lucide-react";
import Link from "next/link";
import { editedLabel } from "@/components/notes/note-list";
import { ClaudeBadge } from "@/components/tasks/made-by";
import type { ArtifactSummary } from "@/core/artifacts";

/** A list of artifacts, e.g. inside a Card. Each row opens the artifact. */
export function ArtifactList({ artifacts, timeZone }: { artifacts: ArtifactSummary[]; timeZone: string }) {
  return (
    <ul>
      {artifacts.map((a) => {
        const Icon = a.format === "html" ? Globe : Package;
        return (
          <li key={a.id} className="border-b last:border-b-0">
            <Link href={`/artifacts/${a.id}`} className="press-tint flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
              <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground md:size-4" aria-hidden />
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="flex items-baseline gap-3">
                  <span className="min-w-0 grow truncate text-control font-medium">{a.title || "Untitled"}</span>
                  <span className="shrink-0 text-meta text-muted-foreground">{editedLabel(a.changedAt, timeZone)}</span>
                </span>
                {a.excerpt && <span className="line-clamp-2 text-meta text-muted-foreground">{a.excerpt}</span>}
                <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-muted-foreground">
                  <ClaudeBadge madeBy={a.madeBy} />
                  {a.madeBy.routine && <span>{a.madeBy.routine}</span>}
                  {a.version > 1 && <span>Version {a.version}</span>}
                  {a.openComments > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="size-3" aria-hidden />
                      {a.openComments} open
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

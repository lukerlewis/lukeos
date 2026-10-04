import { MessageSquare, Newspaper } from "lucide-react";
import Link from "next/link";
import { editedLabel } from "@/components/notes/note-list";
import { ClaudeBadge } from "@/components/tasks/made-by";
import type { DocumentSummary } from "@/core/documents";

/** A list of documents, e.g. inside a Card, with a dot on Claude's new ones. Each row opens the document. */
export function DocumentList({
  documents,
  timeZone,
  showProject = true,
  empty,
}: {
  documents: DocumentSummary[];
  timeZone: string;
  showProject?: boolean;
  empty?: React.ReactNode;
}) {
  if (documents.length === 0 && empty) return <>{empty}</>;
  return (
    <ul>
      {documents.map((d) => (
        <li key={d.id} className="border-b last:border-b-0">
          <Link href={`/documents/${d.id}`} className="press-tint flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
            <span className="relative mt-0.5 shrink-0">
              <Newspaper className="size-[18px] text-muted-foreground md:size-4" aria-hidden />
              {d.isNew && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-doing ring-2 ring-card" aria-label="New" />}
            </span>
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="flex items-baseline gap-3">
                <span className="min-w-0 grow truncate text-[15px] font-medium md:text-sm">{d.title || "Untitled"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{editedLabel(d.updatedAt, timeZone)}</span>
              </span>
              {d.excerpt && <span className="line-clamp-2 text-[13px] text-muted-foreground">{d.excerpt}</span>}
              {(d.madeBy.kind === "agent" || d.openComments > 0 || (showProject && d.project)) && (
                <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                  <ClaudeBadge madeBy={d.madeBy} />
                  {d.madeBy.routine && <span>{d.madeBy.routine}</span>}
                  {d.openComments > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="size-3" aria-hidden />
                      {d.openComments} open
                    </span>
                  )}
                  {showProject && d.project && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-[3px]" style={{ background: d.project.hex }} aria-hidden />
                      {d.project.name}
                    </span>
                  )}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

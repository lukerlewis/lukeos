import { FileText, Globe, Pin } from "lucide-react";
import Link from "next/link";
import { ClaudeBadge } from "@/components/tasks/made-by";
import type { NoteSummary } from "@/core/notes";
import { dayAndMonth, shortDate, todayIn } from "@/lib/dates";

/** "Today", "3 Oct" this year, or "3 Oct 2025". */
export function editedLabel(when: Date, timeZone: string) {
  const day = todayIn(timeZone, when);
  const today = todayIn(timeZone);
  if (day === today) return "Today";
  return day.slice(0, 4) === today.slice(0, 4) ? dayAndMonth(day) : shortDate(day);
}

/** A list of notes, e.g. inside a Card. Each row opens the note. */
export function NoteList({
  notes,
  timeZone,
  showProject = true,
  empty,
}: {
  notes: NoteSummary[];
  timeZone: string;
  showProject?: boolean;
  empty?: React.ReactNode;
}) {
  if (notes.length === 0 && empty) return <>{empty}</>;
  return (
    <ul>
      {notes.map((n) => {
        const Icon = n.format === "html" ? Globe : FileText;
        return (
          <li key={n.id} className="border-b last:border-b-0">
            <Link href={`/notes/${n.id}`} className="press-tint flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
              <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground md:size-4" aria-hidden />
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="flex items-baseline gap-3">
                  <span className="min-w-0 grow truncate text-[15px] font-medium md:text-sm">{n.title || "Untitled"}</span>
                  {n.pinned && <Pin className="size-3.5 shrink-0 self-center text-muted-foreground" aria-label="Pinned" />}
                  <span className="shrink-0 text-xs text-muted-foreground">{editedLabel(n.updatedAt, timeZone)}</span>
                </span>
                {n.excerpt && <span className="line-clamp-2 text-[13px] text-muted-foreground">{n.excerpt}</span>}
                {(n.madeBy.kind === "agent" || (showProject && n.project)) && (
                  <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                    <ClaudeBadge madeBy={n.madeBy} />
                    {n.madeBy.routine && <span>{n.madeBy.routine}</span>}
                    {showProject && n.project && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-[3px]" style={{ background: n.project.hex }} aria-hidden />
                        {n.project.name}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

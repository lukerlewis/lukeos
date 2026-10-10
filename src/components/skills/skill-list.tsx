import { ScrollText } from "lucide-react";
import Link from "next/link";
import { ClaudeBadge } from "@/components/tasks/made-by";
import type { SkillSummary } from "@/core/skills";

/** Luke's skills, A to Z. Each row opens the skill to read or edit. */
export function SkillList({ skills, when }: { skills: SkillSummary[]; when: Record<string, string> }) {
  return (
    <ul>
      {skills.map((s) => (
        <li key={s.id} className="border-b last:border-b-0">
          <Link href={`/agents/skills/${s.id}`} className="press-tint flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
            <ScrollText className="mt-0.5 size-[18px] shrink-0 text-muted-foreground md:size-4" aria-hidden />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="flex items-baseline gap-3">
                <span className="min-w-0 grow truncate text-control font-medium">{s.title || "Untitled skill"}</span>
                <span className="shrink-0 text-meta text-muted-foreground">{when[s.id]}</span>
              </span>
              <span className="line-clamp-2 text-meta text-muted-foreground">
                {s.description || "No description yet. Add one so Claude knows when to use it."}
              </span>
              {s.madeBy.kind === "agent" && (
                <span className="mt-1 flex items-center gap-2.5 text-meta text-muted-foreground">
                  <ClaudeBadge madeBy={s.madeBy} />
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

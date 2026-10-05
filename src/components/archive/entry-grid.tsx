import { Archive, Briefcase, Lock, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";
import { ClaudeBadge } from "@/components/tasks/made-by";
import type { EntrySummary } from "@/core/archive";
import { sizeLabel, stageLabel, type EntrySize } from "@/lib/archive";
import { cn } from "@/lib/utils";

const sizeIcon: Record<EntrySize, typeof Archive> = { win: Trophy, story: Sparkles, project: Briefcase };

/** Work archive entries as a grid of covers. Each opens the entry. */
export function EntryGrid({ entries }: { entries: EntrySummary[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-4">
      {entries.map((e) => {
        const Icon = sizeIcon[e.size];
        const details = [sizeLabel[e.size], e.company, e.period].filter(Boolean).join(" · ");
        return (
          <li key={e.id} className="min-w-0">
            <Link
              href={`/archive/${e.id}`}
              className="pressable group flex h-full flex-col overflow-hidden rounded-xl border bg-card border-stroke hover:border-foreground/20"
            >
              <span className="relative block aspect-[4/3] overflow-hidden bg-muted">
                {e.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.cover} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground/60">
                    <Icon className="size-8" aria-hidden />
                  </span>
                )}
                {(e.stage !== "raw" || e.confidential) && (
                  <span className="absolute top-2 left-2 flex gap-1">
                    {e.stage !== "raw" && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          e.stage === "published" ? "bg-primary text-primary-foreground" : "bg-card text-foreground",
                        )}
                      >
                        {stageLabel[e.stage]}
                      </span>
                    )}
                    {e.confidential && (
                      <span className="flex size-[22px] items-center justify-center rounded-full border border-stroke bg-card text-foreground" title="Confidential">
                        <Lock className="size-3" aria-label="Confidential" />
                      </span>
                    )}
                  </span>
                )}
              </span>
              <span className="flex grow flex-col gap-1 px-3 py-2.5">
                <span className="line-clamp-2 text-control leading-snug font-medium">{e.title || "Untitled"}</span>
                <span className="truncate text-meta text-muted-foreground">{details}</span>
                {e.madeBy.kind === "agent" && (
                  <span className="mt-auto pt-1">
                    <ClaudeBadge madeBy={e.madeBy} />
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

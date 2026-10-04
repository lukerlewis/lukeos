import { Sparkles } from "lucide-react";
import type { MadeBy } from "@/core/define";
import { shortDate } from "@/lib/dates";

/** "Added 30 Sep 2026" or "Added by Claude (Morning routine) on 30 Sep 2026". */
export function MadeByLabel({ madeBy, createdAt }: { madeBy: MadeBy; createdAt: Date | string }) {
  const when = shortDate(new Date(createdAt).toISOString().slice(0, 10));
  if (madeBy.kind === "user") return <>Added {when}</>;
  return (
    <>
      Added by {madeBy.name ?? "Claude"}
      {madeBy.routine && ` (${madeBy.routine})`} on {when}
    </>
  );
}

/** The quiet mark on anything Claude made: a small faded sparkle in the meta line. */
export function ClaudeBadge({ madeBy }: { madeBy: MadeBy }) {
  if (madeBy.kind !== "agent") return null;
  const label = madeBy.routine ? `Made by ${madeBy.name ?? "Claude"} (${madeBy.routine})` : `Made by ${madeBy.name ?? "Claude"}`;
  return (
    <span className="inline-flex shrink-0 items-center text-muted-foreground opacity-75" title={label}>
      <Sparkles className="size-3" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

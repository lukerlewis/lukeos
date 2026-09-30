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

/** The small label on anything Claude made. */
export function ClaudeBadge({ madeBy }: { madeBy: MadeBy }) {
  if (madeBy.kind !== "agent") return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-subtle-foreground"
      title={madeBy.routine ? `Made by ${madeBy.name ?? "Claude"} (${madeBy.routine})` : `Made by ${madeBy.name ?? "Claude"}`}
    >
      <Sparkles className="size-3" aria-hidden />
      {madeBy.name ?? "Claude"}
    </span>
  );
}

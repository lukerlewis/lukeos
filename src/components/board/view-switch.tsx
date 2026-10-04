import { SegmentedLinks } from "@/components/ui/segmented-links";
import type { BoardView } from "@/lib/board";

export type BoardGrouping = BoardView | "pipeline";

/** Flips the board between by-when columns, To do / Doing / Done, and (on a project) its pipeline. */
export function BoardViewSwitch({
  view,
  href,
  pipeline = false,
}: {
  view: BoardGrouping;
  href: (view: BoardGrouping) => string;
  /** Offer the project's pipeline as a third grouping. */
  pipeline?: boolean;
}) {
  return (
    <SegmentedLinks
      label="Board columns"
      className="self-start"
      options={[
        ...(pipeline ? [{ href: href("pipeline"), label: "Pipeline", active: view === "pipeline" }] : []),
        { href: href("when"), label: "By when", active: view === "when" },
        { href: href("status"), label: "By status", active: view === "status" },
      ]}
    />
  );
}

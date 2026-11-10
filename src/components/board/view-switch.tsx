import { SegmentedLinks } from "@/components/ui/segmented-links";
import type { BoardView } from "@/lib/board";

export type BoardGrouping = BoardView | "pipeline" | "calendar";

/** Flips the board between by-when columns, (on a project) its pipeline and its cards on a calendar, and To do / Doing / Done. */
export function BoardViewSwitch({
  view,
  href,
  pipeline = false,
}: {
  view: BoardGrouping;
  href: (view: BoardGrouping) => string;
  /** Offer the project's pipeline, and its Calendar. */
  pipeline?: boolean;
}) {
  return (
    <SegmentedLinks
      label="Board columns"
      className="self-start"
      options={[
        { href: href("when"), label: "By when", active: view === "when" },
        ...(pipeline
          ? [
              { href: href("pipeline"), label: "Pipeline", active: view === "pipeline" },
              { href: href("calendar"), label: "Calendar", active: view === "calendar" },
            ]
          : []),
        { href: href("status"), label: "By status", active: view === "status" },
      ]}
    />
  );
}

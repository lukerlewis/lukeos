import { SegmentedLinks } from "@/components/ui/segmented-links";
import type { BoardView } from "@/lib/board";

/** Flips the board between by-when columns and To do / Doing / Done. */
export function BoardViewSwitch({ view, href }: { view: BoardView; href: (view: BoardView) => string }) {
  return (
    <SegmentedLinks
      label="Board columns"
      className="self-start"
      options={[
        { href: href("when"), label: "By when", active: view === "when" },
        { href: href("status"), label: "By status", active: view === "status" },
      ]}
    />
  );
}

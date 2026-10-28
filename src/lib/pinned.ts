import type { MadeBy } from "@/core/define";
import type { DocumentSummary } from "@/core/documents";
import type { ProjectLink } from "@/core/links";
import type { NoteSummary } from "@/core/notes";

/** A pinned note, document or link, as a card in the row above a list. */
export type PinnedItem = {
  kind: "note" | "document" | "link";
  id: string;
  title: string;
  /** The excerpt, or a link's site. */
  detail: string;
  /** A link's own note. */
  note?: string | null;
  href: string;
  /** Links only: the site, for its icon. */
  site?: string;
  project: { name: string; hex: string } | null;
  madeBy: MadeBy;
  pinnedAt: Date | null;
};

export const pinnedNote = (n: NoteSummary): PinnedItem => ({
  kind: "note",
  id: n.id,
  title: n.title || "Untitled",
  detail: n.excerpt,
  href: `/notes/${n.id}`,
  project: n.project,
  madeBy: n.madeBy,
  pinnedAt: n.pinnedAt,
});

export const pinnedDocument = (d: DocumentSummary): PinnedItem => ({
  kind: "document",
  id: d.id,
  title: d.title || "Untitled",
  detail: d.excerpt,
  href: `/documents/${d.id}`,
  project: d.project,
  madeBy: d.madeBy,
  pinnedAt: d.pinnedAt,
});

export const pinnedLink = (l: ProjectLink): PinnedItem => ({
  kind: "link",
  id: l.id,
  title: l.title || l.site,
  detail: l.site,
  note: l.note,
  href: l.url,
  site: l.site,
  project: null,
  madeBy: l.madeBy,
  pinnedAt: l.pinnedAt,
});

/** Newest pin first. */
export const byPin = (items: PinnedItem[]) => [...items].sort((a, b) => +new Date(b.pinnedAt ?? 0) - +new Date(a.pinnedAt ?? 0));

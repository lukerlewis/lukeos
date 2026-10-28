"use client";

import { FileText, NotebookPen, Pencil, Pin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SiteIcon } from "@/components/projects/site-icon";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { inBackground } from "@/lib/background";
import { op } from "@/lib/ops-client";
import type { PinnedItem } from "@/lib/pinned";

const save = { note: "update_note", document: "update_document", link: "update_link" } as const;

/**
 * Pinned notes, documents and links as a row of cards above a list, scrolling
 * sideways. The pin on each card unpins it, back into the list.
 */
export function PinnedRow({
  items,
  showProject = true,
  onUnpin,
  onEdit,
}: {
  items: PinnedItem[];
  showProject?: boolean;
  /** Takes over unpinning (the links list shows its own pins at once). */
  onUnpin?: (item: PinnedItem) => void;
  /** Adds a pencil to each card. */
  onEdit?: (item: PinnedItem) => void;
}) {
  const router = useRouter();
  // Unpinned here, hidden at once while the server catches up.
  const [gone, setGone] = useState<string[]>([]);
  // A fresh list from the server starts clean.
  const ids = items.map((i) => i.id).join();
  const [seen, setSeen] = useState(ids);
  if (seen !== ids) {
    setSeen(ids);
    setGone([]);
  }
  const shown = items.filter((i) => !gone.includes(i.id));
  if (shown.length === 0) return null;

  function unpin(item: PinnedItem) {
    if (onUnpin) return onUnpin(item);
    setGone((g) => [...g, item.id]);
    void inBackground(() => op(save[item.kind], { id: item.id, pinned: false }), {
      then: () => router.refresh(),
      failed: () => setGone((g) => g.filter((id) => id !== item.id)),
      failure: "Couldn't unpin it.",
    });
  }

  return (
    <ul
      aria-label="Pinned"
      className="no-scrollbar -mx-5 flex snap-x scroll-px-5 gap-3 overflow-x-auto px-5 md:mx-0 md:scroll-px-0 md:px-0"
    >
      {shown.map((item) => (
        <li key={item.id} className="flex w-60 shrink-0 snap-start">
          <PinnedCard item={item} showProject={showProject} onUnpin={() => unpin(item)} onEdit={onEdit && (() => onEdit(item))} />
        </li>
      ))}
    </ul>
  );
}

function PinnedCard({
  item,
  showProject,
  onUnpin,
  onEdit,
}: {
  item: PinnedItem;
  showProject: boolean;
  onUnpin: () => void;
  onEdit?: () => void;
}) {
  const body = (
    <>
      <span className="flex h-6 items-center">
        {item.kind === "link" ? (
          <SiteIcon site={item.site ?? ""} />
        ) : item.kind === "document" ? (
          <FileText className="size-[18px] text-muted-foreground md:size-4" aria-hidden />
        ) : (
          <NotebookPen className="size-[18px] text-muted-foreground md:size-4" aria-hidden />
        )}
      </span>
      <span className="mt-2 line-clamp-2 text-control font-medium">{item.title}</span>
      {item.detail && <span className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">{item.detail}</span>}
      {item.note && <span className="mt-0.5 line-clamp-2 text-meta whitespace-pre-line text-subtle-foreground">{item.note}</span>}
      {(item.madeBy.kind === "agent" || (showProject && item.project)) && (
        <span className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-3 text-meta text-muted-foreground">
          <ClaudeBadge madeBy={item.madeBy} />
          {showProject && item.project && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-[3px]" style={{ background: item.project.hex }} aria-hidden />
              <span className="truncate">{item.project.name}</span>
            </span>
          )}
        </span>
      )}
    </>
  );
  const face = "press-tint flex grow flex-col p-4 hover:bg-muted/50";

  return (
    <div className="relative flex w-full overflow-hidden rounded-xl border border-stroke bg-card">
      {item.kind === "link" ? (
        <a href={item.href} target="_blank" rel="noreferrer" className={face}>
          {body}
        </a>
      ) : (
        <Link href={item.href} className={face}>
          {body}
        </Link>
      )}
      <span className="absolute top-1 right-1 flex">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${item.title}`}
            className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onUnpin}
          aria-label={`Unpin ${item.title}`}
          title="Unpin"
          className="flex size-11 items-center justify-center rounded-lg text-foreground hover:bg-muted"
        >
          <Pin className="size-4 fill-current" aria-hidden />
        </button>
      </span>
    </div>
  );
}

"use client";

import { Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinnedRow } from "@/components/pinned/pinned-row";
import { SiteIcon } from "@/components/projects/site-icon";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ProjectLink } from "@/core/links";
import { hide, inBackground, unhide, useWithoutHidden } from "@/lib/background";
import { op } from "@/lib/ops-client";
import { pinnedLink } from "@/lib/pinned";
import { cn } from "@/lib/utils";

const field = "rounded-lg border bg-card px-3 text-body border-stroke-strong outline-none md:text-control focus-visible:border-ring";

/** A project's saved links, each opening in a new tab: pinned ones as a row of cards, the rest in a list below. */
export function LinkList({ links, empty }: { links: ProjectLink[]; empty: React.ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProjectLink | null>(null);
  // Pins tapped here, shown at once while the server catches up: id -> when pinned, or null when unpinned.
  const [pins, setPins] = useState<Record<string, number | null>>({});
  const [seen, setSeen] = useState(links);
  if (seen !== links) {
    setSeen(links);
    setPins({});
  }
  const shown = sortByPin(useWithoutHidden(links), pins);

  function togglePin(link: ProjectLink & { pinned: boolean }) {
    const pinned = !link.pinned;
    setPins((p) => ({ ...p, [link.id]: pinned ? Date.now() : null }));
    void inBackground(() => op("update_link", { id: link.id, pinned }), {
      then: () => router.refresh(),
      failed: () => setPins((p) => ({ ...p, [link.id]: link.pinned ? 0 : null })),
      failure: pinned ? "Couldn't pin the link." : "Couldn't unpin the link.",
    });
  }

  if (shown.length === 0) return <Card>{empty}</Card>;
  const pinned = shown.filter((l) => l.pinned);
  const rest = shown.filter((l) => !l.pinned);
  const linkOf = (id: string) => shown.find((l) => l.id === id)!;
  return (
    <>
      <PinnedRow
        items={pinned.map(pinnedLink)}
        showProject={false}
        onUnpin={(i) => togglePin(linkOf(i.id))}
        onEdit={(i) => setEditing(linkOf(i.id))}
      />
      {rest.length > 0 && (
        <Card>
          <ul>
            {rest.map((l) => (
              <li key={l.id} className="group flex items-center border-b last:border-b-0">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="press-tint flex min-w-0 grow items-start gap-3 py-4 pr-2 pl-4 hover:bg-muted/50"
                >
                  <SiteIcon site={l.site} />
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-control font-medium">{l.title || l.site}</span>
                      <ClaudeBadge madeBy={l.madeBy} />
                    </span>
                    <span className="truncate text-meta text-muted-foreground">{l.site}</span>
                    {l.note && <span className="line-clamp-3 text-meta whitespace-pre-line text-subtle-foreground">{l.note}</span>}
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => togglePin(l)}
                  aria-label={l.pinned ? `Unpin ${l.title || l.site}` : `Pin ${l.title || l.site}`}
                  aria-pressed={l.pinned}
                  title={l.pinned ? "Unpin" : "Pin to top"}
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted hover:text-foreground",
                    l.pinned
                      ? "text-foreground"
                      : "text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
                  )}
                >
                  <Pin className={cn("size-4", l.pinned && "fill-current")} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(l)}
                  aria-label={`Edit ${l.title || l.site}`}
                  className="mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <LinkDialog projectId={editing.projectId} link={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/**
 * The links with any pins tapped here applied: pinned first (a fresh pin on
 * top, then the server's pin order), then the rest newest first.
 */
function sortByPin(links: ProjectLink[], pins: Record<string, number | null>) {
  const withPins = links.map((l, i) => {
    const tapped = l.id in pins;
    const pinned = tapped ? pins[l.id] !== null : l.pinned;
    // Server pins keep their order below anything pinned just now.
    return { ...l, pinned, rank: tapped && pins[l.id] ? pins[l.id]! : -i };
  });
  const pinned = withPins.filter((l) => l.pinned).sort((a, b) => b.rank - a.rank);
  const rest = withPins.filter((l) => !l.pinned).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return [...pinned, ...rest];
}

export function AddLinkButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Add link
      </Button>
      {open && <LinkDialog projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

function LinkDialog({ projectId, link, onClose }: { projectId: string; link?: ProjectLink; onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState(link?.url ?? "");
  const [title, setTitle] = useState(link?.title ?? "");
  const [note, setNote] = useState(link?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  // The box closes at once and the link saves behind it.
  function save(e: React.FormEvent) {
    e.preventDefault();
    const clean = { url: url.trim(), title: title.trim(), note: note.trim() };
    if (!clean.url) return setError("Add a web address.");
    onClose();
    if (link) {
      if (clean.url === link.url && clean.title === (link.title ?? "") && clean.note === (link.note ?? "")) return;
      void inBackground(() => op("update_link", { id: link.id, url: clean.url, title: clean.title || null, note: clean.note || null }), {
        then: () => router.refresh(),
        failure: "Couldn't save the link.",
      });
    } else {
      void inBackground(
        () => op("add_link", { projectId, url: clean.url, title: clean.title || undefined, note: clean.note || undefined }),
        { then: () => router.refresh(), failure: "Couldn't add the link." },
      );
    }
  }

  function remove() {
    if (!link) return;
    const id = link.id;
    hide(id);
    onClose();
    void inBackground(() => op("delete_link", { id }), {
      then: () => router.refresh(),
      failed: () => unhide(id),
      failure: "Couldn't remove the link.",
    });
  }

  return (
    <Dialog label={link ? "Edit link" : "Add link"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4 px-5 pt-5">
        <h2 className="text-lg font-medium">{link ? "Edit link" : "Add link"}</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Link</span>
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://"
            className={`h-10 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="From the page" className={`h-10 ${field}`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={`resize-none py-2 ${field}`} />
        </label>
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
        <div className="-mx-5 flex items-center gap-2 border-t px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {link && (
            <Button variant="danger" onClick={remove} className="-ml-2">
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          )}
          <div className="grow" />
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{link ? "Save" : "Add link"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

"use client";

import { Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ProjectLink } from "@/core/links";
import { hide, inBackground, unhide, useWithoutHidden } from "@/lib/background";
import { op } from "@/lib/ops-client";

const field =
  "rounded-lg border bg-card px-3 text-body border-stroke-strong outline-none md:text-control focus-visible:border-ring";

/** A project's saved links, each opening in a new tab. */
export function LinkList({ links, empty }: { links: ProjectLink[]; empty: React.ReactNode }) {
  const shown = useWithoutHidden(links);
  const [editing, setEditing] = useState<ProjectLink | null>(null);
  if (shown.length === 0) return <>{empty}</>;
  return (
    <>
      <ul>
        {shown.map((l) => (
          <li key={l.id} className="flex items-center border-b last:border-b-0">
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
              onClick={() => setEditing(l)}
              aria-label={`Edit ${l.title || l.site}`}
              className="mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {editing && <LinkDialog projectId={editing.projectId} link={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** The site's own little icon, or a globe if it has none. */
function SiteIcon({ site }: { site: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Globe className="mt-0.5 size-5 shrink-0 text-icon" aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny remote icon, not worth the image optimiser
    <img
      // An icon that failed before the page came alive never fires onError, so check on mount too.
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=64`}
      alt=""
      className="mt-0.5 size-5 shrink-0 rounded-[4px]"
      onError={() => setFailed(true)}
    />
  );
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

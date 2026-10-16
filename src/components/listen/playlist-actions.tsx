"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { op } from "@/lib/ops-client";

/** Rename and delete, beside a playlist's title. */
export function PlaylistActions({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "rename" | "delete">(null);
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>, then: () => void) {
    setBusy(true);
    try {
      await work();
      setOpen(null);
      then();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Rename playlist" onClick={() => setOpen("rename")}>
        <Pencil className="size-5" aria-hidden />
      </Button>
      <Button variant="danger" size="icon" aria-label="Delete playlist" onClick={() => setOpen("delete")}>
        <Trash2 className="size-5" aria-hidden />
      </Button>
      {open && (
        <Dialog label={open === "rename" ? "Rename playlist" : "Delete playlist"} onClose={() => setOpen(null)} focusFirstField={open === "rename"}>
          <div className="flex flex-col gap-4 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
            {open === "rename" ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) void run(() => op("update_playlist", { id, title: name.trim() }), () => router.refresh());
                }}
              >
                <h2 className="text-heading font-medium">Rename playlist</h2>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="Playlist name"
                  className="h-11 rounded-lg border border-stroke-strong bg-card px-3 text-base md:text-control"
                />
                <Button type="submit" disabled={busy || !name.trim()}>
                  Save
                </Button>
              </form>
            ) : (
              <>
                <div>
                  <h2 className="text-heading font-medium">Delete “{title}”?</h2>
                  <p className="mt-1 text-preview text-muted-foreground">Its episodes stay in Music.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="grow" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                  <Button className="grow" disabled={busy} onClick={() => void run(() => op("delete_playlist", { id }), () => router.push("/listen"))}>
                    Delete
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

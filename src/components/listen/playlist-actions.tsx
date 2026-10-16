"use client";

import { Ellipsis, Pencil, Shapes, Trash2 } from "lucide-react";
import { PLAYLIST_ICONS, type PlaylistIcon } from "@/lib/listen";
import { cn } from "@/lib/utils";
import { PlaylistCover, playlistIcons } from "./playlist-icon";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/shell/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { op } from "@/lib/ops-client";

/** A ⋯ button beside a playlist's title, opening Change icon, Rename and Delete. */
export function PlaylistActions({ id, title, icon, artworkUrl }: { id: string; title: string; icon: string | null; artworkUrl: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "menu" | "icon" | "rename" | "delete">(null);
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

  const item = "press-tint flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-control font-medium hover:bg-muted";

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Playlist options" title="Playlist options" onClick={() => setOpen("menu")}>
        <Ellipsis className="size-5" aria-hidden />
      </Button>
      {open && (
        <Dialog
          label={open === "menu" ? title : open === "icon" ? "Playlist icon" : open === "rename" ? "Rename playlist" : "Delete playlist"}
          onClose={() => setOpen(null)}
          focusFirstField={open === "rename"}
        >
          <div className="flex flex-col gap-4 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
            {open === "menu" ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-3 px-1 pb-3">
                  <PlaylistCover playlist={{ icon, artworkUrl }} className="size-12" />
                  <h2 className="min-w-0 truncate text-heading font-medium">{title}</h2>
                </div>
                <button type="button" className={item} onClick={() => setOpen("icon")}>
                  <Shapes className="size-[18px] text-muted-foreground" aria-hidden />
                  Change icon
                </button>
                <button type="button" className={item} onClick={() => setOpen("rename")}>
                  <Pencil className="size-[18px] text-muted-foreground" aria-hidden />
                  Rename
                </button>
                <button type="button" className={item} onClick={() => setOpen("delete")}>
                  <Trash2 className="size-[18px] text-muted-foreground" aria-hidden />
                  Delete playlist
                </button>
              </div>
            ) : open === "icon" ? (
              <>
                <h2 className="text-heading font-medium">Playlist icon</h2>
                <div className="grid grid-cols-7 gap-1">
                  {PLAYLIST_ICONS.map((name: PlaylistIcon) => {
                    const Icon = playlistIcons[name];
                    return (
                      <button
                        key={name}
                        type="button"
                        aria-label={name.replace("-", " ")}
                        aria-pressed={icon === name}
                        disabled={busy}
                        onClick={() => void run(() => op("update_playlist", { id, icon: name }), () => router.refresh())}
                        className={cn(
                          "press flex aspect-square items-center justify-center rounded-lg text-subtle-foreground hover:bg-muted",
                          icon === name && "bg-selected text-foreground",
                        )}
                      >
                        <Icon className="size-5" aria-hidden />
                      </button>
                    );
                  })}
                </div>
                {icon && (
                  <Button variant="outline" disabled={busy} onClick={() => void run(() => op("update_playlist", { id, icon: null }), () => router.refresh())}>
                    Use artwork instead
                  </Button>
                )}
              </>
            ) : open === "rename" ? (
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

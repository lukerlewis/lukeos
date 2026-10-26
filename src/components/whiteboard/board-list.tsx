"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClaudeBadge } from "@/components/tasks/made-by";
import { Button } from "@/components/ui/button";
import type { MadeBy } from "@/core/define";
import { op } from "@/lib/ops-client";
import { roughBounds, type Item } from "@/lib/whiteboard";
import { ItemView } from "./item-view";

export type BoardCard = { id: string; title: string; project: { name: string; hex: string } | null; items: Item[]; madeBy: MadeBy; updatedAt: string };

/** Makes an empty whiteboard (in `projectId`, if given) and opens it. */
export function NewWhiteboardButton({ projectId }: { projectId?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const board = await op("create_whiteboard", projectId ? { projectId } : {});
          router.push(`/whiteboard/${board.id}`);
        } catch (err) {
          alert((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <Plus className="size-4" aria-hidden />
      New whiteboard
    </Button>
  );
}

export function BoardGrid({ boards }: { boards: BoardCard[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {boards.map((b) => (
        <li key={b.id}>
          <Link href={`/whiteboard/${b.id}`} className="group flex flex-col overflow-hidden rounded-xl border border-stroke bg-card hover:border-stroke-strong">
            <Thumbnail items={b.items} />
            <div className="flex items-center gap-2 border-t px-4 py-3">
              <span className="grow truncate text-control font-medium text-foreground">{b.title || "Untitled"}</span>
              <ClaudeBadge madeBy={b.madeBy} />
              {b.project && (
                <span className="flex min-w-0 shrink items-center gap-1.5 text-meta text-muted-foreground">
                  <span className="size-2 shrink-0 rounded-[3px]" style={{ background: b.project.hex }} aria-hidden />
                  <span className="truncate">{b.project.name}</span>
                </span>
              )}
              <span className="shrink-0 text-meta text-muted-foreground">{ago(b.updatedAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The board shrunk to fit a card. */
function Thumbnail({ items }: { items: Item[] }) {
  const W = 360;
  const H = 200;
  const bounds = roughBounds(items);
  const pad = 16;
  const z = bounds ? Math.min(0.5, (W - pad * 2) / (bounds.w || 1), (H - pad * 2) / (bounds.h || 1)) : 1;
  const x = bounds ? W / 2 - (bounds.x + bounds.w / 2) * z : 0;
  const y = bounds ? H / 2 - (bounds.y + bounds.h / 2) * z : 0;
  return (
    <div
      className="pointer-events-none relative aspect-[9/5] w-full overflow-hidden"
      style={{ background: "var(--wb-canvas)", containerType: "inline-size" }}
      aria-hidden
    >
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: W, height: H, transform: `scale(calc(100cqw / ${W}px))` }}>
        <div className="absolute top-0 left-0" style={{ transform: `translate(${x}px, ${y}px) scale(${z})`, transformOrigin: "0 0" }}>
          {items.map((item) => (
            <ItemView key={item.id} item={item} topLevel preview />
          ))}
        </div>
      </div>
    </div>
  );
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

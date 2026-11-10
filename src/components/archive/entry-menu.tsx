"use client";

import { ExternalLink, Layers, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { contextMenu } from "@/components/ui/context-menu";
import { trashInBackground, useHidden } from "@/lib/background";
import { entryStages, stageLabel, type EntryStage } from "@/lib/archive";
import { copyLinkItem, tryOp } from "@/lib/menus";
import { op } from "@/lib/ops-client";

/** A cover in the Work archive, with its right-click menu: open, change its stage, copy a link, delete. */
export function EntryCard({
  entry,
  className,
  children,
}: {
  entry: { id: string; title: string; stage: EntryStage };
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  if (useHidden(entry.id)) return null;
  const href = `/archive/${entry.id}`;
  const refresh = () => router.refresh();
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className={className}
        {...contextMenu(
          () => [
            { label: "Open", icon: ExternalLink, onSelect: () => router.push(href) },
            "-",
            {
              label: "Stage",
              icon: Layers,
              items: entryStages.map((s) => ({
                label: stageLabel[s],
                checked: entry.stage === s,
                onSelect: () => entry.stage !== s && tryOp(() => op("update_archive_entry", { id: entry.id, stage: s }), refresh),
              })),
            },
            copyLinkItem(href),
            "-",
            {
              label: "Delete",
              icon: Trash2,
              onSelect: () => trashInBackground("entry", entry.id, () => op("delete_archive_entry", { id: entry.id }), { then: refresh }),
            },
          ],
          { ask: { kind: "archive entry", id: entry.id, title: entry.title }, hold: true },
        )}
      >
        {children}
      </Link>
    </li>
  );
}

"use client";

import { ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { contextMenu } from "@/components/ui/context-menu";
import { trashInBackground, useHidden } from "@/lib/background";
import { copyLinkItem } from "@/lib/menus";
import { op } from "@/lib/ops-client";

const kinds = {
  skill: { remove: "delete_skill", ask: "skill" },
  context: { remove: "delete_context", ask: "context file" },
  routine: { remove: "delete_routine", ask: "routine" },
} as const;

/**
 * A row in a plain list (skills, context files, routines) that opens a page,
 * with a right-click menu: open, copy a link, delete.
 */
export function MenuRow({
  kind,
  id,
  title,
  href,
  className,
  children,
}: {
  kind: keyof typeof kinds;
  id: string;
  title: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  if (useHidden(id)) return null;
  const { remove, ask } = kinds[kind];
  return (
    <li className="border-b last:border-b-0">
      <Link
        href={href}
        className={className}
        {...contextMenu(
          () => [
            { label: "Open", icon: ExternalLink, onSelect: () => router.push(href) },
            "-",
            copyLinkItem(href),
            "-",
            { label: "Delete", icon: Trash2, onSelect: () => trashInBackground(kind, id, () => op(remove, { id }), { then: () => router.refresh() }) },
          ],
          { ask: { kind: ask, id, title }, hold: true },
        )}
      >
        {children}
      </Link>
    </li>
  );
}

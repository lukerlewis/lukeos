"use client";

import type { InspirationItem } from "@/core/inspiration";
import { AddFab } from "./add";
import { Gallery } from "./gallery";
import { DropAndPaste, SavingPill, SavingProvider } from "./saving";

/**
 * The gallery with everything that saves to it: drop or paste anywhere on a
 * computer, the add sheet, and the phone's "+". Shared by the Inspiration
 * page and a project's Inspiration tab (which saves into the project).
 */
export function InspirationBoard({
  items,
  projects,
  projectId,
  openItem,
  empty,
  children,
}: {
  items: InspirationItem[];
  projects: { id: string; name: string; color: string }[];
  projectId?: string | null;
  openItem?: InspirationItem | null;
  empty: React.ReactNode;
  /** The filters and Add button, above the gallery. */
  children?: React.ReactNode;
}) {
  return (
    <SavingProvider projectId={projectId}>
      {children}
      {items.length ? <Gallery items={items} projects={projects} openItem={openItem} /> : empty}
      {!items.length && openItem && <Gallery items={[]} projects={projects} openItem={openItem} />}
      <DropAndPaste />
      <SavingPill />
      <AddFab />
    </SavingProvider>
  );
}

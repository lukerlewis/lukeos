"use client";

import { Link2 } from "lucide-react";
import { copyLink, type MenuEntry } from "@/components/ui/context-menu";
import { showToast } from "@/components/shell/toast";
import { op } from "./ops-client";
import { colorHex } from "./project-colors";

type Project = { id: string; name: string; hex: string; area: string };

// Fetched the first time a menu wants them, then kept for a minute.
let projects: { at: number; list: Promise<Project[]> } | null = null;

export function loadProjects(): Promise<Project[]> {
  if (!projects || Date.now() - projects.at > 60_000) {
    const list = op("list_projects", {}).then((ps) => ps.map((p) => ({ id: p.id, name: p.name, hex: colorHex(p.color), area: p.area })));
    list.catch(() => (projects = null));
    projects = { at: Date.now(), list };
  }
  return projects.list;
}

/** A "Project" smaller menu: No project, then each project, ticking the current one. */
export function projectItems(current: string | null | undefined, pick: (id: string | null) => void, { none = "No project" }: { none?: string | false } = {}) {
  return async (): Promise<MenuEntry[]> => {
    const list = await loadProjects();
    return [
      none !== false && { label: none, checked: !current, onSelect: () => current && pick(null) },
      none !== false && list.length > 0 && "-",
      ...list.map((p) => ({ label: p.name, dot: p.hex, checked: p.id === current, onSelect: () => p.id !== current && pick(p.id) })),
    ];
  };
}

/** "Copy link" for a page in LukeOS. */
export function copyLinkItem(path: string): MenuEntry {
  return { label: "Copy link", icon: Link2, onSelect: () => copyLink(path, showToast) };
}

/** Runs a change and shows a toast if it fails. */
export async function tryOp(work: () => Promise<unknown>, then?: () => void) {
  try {
    await work();
    then?.();
  } catch (err) {
    showToast((err as Error).message);
  }
}

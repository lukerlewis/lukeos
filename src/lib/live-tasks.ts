"use client";

import { useSyncExternalStore } from "react";
import type { Task } from "@/core/tasks";

/**
 * Task changes shown at once, before the server's fresh lists arrive: edits
 * made in the task box, and tasks just added. Lists read this through
 * useLiveTasks, so a changed task updates (or moves to its new list or card)
 * the moment Luke closes the box, and a new one appears straight away.
 */
type Recent = { task: Task; since: number };
const recent = new Map<string, Recent>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

// Long enough for the server's fresh lists to arrive.
const KEEP_MS = 15000;
const time = (d: Date | string) => new Date(d).getTime();

/** Show this version of a task in every list until the server's own copy is newer. */
export function showTask(task: Task) {
  const entry = { task, since: time(task.updatedAt) };
  recent.set(task.id, entry);
  notify();
  setTimeout(() => {
    if (recent.get(task.id) === entry) forgetTask(task.id);
  }, KEEP_MS);
}

export function forgetTask(id: string) {
  if (recent.delete(id)) notify();
}

/** A task made in the browser, shown until the saved one arrives. It can't be opened or ticked yet. */
export const isUnsaved = (id: string) => id.startsWith("unsaved-");

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/**
 * The list with recent changes applied. `fits` says which tasks belong in it:
 * a changed task that no longer fits leaves, and a new or changed one that
 * now fits joins. Without it, changes show but nothing joins or leaves.
 */
export function useLiveTasks(tasks: Task[], fits?: (task: Task) => boolean): Task[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  if (!recent.size) return tasks;
  const live: Task[] = [];
  const have = new Set<string>();
  for (const t of tasks) {
    have.add(t.id);
    const r = recent.get(t.id);
    // The server's copy wins once it's caught up with the change.
    if (!r || time(t.updatedAt) > r.since) live.push(t);
    else if (!fits || fits(r.task)) live.push(r.task);
  }
  if (!fits) return live;
  for (const { task } of recent.values()) if (!have.has(task.id) && fits(task)) live.push(task);
  return live;
}

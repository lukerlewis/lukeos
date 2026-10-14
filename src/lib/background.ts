"use client";

import { useSyncExternalStore } from "react";
import { showToast, showTrashedToast } from "@/components/shell/toast";

/**
 * Saves without making Luke wait: the screen has already moved on, so this
 * only speaks up if the save fails. Resolves either way; `failed` gets the error.
 */
export function inBackground<T>(
  work: () => Promise<T>,
  { then, failed, failure }: { then?: (result: T) => void; failed?: (err: Error) => void; failure?: string } = {},
): Promise<T | undefined> {
  return work().then(
    (result) => {
      then?.(result);
      return result;
    },
    (err: Error) => {
      showToast(failure ? `${failure} ${err.message}` : err.message);
      failed?.(err);
      return undefined;
    },
  );
}

/**
 * Things just deleted or moved away, hidden at once while the server catches up.
 * Rows check this so they vanish the moment Luke acts.
 */
const hidden = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

export function hide(...ids: string[]) {
  ids.forEach((id) => hidden.add(id));
  notify();
}

export function unhide(...ids: string[]) {
  ids.forEach((id) => hidden.delete(id));
  notify();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The list without anything hidden. */
export function useWithoutHidden<T extends { id: string }>(items: T[]): T[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return hidden.size ? items.filter((i) => !hidden.has(i.id)) : items;
}

/** True while this id is hidden. */
export function useHidden(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => hidden.has(id),
    () => false,
  );
}

type Trashable = Parameters<typeof showTrashedToast>[0];

/**
 * Moves something to Trash without waiting: it's hidden at once and the
 * "Moved to Trash" toast shows straight away. Comes back if the delete fails.
 */
export function trashInBackground(
  type: Trashable,
  id: string,
  remove: () => Promise<unknown>,
  { then, onUndone }: { then?: () => void; onUndone?: () => void } = {},
) {
  hide(id);
  const deleting = remove();
  showTrashedToast(type, id, () => {
    unhide(id);
    onUndone?.();
  }, deleting.catch(() => {}));
  deleting.then(
    () => then?.(),
    (err: Error) => {
      unhide(id);
      showToast(err.message);
    },
  );
}

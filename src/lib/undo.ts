/**
 * Luke's recent changes, newest last, each with a way to take it back.
 * Cmd+Z (Ctrl+Z elsewhere) and the Undo button on a toast both take from here.
 * Lives only in this browser tab.
 */

export type UndoEntry = { id: number; label: string; run: () => Promise<void> };

const LIMIT = 50;
const stack: UndoEntry[] = [];
let nextId = 1;
let undoing = 0;

/** True while an undo is running, so the changes it makes aren't themselves added to the stack. */
export const isUndoing = () => undoing > 0;

/** Remembers a change. `label` finishes "Undid …", e.g. "moving “Call Mum”". */
export function pushUndo(label: string, run: () => Promise<void>): UndoEntry | null {
  if (isUndoing()) return null;
  const entry = { id: nextId++, label, run };
  stack.push(entry);
  if (stack.length > LIMIT) stack.shift();
  return entry;
}

/** Takes back one change: the given one, or the latest. Returns what was undone, or null if nothing was. */
export async function undo(id?: number): Promise<UndoEntry | null> {
  const index = id === undefined ? stack.length - 1 : stack.findIndex((e) => e.id === id);
  if (index < 0) return null;
  const [entry] = stack.splice(index, 1);
  undoing++;
  try {
    await entry.run();
  } finally {
    undoing--;
  }
  return entry;
}

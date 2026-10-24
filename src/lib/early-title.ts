"use client";

/**
 * A new note's title typed before its page has finished opening, handed over
 * to the note's editor when it arrives so nothing typed is lost.
 */
const early = new Map<string, string>();

export function setEarlyTitle(id: string, title: string) {
  early.set(id, title);
}

/** The title typed early for this note, if any. */
export const earlyTitle = (id: string) => early.get(id);

/** Once the editor has it. */
export function clearEarlyTitle(id: string) {
  early.delete(id);
}

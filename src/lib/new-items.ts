/**
 * Where a new note or document opens. The browser picks its id, and the page
 * makes it as it opens, so Luke can start typing after one trip instead of two.
 */
function newItemHref(base: string, place: Record<string, string | null | undefined>) {
  const query = new URLSearchParams({ new: "1" });
  for (const [key, value] of Object.entries(place)) if (value) query.set(key, value);
  return `${base}/${crypto.randomUUID()}?${query}`;
}

export const newNoteHref = (place: { title?: string; projectId?: string | null; folderId?: string | null } = {}) =>
  newItemHref("/notes", { title: place.title, project: place.projectId, folder: place.folderId });

export const newDocumentHref = (place: { title?: string; projectId?: string | null } = {}) =>
  newItemHref("/documents", { title: place.title, project: place.projectId });

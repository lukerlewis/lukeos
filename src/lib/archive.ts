/** Work archive fields, shared by the screens and the operations. */

export const entrySizes = ["win", "story", "project"] as const;
export type EntrySize = (typeof entrySizes)[number];

export const entryStages = ["raw", "drafted", "published"] as const;
export type EntryStage = (typeof entryStages)[number];

export const sizeLabel: Record<EntrySize, string> = { win: "Quick win", story: "Story", project: "Project" };
export const sizePlural: Record<EntrySize, string> = { win: "Quick wins", story: "Stories", project: "Projects" };
export const stageLabel: Record<EntryStage, string> = { raw: "Raw", drafted: "Drafted", published: "Published" };

/** A link's address, made safe to open: http(s) only, "figma.com/x" gets https:// in front. */
export function safeLinkUrl(input: string) {
  const text = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** "820 KB", "2.4 MB". */
export function fileSize(bytes: number | null) {
  if (bytes === null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

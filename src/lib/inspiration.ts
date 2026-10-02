/** What can be saved to Inspiration. */
export const inspirationKinds = ["image", "link", "video", "text", "file"] as const;
export type InspirationKind = (typeof inspirationKinds)[number];

export const kindPlural: Record<InspirationKind, string> = {
  image: "Pictures",
  link: "Links",
  video: "Videos",
  text: "Quotes",
  file: "Files",
};

/** The largest file the app takes in one go (Vercel's limit on what one upload can carry). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Tags are short, lower case and unique: "blue", "packaging", "calm". */
export function cleanTags(tags: string[]) {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw
      .toLowerCase()
      .replace(/^#/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 30);
}

/** "example.com" from a web address. */
export function siteOf(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "PDF · 1.2 MB" */
export function fileDetail(file: { name: string; mimeType: string; bytes: number }) {
  const ext = file.mimeType === "application/pdf" ? "PDF" : (file.name.split(".").pop()?.toUpperCase() ?? "File");
  const size = file.bytes >= 1024 * 1024 ? `${(file.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.bytes / 1024))} KB`;
  return `${ext} · ${size}`;
}

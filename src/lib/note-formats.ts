/** How a note or an artifact part is written: Markdown, or a finished HTML page. */
export const noteFormats = ["markdown", "html"] as const;
export type NoteFormat = (typeof noteFormats)[number];

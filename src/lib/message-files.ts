/** Limits and kinds for files sent in Messages. Shared by the app and the server. */

/** Up to this size a file goes through the app; bigger ones go straight to Blob storage. */
export const DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;
/** The biggest file Messages takes (a few minutes of phone video). */
export const MAX_MESSAGE_FILE_BYTES = 100 * 1024 * 1024;
/** How many things can go with one message. */
export const MAX_ATTACHMENTS = 10;

export type AttachmentKind = "image" | "video" | "file";

export function attachmentKind(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") return "image";
  if (/^video\/(mp4|quicktime|webm)$/.test(mimeType)) return "video";
  return "file";
}

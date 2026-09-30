/** Longest side, in pixels, of a photo saved into a note. Plenty for a phone or laptop screen. */
const MAX_SIDE = 1600;
const MAX_BYTES = 3 * 1024 * 1024;

type Photo = { data: string; mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Makes a photo small enough to store: at most 1600px on its longest side,
 * saved as WebP (or JPEG where the browser can't make WebP). GIFs are kept
 * as they are so animations still play.
 */
export async function shrinkPhoto(file: File): Promise<Photo> {
  if (file.type === "image/gif" && file.size <= MAX_BYTES) return { data: await toBase64(file), mimeType: "image/gif" };

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file isn't a photo this browser can read.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;

  const blobOf = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob = await blobOf("image/webp", 0.85);
  let mimeType: Photo["mimeType"] = "image/webp";
  if (!blob || blob.type !== "image/webp") {
    // JPEG has no transparency, so give see-through parts a white background.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    blob = await blobOf("image/jpeg", 0.85);
    mimeType = "image/jpeg";
  }
  bitmap.close();
  if (!blob) throw new Error("This browser couldn't prepare the photo.");
  if (blob.size > MAX_BYTES) throw new Error("It's too large, even after shrinking.");
  return { data: await toBase64(blob), mimeType };
}

import "server-only";
import heicConvert from "heic-convert";
import sharp from "sharp";

/** Longest side of a kept picture. Sharp on a phone or laptop; about a tenth of a camera photo's size. */
export const PICTURE_SIDE = 2000;
/** Width of the small copy the gallery shows. */
const THUMB_WIDTH = 640;

export type Prepared = {
  display: { data: Buffer; mimeType: string };
  thumb: { data: Buffer; mimeType: string };
  width: number;
  height: number;
};

/**
 * Turns any picture (a photo, a screenshot, a link's preview image) into the
 * two copies Inspiration keeps: one at most 2000px for looking at, and a
 * small one for the gallery. Both WebP; GIFs keep their animation.
 */
export async function preparePicture(original: Buffer): Promise<Prepared> {
  let input = original;
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  const readable = async () => {
    const m = await sharp(input).metadata();
    // sharp reads HEIF's header but can't open iPhone photos (HEIC, HEVC inside).
    if (m.format === "heif" && m.compression !== "av1") throw new Error("HEIC");
    return m;
  };
  try {
    meta = await readable();
  } catch {
    // So turn an iPhone photo into a JPEG first.
    try {
      input = Buffer.from(await heicConvert({ buffer: original, format: "JPEG", quality: 0.92 }));
      meta = await readable();
    } catch {
      throw new Error("That isn't a picture LukeOS can read.");
    }
  }
  const animated = (meta.pages ?? 1) > 1;
  const image = () => sharp(input, { animated }).rotate();

  const { data: display, info } = await image()
    .resize({ width: PICTURE_SIDE, height: PICTURE_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(input) // first frame only
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 76 })
    .toBuffer();

  return {
    display: { data: display, mimeType: "image/webp" },
    thumb: { data: thumb, mimeType: "image/webp" },
    width: info.width,
    // An animation's info.height is every frame stacked.
    height: animated ? (info.pageHeight ?? info.height) : info.height,
  };
}

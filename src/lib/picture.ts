import "server-only";
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
export async function preparePicture(input: Buffer): Promise<Prepared> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new Error("That isn't a picture LukeOS can read.");
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

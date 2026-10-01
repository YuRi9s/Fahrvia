import sharp from "sharp";
import { AppError } from "../../server/policy";
/** Re-encoding removes EXIF/location metadata and bounds decoded image dimensions. */
export async function normalizeImage(
  bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: 25000000,
      pages: 1,
    });
    const meta = await image.metadata();
    if (!["jpeg", "png"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1)
      throw new AppError(422, "Dieses Bildformat ist nicht erlaubt.");
    return new Uint8Array(
      await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer(),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      422,
      "Das Bild ist beschädigt oder kann nicht sicher verarbeitet werden.",
    );
  }
}

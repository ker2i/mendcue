// Decode once for private storage, then prepare a separate bounded vision input.
import sharp from "sharp";
import { ModelFailure } from "../meta/provider.js";

sharp.cache(false);
sharp.concurrency(1);
export const IMAGE_MAX_PIXELS = 24_000_000;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const INFERENCE_IMAGE_BYTES = 75_000; // <=100k base64, leaves 20k for schema/text.
export const MODEL_REQUEST_BYTES = 120_000;
let active = 0;
async function bounded<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) throw new ModelFailure("Image processing busy; retry or use manual entry");
  active++;
  try { return await work(); } finally { active--; }
}
function decoder(input: Buffer) {
  if (!input.length || input.length > IMAGE_MAX_BYTES) throw new ModelFailure("Image byte limit exceeded");
  return sharp(input, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "warning", sequentialRead: true }).timeout({ seconds: 5 });
}
export async function sanitizeImage(input: Buffer): Promise<Buffer> {
  return bounded(async () => {
    try {
      const metadata = await decoder(input).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error("unsupported image");
      // Auto-orient before removing all EXIF/XMP/ICC metadata. Store full dimensions.
      const result = await decoder(input).rotate().webp({ quality: 95, effort: 2 }).toBuffer();
      if (result.length > IMAGE_MAX_BYTES) throw new Error("normalized image too large");
      return result;
    } catch { throw new ModelFailure("Invalid, excessive, animated or unsupported image"); }
  });
}
export async function inferenceImage(input: Buffer): Promise<Buffer> {
  return bounded(async () => {
    try {
      // Never shrink below a 1280px longest edge just to force a byte fit.
      // A detailed/noisy label that cannot fit gets manual entry, not a tiny image.
      for (const edge of [1920, 1600, 1280]) {
        for (const quality of [85, 70, 55]) {
          const result = await decoder(input).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
            .flatten({ background: "white" }).jpeg({ quality, mozjpeg: false }).toBuffer();
          if (result.length <= INFERENCE_IMAGE_BYTES) return result;
        }
      }
      throw new Error("Cannot fit a readable image");
    } catch { throw new ModelFailure("Photo cannot fit the vision budget; type the label or upload a clear crop"); }
  });
}

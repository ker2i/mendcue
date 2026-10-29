// Storage interface: filesystem volume now, S3-compatible later.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface StoredFile { storageKey: string; sha256: string; sizeBytes: number }

export interface StorageAdapter {
  put(caseId: string, filename: string, data: Buffer, mimeType: string): Promise<StoredFile>;
  get(storageKey: string): Promise<Buffer | null>;
}

export class FilesystemStorage implements StorageAdapter {
  constructor(private root: string) {}
  async put(caseId: string, filename: string, data: Buffer): Promise<StoredFile> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const key = `${caseId}/${randomUUID()}-${filename}`.replace(/[^a-zA-Z0-9/._-]/g, "_");
    const full = join(this.root, key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
    return { storageKey: key, sha256, sizeBytes: data.length };
  }
  async get(storageKey: string): Promise<Buffer | null> {
    const full = join(this.root, storageKey);
    // Prevent traversal: resolved path must stay under root.
    const root = join(this.root, ".");
    if (!full.startsWith(root)) return null;
    if (!existsSync(full)) return null;
    return readFileSync(full);
  }
}

export function detectImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// Strips JPEG APPn segments (APP1/EXIF with GPS, XMP, etc.) by walking
// markers. Returns the original buffer for non-JPEG input or when the
// structure is invalid (fail-closed: never corrupt the stored file).
// Full decode/re-encode remains future work.
export function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  try {
    while (i + 4 <= buf.length) {
      if (buf[i] !== 0xff) break; // image data begins; copy the rest
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        out.push(buf.subarray(i, i + 2));
        i += 2;
        if (marker === 0xd9) break;
        continue;
      }
      if (marker === 0xda) { // start of scan: copy the rest verbatim
        out.push(buf.subarray(i));
        return Buffer.concat(out);
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2 || i + 2 + len > buf.length) break;
      const isApp = marker >= 0xe0 && marker <= 0xef;
      if (!isApp) out.push(buf.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    // Fell off the marker walk: preserve the tail conservatively.
    if (i < buf.length && out.length > 1) out.push(buf.subarray(i));
    if (out.length <= 1) return buf;
    return Buffer.concat(out);
  } catch {
    return buf;
  }
}

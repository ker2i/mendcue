// Storage interface: filesystem volume now, S3-compatible later.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, accessSync, constants, unlinkSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, basename } from "node:path";

export interface StoredFile { storageKey: string; sha256: string; sizeBytes: number }

export interface StorageAdapter {
  put(caseId: string, filename: string, data: Buffer, mimeType: string): Promise<StoredFile>;
  get(storageKey: string): Promise<Buffer | null>;
  delete?(storageKey: string): Promise<void>;
}

export class FilesystemStorage implements StorageAdapter {
  constructor(private root: string) {}
  async check() {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    accessSync(this.root, constants.R_OK | constants.W_OK);
  }
  async put(caseId: string, filename: string, data: Buffer): Promise<StoredFile> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (!/^[a-zA-Z0-9_-]+$/.test(caseId)) throw new Error("Invalid storage case key");
    const key = `${caseId}/${randomUUID()}-${basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const full = join(this.root, key);
    mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
    writeFileSync(full, data, { mode: 0o600 });
    return { storageKey: key, sha256, sizeBytes: data.length };
  }
  async get(storageKey: string): Promise<Buffer | null> {
    const full = this.resolveKey(storageKey);
    if (!full) return null;
    if (!existsSync(full)) return null;
    return readFileSync(full);
  }
  private resolveKey(key: string): string | null {
    if (!key || isAbsolute(key) || key.split(/[\\/]/).some(part => !part || part === "." || part === "..")) return null;
    const full = resolve(this.root, key);
    const rel = relative(resolve(this.root), full);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? full : null;
  }
  async delete(storageKey: string): Promise<void> {
    const full = this.resolveKey(storageKey);
    if (!full) throw new Error("Invalid storage key");
    try { unlinkSync(full); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
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

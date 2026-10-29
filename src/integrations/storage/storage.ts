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

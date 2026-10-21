import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { containsCardNumber } from "./import";

/** Local evidence-file storage (backlog 2). Files are stored under random keys, never under the uploaded name. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_FILE_TYPES = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
} as const;
export type AllowedFileType = keyof typeof ALLOWED_FILE_TYPES;

const STORAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR || "uploads");
}

/** The type comes from the file's leading bytes, not from the browser-supplied name or MIME type. */
export function sniffType(bytes: Uint8Array): AllowedFileType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"; // %PDF-
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  return null;
}

export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 120);
  return cleaned || "file";
}

/**
 * Best-effort PAN check on the raw bytes (catches text layers in uncompressed PDFs).
 * Compressed PDF streams and images can't be read this way.
 */
export function fileContainsCardNumber(filename: string, bytes: Uint8Array): boolean {
  return containsCardNumber(filename) || containsCardNumber(Buffer.from(bytes).toString("latin1"));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function storeFile(bytes: Uint8Array): Promise<string> {
  const key = randomUUID();
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(path.join(uploadDir(), key), bytes, { flag: "wx" });
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer | null> {
  if (!STORAGE_KEY.test(key)) return null;
  return readFile(path.join(uploadDir(), key)).catch(() => null);
}

export async function removeStoredFile(key: string): Promise<void> {
  if (!STORAGE_KEY.test(key)) return;
  await unlink(path.join(uploadDir(), key)).catch(() => undefined);
}

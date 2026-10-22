import type { FileHandle } from "node:fs/promises";
import { ATTACHMENT_LIMITS } from "@openscout/protocol";
import { AttachmentError } from "./attachment-contract.js";

/** Internal descriptor read: never let file growth turn readFile into an unbounded allocation. */
export async function readAttachmentFile(file: Pick<FileHandle, "read">, byteSize: number): Promise<Buffer> {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > ATTACHMENT_LIMITS.imageBytes)
    throw new AttachmentError("invalid_attachment_binding", 400);
  const bytes = Buffer.allocUnsafe(byteSize);
  let offset = 0;
  while (offset < byteSize) {
    const { bytesRead } = await file.read(bytes, offset, Math.min(64 * 1024, byteSize - offset), offset);
    if (!bytesRead) throw new AttachmentError("attachment_unavailable");
    offset += bytesRead;
  }
  // Detect a file that grew after stat without retaining any of its extra bytes.
  if ((await file.read(Buffer.allocUnsafe(1), 0, 1, offset)).bytesRead)
    throw new AttachmentError("attachment_unavailable");
  return bytes;
}

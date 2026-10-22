import { expect, test } from "bun:test";
import type { FileHandle } from "node:fs/promises";
import { ATTACHMENT_LIMITS } from "@openscout/protocol";
import { readAttachmentFile } from "./attachment-file-read.js";
function reader(size: number, fragment = Infinity) {
  const calls: Array<{ allocation: number; length: number; position: number }> = [];
  const file = { async read(buffer: Buffer, offset: number, length: number, position: number) {
    calls.push({ allocation: buffer.length, length, position });
    const bytesRead = Math.max(0, Math.min(length, size - position, fragment));
    buffer.fill(65, offset, offset + bytesRead);
    return { bytesRead, buffer };
  } } as unknown as Pick<FileHandle, "read">;
  return { file, calls };
}
test("descriptor reads allocate exactly the declared bytes and handle partial reads", async () => {
  const f = reader(130_000, 10_000);
  expect((await readAttachmentFile(f.file, 130_000)).equals(Buffer.alloc(130_000, 65))).toBe(true);
  expect(f.calls.every(c => c.allocation === 130_000 || c.allocation === 1)).toBe(true);
  expect(Math.max(...f.calls.map(c => c.length))).toBeLessThanOrEqual(64 * 1024);
  expect(f.calls.at(-1)).toEqual({ allocation: 1, length: 1, position: 130_000 });
});
test("growth after stat fails with only a one-byte EOF probe, never a growing readFile allocation", async () => {
  const f = reader(100_000_000);
  await expect(readAttachmentFile(f.file, 130_000)).rejects.toThrow("attachment_unavailable");
  expect(f.calls.map(c => c.allocation)).toEqual([130_000, 130_000, 1]);
  expect(f.calls.at(-1)?.position).toBe(130_000);
});
test("truncation and invalid declared sizes fail without exposing incomplete bytes", async () => {
  await expect(readAttachmentFile(reader(63).file, 64)).rejects.toThrow("attachment_unavailable");
  for (const size of [0, -1, 1.5, NaN, ATTACHMENT_LIMITS.imageBytes + 1]) {
    const f = reader(0);
    await expect(readAttachmentFile(f.file, size)).rejects.toThrow("invalid_attachment_binding");
    expect(f.calls).toHaveLength(0);
  }
});

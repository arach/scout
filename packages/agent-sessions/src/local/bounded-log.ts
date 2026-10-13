import * as fs from "node:fs";

export const AGENT_LOG_MAX_BYTES = 10 * 1024 * 1024;

/** One active file and one .1 file. Synchronous append/rotation is deliberately
 * atomic with respect to callbacks in the owning process: no pending async
 * appends can reopen the renamed file or race a truncation. Split oversized
 * writes too, rather than allowing one output event to exceed the limit. */
function appendBoundedLogSync(fs: typeof import("node:fs"), path: string, data: string | Uint8Array, maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid log byte limit");
  let size = 0;
  try { size = fs.statSync(path).size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Upgrade an existing oversized log without reading it all into memory.
  if (size > maxBytes) {
    const tail = Buffer.alloc(maxBytes);
    const fd = fs.openSync(path, "r");
    try { fs.readSync(fd, tail, 0, maxBytes, size - maxBytes); } finally { fs.closeSync(fd); }
    fs.writeFileSync(path, tail);
    size = maxBytes;
  }
  // Old archives from an interrupted/older writer are bounded on first use too.
  try { if (fs.statSync(`${path}.1`).size > maxBytes) fs.rmSync(`${path}.1`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const bytes = typeof data === "string" ? Buffer.from(data) : data;
  for (let offset = 0; offset < bytes.byteLength;) {
    if (size === maxBytes) {
      fs.rmSync(`${path}.1`, { force: true });
      fs.renameSync(path, `${path}.1`);
      size = 0;
    }
    const end = Math.min(bytes.byteLength, offset + maxBytes - size);
    fs.appendFileSync(path, bytes.subarray(offset, end));
    size += end - offset;
    offset = end;
  }
}

/** Async-compatible with existing stream transports, without asynchronous
 * filesystem writes that could race a rotation in the owning process. */
export async function appendBoundedLog(path: string, data: string | Uint8Array, maxBytes = AGENT_LOG_MAX_BYTES): Promise<void> {
  appendBoundedLogSync(fs, path, data, maxBytes);
}

/** Self-contained so a bundled broker/web entry does not import itself. The
 * serialized function has no closure dependencies: filesystem and limit are
 * explicit arguments. Select ESM on Node 22 as well as Bun. */
export function boundedLogPipeCommand(path: string, executable = process.execPath): string {
  const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
  const script = `import * as fs from "node:fs"; const append = ${appendBoundedLogSync.toString()}; for await (const chunk of process.stdin) append(fs, ${JSON.stringify(path)}, chunk, ${AGENT_LOG_MAX_BYTES});`;
  return `${quote(executable)} --input-type=module --eval ${quote(script)}`;
}

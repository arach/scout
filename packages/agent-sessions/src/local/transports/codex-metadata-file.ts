import { admitEffect } from "../../runtime/effect-admission.js";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** A failed/partial write leaves the last published metadata intact. This is
 * atomic publication, not a power-loss durability guarantee (no fsync here). */
export async function writeCodexMetadata(path: string, text: string,
  write: (path: string, text: string) => Promise<unknown> = (path, text) => writeFile(path, text, { flag: "wx", mode: 0o600 }),
  beforeEffect?: () => void,
): Promise<void> {
  admitEffect(beforeEffect);
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.${randomUUID()}.tmp`;
  try {
    admitEffect(beforeEffect);
    await write(staging, text);
    admitEffect(beforeEffect);
    await rename(staging, path);
  }
  finally { await rm(staging, { force: true }).catch(() => undefined); }
}

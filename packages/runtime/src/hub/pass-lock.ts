import { mkdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";

/** Keep compatibility with the CLI and daemon's existing lock directories. */
export function takeHubPassLock(home: string, name: "collect" | "managed-agents"): (() => void) | null {
  const lock = join(home, name + ".lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      if (Date.now() - statSync(lock).mtimeMs < 5 * 60_000) return null;
      rmSync(lock, { recursive: true, force: true });
      mkdirSync(lock);
    } catch { return null; }
  }
  // A full inbox or a slow vendor can keep a live pass busy for over five minutes.
  const heartbeat = setInterval(() => {
    const now = new Date();
    try { utimesSync(lock, now, now); } catch { /* a removed home has no lock */ }
  }, 60_000);
  heartbeat.unref?.();
  return () => { clearInterval(heartbeat); rmSync(lock, { recursive: true, force: true }); };
}

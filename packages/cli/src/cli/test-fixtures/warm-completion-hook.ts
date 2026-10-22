import { expect } from "bun:test";

// Fresh executable files can take longer than 500 ms to start on the test host.
// Warm only the synthetic script's early-exit path, not the completion query:
// argv/env/output assertions must still exercise the real production deadline.
export async function warmCompletionHook(executable: string): Promise<void> {
  const child = Bun.spawn([executable, "--scout-fixture-warmup"], {
    stdin: "ignore", stdout: "ignore", stderr: "pipe", timeout: 4_000,
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
}

import { randomBytes, randomUUID } from "node:crypto";
import { HubInboxClient, HubInboxError } from "./collector.js";
import { HUB_TEST_LABEL, isHubTestChunk, openHubChunk, sealHubChunk, type HubKeyPair } from "./seal.js";
import type { HubConfig } from "./state.js";

type StepName = "post" | "list" | "fetch" | "open" | "delete" | "webhooks";
type Step = { name: StepName; result: "passed" | "failed" | "skipped"; ms: number; detail?: string };

/** The caller owns the collect lock. Only the key from this POST is collected. */
export async function probeInbox(config: HubConfig, identity: HubKeyPair, managed: boolean) {
  const steps: Step[] = [];
  async function step<T>(name: StepName, run?: () => Promise<T> | T): Promise<T | undefined> {
    const start = performance.now();
    if (!run) { steps.push({ name, result: "skipped", ms: 0 }); return; }
    try {
      const value = await run();
      steps.push({ name, result: "passed", ms: Math.round(performance.now() - start) });
      return value;
    } catch (error) {
      steps.push({ name, result: "failed", ms: Math.round(performance.now() - start),
        detail: error instanceof HubInboxError ? (error.status ? `Inbox answered ${error.status}` : "Inbox unreachable")
          : `Could not verify the ${name} step.` });
    }
  }
  const writer = new HubInboxClient(config.inbox, config.writeToken);
  const reader = new HubInboxClient(config.inbox, config.readToken);
  const nonce = randomBytes(32);
  const sessionId = randomUUID();
  const key = await step("post", () => writer.post(Uint8Array.from(sealHubChunk({
    v: 1, kind: "scout.test", label: HUB_TEST_LABEL, sessionId, remoteSessionId: null,
    file: "", offset: 0, seq: 0, cwd: null, sentAt: new Date().toISOString(),
  }, nonce, identity.publicKey))));
  const listed = await step("list", !key ? undefined : async () => {
    let after: string | undefined;
    for (;;) {
      const page = await reader.pending(after, 1000);
      if (page.items.some(item => item.key === key)) return true;
      if (!page.cursor || (after && page.cursor <= after)) throw new Error();
      after = page.cursor;
    }
  });
  const bytes = await step("fetch", key && listed ? () => reader.get(key) : undefined);
  await step("open", !bytes ? undefined : () => {
    const { header, data } = openHubChunk(bytes, identity);
    if (!isHubTestChunk(header) || header.sessionId !== sessionId || !nonce.equals(data)) throw new Error();
  });
  await step("delete", key ? () => reader.delete(key) : undefined);
  const enabled = managed ? await step("webhooks", async () => (await reader.health()).webhooks?.anthropic === true) : undefined;
  return { ok: steps.every(s => s.result === "passed"), steps, ...(managed ? { webhooksEnabled: enabled ?? null } : {}) };
}

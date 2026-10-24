/** Owned synthetic stream: no broker or harness is contacted. */
import { heapStats } from "bun:jsc";
import { watchScoutMessages } from "../service.ts";
let stream!: ReadableStreamDefaultController<Uint8Array>;
let received = 0;
let lifecycles = 0;
const encoder = new TextEncoder();
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const path = new URL(input instanceof Request ? input.url : input).pathname;
  if (path === "/health") return Response.json({ ok: true, nodeId: "fixture" });
  if (path === "/v1/node") return Response.json({ id: "fixture" });
  if (path === "/v1/snapshot") return Response.json({ messages: {}, invocations: {} });
  if (path !== "/v1/events/stream") throw Error(`unexpected synthetic route ${path}`);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
}) as unknown as typeof fetch;
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("synthetic watch deadline");
    await Bun.sleep(1);
  }
};
const collect = async () => {
  await Bun.sleep(10); Bun.gc(true); await Bun.sleep(10); Bun.gc(true);
  return heapStats().heapSize;
};
const controller = new AbortController();
const watching = watchScoutMessages({ allConversations: true, signal: controller.signal,
  onMessage() { received++; }, onLifecycle() { lifecycles++; },
});
await until(() => !!stream);
const empty = await collect();
const samples: number[] = [];
function enqueue(index: number) {
  const id = String(index);
  for (const event of [
    { kind: "message.posted", payload: { message: { id, conversationId: "fixture", actorId: "fixture",
      body: id + "|" + "x".repeat(65536), class: "agent", createdAt: 0, metadata: { clientMessageId: `client-${id}` } } } },
    { kind: "invocation.requested", payload: { invocation: { id: `inv-${id}`, conversationId: "fixture",
      messageId: id, targetAgentId: "fixture", prompt: id + "|" + "y".repeat(65536) } } },
  ]) stream.enqueue(encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`));
}
for (let batch = 0; batch < 5; batch++) {
  for (let n = 0; n < 100; n++) enqueue(batch * 100 + n);
  await until(() => received === (batch + 1) * 100 && lifecycles === received);
  samples.push(await collect());
}
stream.close(); controller.abort(); await watching;
const closed = await collect();
console.log(JSON.stringify({ empty, samples, closed, received, lifecycles }));

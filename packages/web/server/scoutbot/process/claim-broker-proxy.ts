import { createServer } from "node:http";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantClaimHeaders, bindAssistantClaim } from "../answerer-claim.ts";

/** Scope the stdio MCP child's socket to this lease generation. The token never
 * enters child env, tool arguments or receipts. The owner-only socket is itself
 * a local capability and dies with this generation; it cannot borrow a new lease. */
export async function createAssistantBrokerProxy(brokerSocketPath: string) {
  const directory = await mkdtemp(join(tmpdir(), "scout-answerer-"));
  await chmod(directory, 0o700);
  const socketPath = join(directory, "broker.sock");
  const server = createServer(bindAssistantClaim(async (request, response) => {
    try {
      const proof = assistantClaimHeaders(); // Refuse new child work as soon as the lease is lost.
      const destination = new URL(request.url ?? "/", "http://localhost");
      if (destination.pathname.startsWith("/v1/assistant-claims")) {
        response.writeHead(403); response.end(); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 10 * 1024 * 1024) { response.writeHead(413); response.end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value && !["host", "connection", "content-length", "transfer-encoding", "x-scout-assistant-claim-token"].includes(key)) {
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
      }
      for (const [key, value] of Object.entries(proof)) headers.set(key, value);
      // Recheck after reading the body, without switching to a successor's scope.
      assistantClaimHeaders();
      const result = await fetch(destination, {
        unix: brokerSocketPath, method: request.method, headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        signal: AbortSignal.timeout(45_000),
      });
      response.writeHead(result.status, { "content-type": result.headers.get("content-type") ?? "application/json" });
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!response.headersSent) response.writeHead(409, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "assistant_claim_lost" }));
    }
  }));
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
  } catch (error) {
    server.close(); await rm(directory, { recursive: true, force: true }); throw error;
  }
  return { socketPath, async close() {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}

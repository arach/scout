import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { requestScoutBrokerJson } from "./broker-api.js";

test("Scoutbot socket-only requests fail closed instead of falling back to TCP", async () => {
  const before = process.env.OPENSCOUT_BROKER_SOCKET_ONLY;
  let hits = 0;
  const server = createServer((_request, response) => { hits++; response.end("{}"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.OPENSCOUT_BROKER_SOCKET_ONLY = "1";
  try {
    await expect(requestScoutBrokerJson(`http://127.0.0.1:${port}`, "/v1/node", { socketPath: `/tmp/scoutbot-missing-${process.pid}.sock` })).rejects.toThrow("does not exist");
    await expect(requestScoutBrokerJson(`http://127.0.0.1:${port}`, "/v1/node")).rejects.toThrow("no socket path");
    expect(hits).toBe(0);
  } finally {
    if (before === undefined) delete process.env.OPENSCOUT_BROKER_SOCKET_ONLY; else process.env.OPENSCOUT_BROKER_SOCKET_ONLY = before;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

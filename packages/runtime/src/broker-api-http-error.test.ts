import { describe, expect, spyOn, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestScoutBrokerJson, requestScoutBrokerJsonWithTrace, ScoutBrokerHttpError } from "./broker-api.js";

describe("broker HTTP error fields", () => {
  test("keeps the three-argument HTTP error constructor and exact message format", () => {
    const body = '{\n  "error": "roles_unavailable", "detail": "not open"\n}\n';
    const error = new ScoutBrokerHttpError(503, "/v1/roles/catalog?probe=1", body);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ScoutBrokerHttpError");
    expect(error.status).toBe(503);
    expect(error.body).toBe(body);
    expect(error.code).toBeUndefined(); // No code was supplied by a request helper.
    expect(error.message).toBe(`/v1/roles/catalog?probe=1 returned 503: ${body}`);
  });

  for (const transport of ["http", "unix_socket"] as const) {
    test(`retains raw HTTP error bodies and optional JSON codes over ${transport}`, async () => {
      const cases: Array<{ body: string; code?: string }> = [
        { body: ' {\n"error":"roles_unavailable", "detail":"not open"\n}\n', code: "roles_unavailable" },
        { body: '{"detail":"no error code"}' },
        { body: "upstream unavailable\n" },
        { body: "" },
        { body: '{"error":null}' },
        { body: '{"error":503}' },
        { body: '{"error":{"code":-32602,"message":"nested RPC failure"}}' },
        { body: '{"code":"not_the_error_field"}' },
        { body: "null" },
        { body: '"roles_unavailable"' },
        { body: '[{"error":"not_top_level"}]' },
        { body: '{"error":""}', code: "" },
        { body: '{"error":"  unknown conversation  "}', code: "  unknown conversation  " },
      ];
      const directory = await mkdtemp(join(tmpdir(), "scout-broker-error-"));
      const socketPath = join(directory, "broker.sock");
      const server = createServer((request, response) => {
        const index = Number(new URL(request.url!, "http://localhost").searchParams.get("case"));
        response.writeHead(request.url?.startsWith("/success") ? 200 : 503, { "content-type": "application/json" });
        response.end(cases[index]!.body);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          if (transport === "unix_socket") server.listen(socketPath, resolve);
          else server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        const baseUrl = transport === "unix_socket" ? "http://127.0.0.1:1"
          : `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
        const options = transport === "unix_socket" ? { socketPath } : {};
        for (const [index, item] of cases.entries()) {
          const path = `/failure?case=${index}`;
          const parse = spyOn(JSON, "parse");
          try {
            const error = await requestScoutBrokerJson(baseUrl, path, options).catch((error: unknown) => error);
            expect(error, path).toBeInstanceOf(ScoutBrokerHttpError);
            if (!(error instanceof ScoutBrokerHttpError)) throw new Error(`Expected an HTTP error for ${path}`);
            expect(error.name, path).toBe("ScoutBrokerHttpError");
            expect(error.status, path).toBe(503);
            expect(error.body, path).toBe(item.body);
            expect(error.code, path).toBe(item.code);
            expect(error.message, path).toBe(`${path} returned 503: ${item.body}`);
            expect(parse.mock.calls.filter(args => args[0] === item.body), path).toHaveLength(item.body ? 1 : 0);
          } finally { parse.mockRestore(); }
        }
        // Existing opt-in error acceptance and HTTP-200 application errors do
        // not become exceptions merely because their JSON has an error field.
        const accepted = await requestScoutBrokerJsonWithTrace(baseUrl, "/failure?case=0", {
          ...options, acceptErrorJson: (value): value is { error: string; detail?: string } =>
            !!value && typeof value === "object" && "error" in value && value.error === "roles_unavailable",
        });
        expect(accepted.value).toEqual({ error: "roles_unavailable", detail: "not open" });
        expect(accepted.trace.transport).toBe(transport);
        expect(await requestScoutBrokerJson<unknown>(baseUrl, "/success?case=6", options))
          .toEqual({ error: { code: -32602, message: "nested RPC failure" } });
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

});

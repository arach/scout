import { expect, test } from "bun:test";
import { delegatedRouteInventory, extractRouteInventory } from "./broker-route-inventory.js";

test("extracts delegated request methods, literal constants and named route captures", () => {
  const routes = extractRouteInventory(`
    const READ_PATH = "/v1/attachments/read";
    if (request.method === "POST" && url.pathname === READ_PATH) return true;
    const record = method === "GET" ? url.pathname.match(/^\\/v1\\/history\\/records\\/(?<kind>[^/]+)\\/(?<id>[^/]+)$/) : null;
  `);
  expect([...routes].sort()).toEqual([
    "GET /v1/history/records/:kind/:id", "POST /v1/attachments/read",
  ]);
  expect(() => extractRouteInventory('if (method === "GET" && url.pathname === DYNAMIC_PATH) {}'))
    .toThrow("Unresolved route path constant: DYNAMIC_PATH");
});

test("follows new imports, aliases, namespaces and nested HTTP delegation with cycle protection", () => {
  const files: Record<string, string> = {
    "broker-http-router.ts": `
      import { handleNewRoute as delegate } from "./new.js";
      import * as nested from "./nested.js";
      import plain from "./plain.js";
      import type { Unused } from "./missing.js";
      import { type Other, unused } from "./also-missing.js";
      delegate(context); nested.handleWrappedRoute(wrapper); plain({ request, response, url });
    `,
    "new.ts": `
      import { handleBack } from "./broker-http-router.js";
      handleBack(context);
      if (request.method === "POST" && url.pathname === "/v1/new") return true;
    `,
    "nested.ts": `
      import { dispatch } from "./deeper/child.js";
      dispatch(request, response, url);
    `,
    "deeper/child.ts": 'if (method === "GET" && url.pathname === "/v1/deep") return true;',
    "plain.ts": 'if (url.pathname === "/v1/plain" && method === "GET") return true;',
  };
  const result = delegatedRouteInventory(file => {
    if (!(file in files)) throw new Error(`missing source ${file}`);
    return files[file]!;
  });
  expect(result.routes).toEqual(["GET /v1/deep", "GET /v1/plain", "POST /v1/new"]);
  expect(result.sources.size).toBe(5);
  delete files["deeper/child.ts"];
  expect(() => delegatedRouteInventory(file => {
    if (!(file in files)) throw new Error(`missing source ${file}`);
    return files[file]!;
  })).toThrow("missing source deeper/child.ts");
});

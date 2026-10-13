import { expect, test } from "bun:test";
import { isSlowScoutApiResponse, markScoutApiExpectedWait } from "./server-core.ts";

test("normal voice waits are quiet; excess delay and failed requests stay visible", () => {
  const request = new Request("http://localhost/api/voice/host/commands?timeoutMs=25000");
  expect(isSlowScoutApiResponse(request, 200, 25_005)).toBe(true);
  markScoutApiExpectedWait(request, 25_000);
  expect(isSlowScoutApiResponse(request, 200, 25_005)).toBe(false);
  expect(isSlowScoutApiResponse(request, 200, 58_515)).toBe(true);
  expect(isSlowScoutApiResponse(request, 503, 1_000)).toBe(true);
  const ordinary = new Request("http://localhost/api/agents?timeoutMs=9999999");
  expect(isSlowScoutApiResponse(ordinary, 200, 501)).toBe(true);
  markScoutApiExpectedWait(ordinary, Infinity);
  expect(isSlowScoutApiResponse(ordinary, 200, 501)).toBe(true);
});

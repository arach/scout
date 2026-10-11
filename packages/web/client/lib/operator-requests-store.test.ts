import { expect, mock, test } from "bun:test";
import type { OperatorAttentionState } from "./types.ts";
let calls: string[] = [];
let load: () => Promise<OperatorAttentionState>;
mock.module("./api.ts", () => ({ api: (path: string) => { calls.push(path); return load(); } }));
const { getRequestsSnapshot, receiveRequests, refreshRequests } = await import("./operator-requests-store.ts");
const state = (all: number): OperatorAttentionState => ({ generatedAt: 1, totals: { all, approvals: 0, configuration: 0, collaboration: all }, items: [] });

test("sidebar and page share one in-flight read from the canonical API", async () => {
  calls = [];
  let resolve!: (value: OperatorAttentionState) => void;
  load = () => new Promise(done => { resolve = done; });
  const first = refreshRequests(); const second = refreshRequests();
  expect(first).toBe(second);
  expect(calls).toEqual(["/api/operator-attention"]);
  resolve(state(2)); await first;
  expect(getRequestsSnapshot().state?.totals.all).toBe(2);
});
test("a GET begun before a decision cannot resurrect an already decided item", async () => {
  let resolve!: (value: OperatorAttentionState) => void;
  load = () => new Promise(done => { resolve = done; });
  const stale = refreshRequests();
  receiveRequests(state(0));
  resolve(state(3)); await stale;
  expect(getRequestsSnapshot().state?.totals.all).toBe(0);
});
test("an outage keeps the last known count and records an error instead of false clearing", async () => {
  receiveRequests(state(4));
  load = () => Promise.reject(new Error("Source offline"));
  await refreshRequests();
  expect(getRequestsSnapshot().state?.totals.all).toBe(4);
  expect(getRequestsSnapshot().error).toBe("Source offline");
  expect(getRequestsSnapshot().loading).toBe(false);
});

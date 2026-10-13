import { describe, expect, test } from "bun:test";

import { failedDelivery } from "./request-delivery.ts";

describe("failedDelivery", () => {
  test("a 4xx answer is a refusal with the server's reason", () => {
    const cause = Object.assign(new Error("Permission request version is stale"), { status: 409 });
    expect(failedDelivery("Allow once", cause, "fallback")).toEqual({ state: "refused", label: "Allow once", reason: "Permission request version is stale" });
  });
  test("a 5xx or network failure may have landed, so it is unconfirmed", () => {
    expect(failedDelivery("Allow once", Object.assign(new Error("Bad gateway"), { status: 502 }), "fallback")).toEqual({ state: "unconfirmed", label: "Allow once" });
    expect(failedDelivery("Deny", new TypeError("Failed to fetch"), "fallback")).toEqual({ state: "unconfirmed", label: "Deny" });
  });
});

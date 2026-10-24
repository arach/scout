import { describe, expect, test } from "bun:test";
import { isSameMacScoutRequest } from "./pairing-request-trust.ts";

describe("isSameMacScoutRequest", () => {
  test("accepts only a direct loopback request", () => {
    expect(isSameMacScoutRequest(
      new Request("http://localhost/__openscout/bootstrap.js"),
      "127.0.0.1",
    )).toBe(true);
  });

  test("accepts a request through the local edge for a same-Mac client", () => {
    expect(isSameMacScoutRequest(
      new Request("http://example.scout.local/__openscout/bootstrap.js", {
        headers: { "x-forwarded-for": "192.168.1.20" },
      }),
      "127.0.0.1",
      ["192.168.1.20"],
    )).toBe(true);
  });

  test("rejects a request through the local edge for another LAN client", () => {
    expect(isSameMacScoutRequest(
      new Request("http://example.scout.local/__openscout/bootstrap.js", {
        headers: { "x-forwarded-for": "192.168.1.50" },
      }),
      "127.0.0.1",
      ["192.168.1.20"],
    )).toBe(false);
  });

  test("does not trust a remote X-Real-IP through the local edge", () => {
    expect(isSameMacScoutRequest(
      new Request("http://example.scout.local/__openscout/bootstrap.js", {
        headers: { "x-real-ip": "192.168.1.50" },
      }),
      "127.0.0.1",
      ["192.168.1.20"],
    )).toBe(false);
  });

  test("does not trust a forwarded chain even when it contains a local address", () => {
    expect(isSameMacScoutRequest(
      new Request("http://example.scout.local/__openscout/bootstrap.js", {
        headers: { "x-forwarded-for": "192.168.1.20, 192.168.1.50" },
      }),
      "127.0.0.1",
      ["192.168.1.20"],
    )).toBe(false);
  });

  test("rejects malformed or non-IP forwarding values", () => {
    for (const forwardedFor of ["192.168.1.20,", "localhost", "not-an-ip"]) {
      expect(isSameMacScoutRequest(
        new Request("http://example.scout.local/__openscout/bootstrap.js", {
          headers: { "x-forwarded-for": forwardedFor },
        }),
        "127.0.0.1",
        ["192.168.1.20"],
      )).toBe(false);
    }
  });

  test("accepts an IPv4-mapped form of this Mac's address", () => {
    expect(isSameMacScoutRequest(
      new Request("http://example.scout.local/__openscout/bootstrap.js", {
        headers: { "x-forwarded-for": "::ffff:192.168.1.20" },
      }),
      "::1",
      ["192.168.1.20"],
    )).toBe(true);
  });

  test("rejects the standardized Forwarded header", () => {
    expect(isSameMacScoutRequest(
      new Request("http://example.scout.local/__openscout/bootstrap.js", {
        headers: {
          forwarded: "for=192.168.1.20",
          "x-forwarded-for": "192.168.1.20",
        },
      }),
      "127.0.0.1",
      ["192.168.1.20"],
    )).toBe(false);
  });

  test("rejects a direct LAN peer", () => {
    expect(isSameMacScoutRequest(
      new Request("http://scout.local/__openscout/bootstrap.js"),
      "192.168.1.50",
    )).toBe(false);
  });
});

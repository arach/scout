import {expect, test} from "bun:test";
import {BoundedChannelDescriptor, ChannelIoError} from "../../packages/runtime/src/extension-channel-io.ts";
import {prefillForWriteAbort, PRESSURE_DRAIN_BYTES, PRESSURE_PRIMER_LIMIT} from "./pressure.ts";

const again = () => Object.assign(new Error("full"), {code: "EAGAIN"});
for (const capacity of [8192, 65536, 262144]) {
  for (const mode of ["cancel", "timeout"] as const) test(`held ${capacity}-byte pipe: ${mode} interrupts a real partial frame after EAGAIN`, async () => {
    let buffered = 0, closes = 0;
    const pressure = prefillForWriteAbort(bytes => {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      if (buffered + bytes.length > capacity) throw again();
      buffered += bytes.length; return bytes.length;
    });
    expect(pressure.bytes).toBe(capacity);
    // The child is permitted exactly one chunk, then cannot read again.
    buffered -= PRESSURE_DRAIN_BYTES;
    const endpoint = new BoundedChannelDescriptor(99, {
      read: () => {throw Error("not a reader");},
      write: (_fd, bytes) => {
        if (buffered + bytes.length > capacity) return -1;
        buffered += bytes.length; return bytes.length;
      },
      close: () => {closes++; return 0;},
    });
    const abort = new AbortController();
    const timer = mode === "cancel" ? setTimeout(() => abort.abort(), 10) : undefined;
    try {
      await expect(endpoint.write(new Uint8Array(65536), {signal: abort.signal, timeoutMs: mode === "timeout" ? 30 : 2000}))
        .rejects.toMatchObject({reason: mode === "cancel" ? "cancelled" : "timeout"});
      expect(endpoint.stats.writeBytes).toBe(4096);
      expect(endpoint.stats.writeWouldBlock).toBeGreaterThan(0);
      expect(endpoint.stats.peakWriteBuffer).toBe(65536);
      expect(closes).toBe(1); expect(endpoint.stats.closeCalls).toBe(1);
      const calls = endpoint.stats.writeCalls; await Bun.sleep(5);
      expect(endpoint.stats.writeCalls).toBe(calls);
    } finally {clearTimeout(timer); endpoint.close();}
  });
}

test("a reader draining the old primer lets a whole 64-KiB frame finish, not abort", async () => {
  const endpoint = new BoundedChannelDescriptor(99, {read: () => -1, write: (_fd, bytes) => bytes.length, close: () => 0});
  try {
    await endpoint.write(new Uint8Array(65536), {timeoutMs: 1000});
    expect(endpoint.stats.writeBytes).toBe(65536); expect(endpoint.stats.writeWouldBlock).toBe(0);
    expect(endpoint.stats.closeCalls).toBe(0);
  } finally {endpoint.close();}
});
test("a reader that never permits pressure refuses at the bounded primer", () => {
  let total = 0;
  expect(() => prefillForWriteAbort(bytes => {total += bytes.length; return bytes.length;})).toThrow("bounded primer");
  expect(total).toBe(PRESSURE_PRIMER_LIMIT);
});
test("repeated EINTR cannot make pressure observation unbounded", () => {
  let calls = 0;
  expect(() => prefillForWriteAbort(() => {calls++; throw Object.assign(new Error("interrupted"), {code: "EINTR"});})).toThrow("bounded primer");
  expect(calls).toBeLessThanOrEqual(PRESSURE_PRIMER_LIMIT / PRESSURE_DRAIN_BYTES + 64);
});
test("pressure refuses no progress, hard errors, and an unusable drain quota", () => {
  expect(() => prefillForWriteAbort(() => 0)).toThrow("invalid pressure write");
  expect(() => prefillForWriteAbort(() => {throw new ChannelIoError("native_error");})).toThrow("native_error");
  expect(() => prefillForWriteAbort(() => {throw again();})).toThrow("drain quota");
});

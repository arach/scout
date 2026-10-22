import { expect, test } from "bun:test";
import { BoundedChannelDescriptor, ChannelIoError, createExtensionChannelCandidate, EXTENSION_CHANNEL_LIMIT, type ChannelDriver, type ChannelIoReason } from "./extension-channel-io.ts";
function fixture(overrides: Partial<ChannelDriver> = {}) {
  const calls = {read: 0, write: 0, close: 0};
  const driver: ChannelDriver = {
    read() { calls.read++; return -1; }, write() { calls.write++; return -1; },
    close() { calls.close++; return 0; }, ...overrides,
  };
  return {calls, driver, endpoint: new BoundedChannelDescriptor(999, driver)};
}
async function rejects(promise: Promise<unknown>, reason: ChannelIoReason) {
  try { await promise; throw Error("unexpected success"); }
  catch (error) { expect(error).toBeInstanceOf(ChannelIoError); expect((error as ChannelIoError).reason).toBe(reason); }
}
test("partial writer snapshots input, retries EINTR/EAGAIN, and yields with bounded buffering", async () => {
  const written: number[] = []; let call = 0;
  const f = fixture({write(_fd, bytes) {
    call++; if (call === 1) return -1; if (call === 2) return -2;
    const n = Math.min(3, bytes.length); written.push(...bytes.subarray(0, n)); return n;
  }});
  const bytes = new Uint8Array(63).fill(7), pending = f.endpoint.write(bytes);
  bytes.fill(9); await pending;
  expect(written).toEqual(Array(63).fill(7)); expect(f.endpoint.stats.yields).toBeGreaterThan(1);
  expect(f.endpoint.stats.writeWouldBlock).toBe(1); expect(f.endpoint.stats.peakWriteBuffer).toBe(63);
  f.endpoint.close(); f.endpoint.close(); expect(f.calls.close).toBe(1);
});
test("reader assembles exactly 64 KiB despite short reads, EINTR and EAGAIN", async () => {
  let call = 0, offset = 0;
  const bytes = new Uint8Array(EXTENSION_CHANNEL_LIMIT).fill(120); bytes[bytes.length - 1] = 10;
  const f = fixture({read(_fd, buffer) {
    call++; if (call === 1) return -2; if (call === 2) return -1;
    const n = Math.min(997, buffer.length, bytes.length - offset); buffer.set(bytes.subarray(offset, offset + n)); offset += n; return n;
  }});
  const result = await f.endpoint.readFrame(); expect(result).toEqual(bytes);
  expect(f.endpoint.stats.readWouldBlock).toBe(1); expect(f.endpoint.stats.peakReadBuffer).toBe(65536);
  expect(await f.endpoint.readFrame()).toBeNull(); expect(f.calls.close).toBe(1);
});
for (const side of ["read", "write"] as const) {
  test(`${side} timeout closes once and disarms every pending retry`, async () => {
    const f = fixture();
    await rejects(side === "read" ? f.endpoint.readFrame({timeoutMs: 8}) : f.endpoint.write(new Uint8Array(64), {timeoutMs: 8}), "timeout");
    const before = {...f.calls}; f.endpoint.close(); await Bun.sleep(15);
    expect(f.calls).toEqual(before); expect(f.calls.close).toBe(1); expect(f.endpoint.closed).toBe(true);
  });
}
test("cancel concurrent reader/writer once; no stale callback can touch a recycled number", async () => {
  const f = fixture(), controller = new AbortController();
  const promises = [f.endpoint.readFrame({signal: controller.signal}), f.endpoint.write(new Uint8Array(100), {signal: controller.signal})];
  controller.abort(); await Promise.all(promises.map(p => rejects(p, "cancelled")));
  const before = {...f.calls}; controller.abort(); f.endpoint.close(); await Bun.sleep(20);
  expect(f.calls).toEqual(before); expect(f.calls.close).toBe(1);
});
test("already cancelled operations close without any I/O", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await rejects(f.endpoint.readFrame({signal: controller.signal}), "cancelled");
  expect(f.calls).toEqual({read: 0, write: 0, close: 1});
});
test("parent close wakes blocked I/O immediately and is idempotent", async () => {
  const f = fixture(), pending = f.endpoint.readFrame(); f.endpoint.close();
  await rejects(pending, "closed"); f.endpoint.close(); expect(f.calls.close).toBe(1);
});
test("busy writer refuses instead of building an unbounded write queue", async () => {
  const f = fixture(), a = f.endpoint.write(new Uint8Array(2)), b = f.endpoint.write(new Uint8Array(2));
  await Promise.all([rejects(a, "busy"), rejects(b, "busy")]); expect(f.calls.close).toBe(1);
});
test("oversize writer refuses before a syscall", async () => {
  const f = fixture(); await rejects(f.endpoint.write(new Uint8Array(65537)), "oversize");
  expect(f.calls).toEqual({read: 0, write: 0, close: 1}); expect(f.endpoint.stats.peakWriteBuffer).toBe(0);
});
test("unterminated 64-KiB frame refuses without allocating overflow storage", async () => {
  const f = fixture({read(_fd, bytes) { bytes.fill(120); return bytes.length; }});
  await rejects(f.endpoint.readFrame(), "oversize"); expect(f.endpoint.stats.readBytes).toBe(65536);
  expect(f.endpoint.stats.peakReadBuffer).toBe(65536); expect(f.calls.close).toBe(1);
});
test("truncated EOF and trailing frames refuse and close", async () => {
  let read = 0; const a = fixture({read(_fd, bytes) { if (read++) return 0; bytes[0] = 120; return 1; }});
  await rejects(a.endpoint.readFrame(), "truncated_frame"); expect(a.calls.close).toBe(1);
  const b = fixture({read(_fd, bytes) { bytes.set([10, 120]); return 2; }});
  await rejects(b.endpoint.readFrame(), "multiple_frames"); expect(b.calls.close).toBe(1);
});
for (const result of [-132, 0]) test(`hard write result ${result} closes exactly once`, async () => {
  const f = fixture({write() { return result; }}); await rejects(f.endpoint.write(new Uint8Array(1)), "native_error");
  f.endpoint.close(); expect(f.calls.close).toBe(1);
});
test("invalid deadline closes; close failure is never retried on a reused number", async () => {
  let close = 0; const f = fixture({close() { close++; return -104; }});
  await rejects(f.endpoint.readFrame({timeoutMs: Infinity}), "invalid_input");
  f.endpoint.close(); expect(close).toBe(1);
});
test("unqualified revision refuses before loading native compiler or allocating descriptors", () => {
  if (Bun.revision === "0d9b296af33f2b851fcbf4df3e9ec89751734ba4") return;
  expect(() => createExtensionChannelCandidate("context")).toThrow("extension_channel_candidate_unavailable");
});

test("parent listener-registration error closes once before any syscall", async () => {
  const f = fixture();
  const signal = {aborted: false, addEventListener() { throw Error("registration failed"); }, removeEventListener() {}} as unknown as AbortSignal;
  await rejects(f.endpoint.readFrame({signal, timeoutMs: 8}), "native_error");
  const before = {...f.calls}; await Bun.sleep(15); f.endpoint.close();
  expect(f.calls).toEqual(before); expect(f.calls).toEqual({read: 0, write: 0, close: 1});
});

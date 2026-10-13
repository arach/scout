import { describe, expect, test } from "bun:test";
import { watchFirstTaskDispatch, type FirstTaskDispatchSnapshot } from "./first-task-dispatch.ts";

const empty: FirstTaskDispatchSnapshot = { attempts: [], failedDeliveries: [], failedQueries: [] };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function clock() {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {
    pending,
    schedule: (callback: () => void, delay: number) => { expect(delay).toBe(2500); pending.set(++id, callback); return id; },
    cancel: (handle: unknown) => { pending.delete(handle as number); },
    tick: () => { const [key, callback] = [...pending][0]!; pending.delete(key); callback(); },
  };
}

describe("eventually projected exact first-task Dispatch row", () => {
  test("initial miss and broker error retry without a phase change; only exact message stops polling", async () => {
    const timer = clock();
    const found: string[] = [];
    let reads = 0;
    const stop = watchFirstTaskDispatch("ask-1", async () => {
      reads++;
      if (reads === 1) return empty;
      if (reads === 2) throw new Error("temporary outage");
      if (reads === 3) return { ...empty, attempts: [{ id: "wrong", messageId: "ask-2" }] };
      return { ...empty, attempts: [{ id: "wrong", messageId: "ask-2" }], failedDeliveries: [{ id: "exact", messageId: "ask-1" }] };
    }, id => found.push(id), timer);
    await flush();
    for (let i = 0; i < 3; i++) { expect(timer.pending.size).toBe(1); timer.tick(); await flush(); }
    expect(found).toEqual(["exact"]);
    expect(reads).toBe(4);
    expect(timer.pending.size).toBe(0);
    stop();
  });
  test("slow request cannot overlap, and unmount aborts and ignores late matching response", async () => {
    const timer = clock();
    const found: string[] = [];
    let signal: AbortSignal | undefined;
    let resolve!: (snapshot: FirstTaskDispatchSnapshot) => void;
    let reads = 0;
    const stop = watchFirstTaskDispatch("ask-1", current => {
      signal = current; reads++;
      return new Promise(done => { resolve = done; });
    }, id => found.push(id), timer);
    await flush();
    expect(reads).toBe(1);
    expect(timer.pending.size).toBe(0);
    stop(); expect(signal?.aborted).toBe(true);
    resolve({ ...empty, attempts: [{ id: "late", messageId: "ask-1" }] });
    await flush();
    expect(found).toEqual([]);
    expect(timer.pending.size).toBe(0);
  });
  test("unmount clears the pending retry; previous task cannot leak a row to a new watcher", async () => {
    const timer = clock();
    const stop = watchFirstTaskDispatch("old-ask", async () => empty, () => { throw new Error("unexpected row"); }, timer);
    await flush(); expect(timer.pending.size).toBe(1);
    stop(); expect(timer.pending.size).toBe(0);
    const found: string[] = [];
    const stopNew = watchFirstTaskDispatch("new-ask", async () => ({ ...empty, attempts: [{ id: "old-row", messageId: "old-ask" }] }), id => found.push(id), timer);
    await flush(); expect(found).toEqual([]); expect(timer.pending.size).toBe(1);
    stopNew(); expect(timer.pending.size).toBe(0);
  });
});

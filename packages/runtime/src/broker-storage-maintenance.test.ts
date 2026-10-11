import { afterEach, expect, test } from "bun:test";
import { BrokerStorageMaintenance } from "./broker-storage-maintenance.js";

const services: BrokerStorageMaintenance[] = [];
afterEach(() => { for (const service of services.splice(0)) service.stop(); });
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("condition timeout"); await new Promise(resolve => setTimeout(resolve, 2)); }
}

test("maintenance drains multiple bounded turns promptly and coalesces repeated wakeups", async () => {
  let active = 0, peak = 0, pages = 0, compactions = 0;
  const service = new BrokerStorageMaintenance({ maxPagesPerTurn: 2, pageYieldMs: 1, catchUpDelayMs: 1, idleIntervalMs: 10000,
    page: async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return ++pages < 7 ? 1 : 0; },
    compact: async () => { compactions++; },
  }); services.push(service); service.start();
  for (let i = 0; i < 100; i++) service.request();
  await until(() => pages >= 7 && !service.status().running);
  expect(peak).toBe(1); expect(compactions).toBeGreaterThanOrEqual(4);
  expect(service.status().relocated).toBe(6); expect(service.status().lastError).toBeNull();
});

test("maintenance error retries without overlap and exposes failure until progress resumes", async () => {
  let attempts = 0, errors = 0, gate!: () => void;
  const wait = new Promise<void>(resolve => { gate = resolve; });
  const service = new BrokerStorageMaintenance({ retryDelayMs: 10, idleIntervalMs: 10000,
    page: async () => { attempts++; if (attempts === 1) throw new Error("archive unavailable"); await wait; return 0; },
    compact: async () => {}, onError: () => { errors++; },
  }); services.push(service); service.start();
  await until(() => errors === 1);
  expect(service.status().lastError).toBe("archive unavailable");
  await until(() => attempts === 2); gate();
  await until(() => service.status().phase === "idle");
  expect(service.status().lastError).toBeNull(); expect(attempts).toBe(2);
});

test("shutdown aborts the active page and never schedules another page or compaction", async () => {
  let pages = 0, compacted = false, aborted = false;
  const service = new BrokerStorageMaintenance({
    page: async signal => { pages++; await new Promise<void>(resolve => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true })); return 100; },
    compact: async () => { compacted = true; },
  }); services.push(service); service.start();
  await until(() => pages === 1); service.stop();
  await until(() => !service.status().running);
  expect(aborted).toBe(true); expect(compacted).toBe(false); expect(pages).toBe(1); expect(service.status().phase).toBe("stopped");
});

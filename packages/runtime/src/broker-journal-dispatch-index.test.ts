import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBackedBrokerJournal } from "./broker-journal.js";
import type { BrokerInvocationDispatchJob } from "./broker-dispatch-job.js";
import { ControlPlaneHistoryReader, ControlPlaneHistoryStore } from "./control-plane-history-store.js";
import type { FlightRecord } from "@openscout/protocol";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const job = (index: number, state: BrokerInvocationDispatchJob["state"] = "pending"): BrokerInvocationDispatchJob => ({
  id: `dispatch-i-${index}`, invocationId: `i-${index}`, flightId: `f-${index}`, targetAgentId: "agent",
  state, attempts: 1, createdAt: index, updatedAt: index,
});
async function journal(jobs: BrokerInvocationDispatchJob[]) {
  const root = await mkdtemp(join(tmpdir(), "openscout-dispatch-index-")); roots.push(root);
  const path = join(root, "broker-journal.jsonl");
  await writeFile(path, jobs.map((value) => JSON.stringify({ kind: "invocation.dispatch_job.record", job: value })).join("\n") + "\n");
  const value = new FileBackedBrokerJournal(path); await value.load();
  return { value, path };
}

test("completed lifetime history cannot starve pending work and bounded pages rotate fairly", async () => {
  const historical = Array.from({ length: 5001 }, (_, index) => job(index, "completed"));
  const pending = [job(5001), job(5002), job(5003)];
  const { value, path } = await journal([...historical, ...pending]);
  expect(value.listRecoverableInvocationDispatchJobs({ limit: 2 }).map((entry) => entry.id)).toEqual(pending.slice(0, 2).map((entry) => entry.id));
  expect(value.listRecoverableInvocationDispatchJobs({ limit: 2 }).map((entry) => entry.id)).toEqual([pending[2]!.id, pending[0]!.id]);
  expect(value.getInvocationDispatchJobForInvocation("i-0")).toEqual(historical[0]);
  expect(value.listInvocationDispatchJobs({ limit: 6000 })).toHaveLength(5004);
  const reopened = new FileBackedBrokerJournal(path); await reopened.load();
  expect(reopened.listRecoverableInvocationDispatchJobs({ limit: 5 })).toEqual(pending);
  expect(reopened.getInvocationDispatchJobForInvocation("i-0")).toEqual(historical[0]);
});

test("flight transitions refresh parked completed jobs and retain exact legacy ownership", async () => {
  const original = { ...job(1, "completed"), id: "legacy-dispatch-key" };
  const { value } = await journal([original]);
  expect(value.listRecoverableInvocationDispatchJobs()).toEqual([]);
  const flight: FlightRecord = { id: "f-1", invocationId: "i-1", requesterId: "operator", targetAgentId: "agent", state: "queued", startedAt: 1 };
  await value.appendEntries({ kind: "flight.record", flight });
  expect(value.listRecoverableInvocationDispatchJobs()).toEqual([original]);
  await value.appendEntries({ kind: "flight.record", flight: { ...flight, state: "completed", completedAt: 2 } });
  expect(value.listRecoverableInvocationDispatchJobs()).toEqual([]);
  expect(value.getInvocationDispatchJobForInvocation("i-1")).toEqual(original);
  const reassigned = { ...original, invocationId: "i-2", flightId: "f-2", state: "pending" as const };
  await value.appendEntries({ kind: "invocation.dispatch_job.record", job: reassigned });
  expect(value.getInvocationDispatchJobForInvocation("i-1")).toBeNull();
  expect(value.getInvocationDispatchJobForInvocation("i-2")).toEqual(reassigned);
  expect(value.listRecoverableInvocationDispatchJobs()).toEqual([reassigned]);
});


test("terminal dispatch history leaves the hot set only after publication and preserves original handles through compaction", async () => {
  const { path } = await journal([]);
  const directory = join(path + ".history");
  const reader = new ControlPlaneHistoryReader(directory);
  const writer = new ControlPlaneHistoryStore(directory);
  try {
    const value = new FileBackedBrokerJournal(path, { dispatchJobHistory: reader }); await value.load();
    const historical = { ...job(1, "completed"), id: "legacy-job", lastError: "full historical context 雪" };
    const mutable = job(2, "completed");
    await value.appendEntries([{ kind: "invocation.dispatch_job.record", job: historical },
      { kind: "invocation.dispatch_job.record", job: mutable }]);
    const captured = value.captureArchivableInvocationDispatchJobs({ cutoff: 10 });
    writer.publishPage(value.dispatchJobHistoricalRecords(captured));
    await value.appendEntries({ kind: "invocation.dispatch_job.record", job: { ...mutable, state: "pending", updatedAt: 3 } });
    const verified = value.revalidateArchivedInvocationDispatchJobs(captured, 10);
    expect(verified).toEqual([historical.id]);
    await value.appendEntries({ kind: "history.rotate", cutoff: 10, rotatedAt: 20, evicted: {
      messageIds: [], invocationIds: [], flightIds: [], deliveryIds: [], collaborationEventIds: [], dispatchJobIds: verified,
    } });
    expect(value.listInvocationDispatchJobs()).toHaveLength(1);
    expect(value.getInvocationDispatchJob(historical.id)).toEqual(historical);
    expect(value.getInvocationDispatchJobForInvocation(historical.invocationId)).toEqual(historical);
    expect(value.getInvocationDispatchJob(mutable.id)?.state).toBe("pending");
    const reopened = new FileBackedBrokerJournal(path, { dispatchJobHistory: reader,
      compactionPolicy: { minimumReclaimBytes: 0, minimumReclaimRatio: 0 } }); await reopened.load();
    expect(reopened.listInvocationDispatchJobs()).toHaveLength(1);
    expect(reopened.getInvocationDispatchJobForInvocation(historical.invocationId)).toEqual(historical);
    expect(await readFile(path, "utf8")).not.toContain("full historical context");
    expect(writer.read("dispatch_job", historical.id)).toEqual(historical);
  } finally { reader.close(); writer.close(); }
});

test("live flights and undelivered result replies prevent dispatch job archival", async () => {
  const { value } = await journal([job(1, "completed"), job(2, "completed"), job(3, "failed")]);
  const flight = (index: number, state: FlightRecord["state"]): FlightRecord => ({ id: `f-${index}`, invocationId: `i-${index}`,
    requesterId: "operator", targetAgentId: "agent", state, startedAt: 1 });
  await value.appendEntries([{ kind: "flight.record", flight: flight(1, "working") },
    { kind: "flight.record", flight: { ...flight(2, "completed"), metadata: { resultReply: { status: "pending" } } } }]);
  expect(value.captureArchivableInvocationDispatchJobs({ cutoff: 10 }).map(job => job.id)).toEqual(["dispatch-i-3"]);
});

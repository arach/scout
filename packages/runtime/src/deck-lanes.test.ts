import { expect, test } from 'bun:test';
import { createDeckLanes } from './deck-lanes.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture() {
  let snapshot: any = { session: { id: 'session' }, turns: [], currentTurnId: null };
  let submitted = 0;
  const output = deferred<string>();
  const dependencies = {
    getLocalAgentConfig: async () => ({ runtime: { transport: 'claude_stream_json', sessionId: 'session' } }),
    isClaudeStreamJsonAgentAlive: () => true,
    existingClaudeNativeSession: () => ({ observe: () => ({ state: 'idle' }) }),
    getClaudeStreamJsonAgentSnapshot: async () => snapshot,
    ensureClaudeStreamJsonAgentOnline: async () => {},
    interruptClaudeStreamJsonAgent: async () => {},
    startClaudeDeckTurn: async (_options: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      submitted++;
      return { output: output.promise, sessionId: 'session' };
    },
  };
  const make = () => createDeckLanes(dependencies as unknown as NonNullable<Parameters<typeof createDeckLanes>[0]>);
  return { dependencies, make, output, submitted: () => submitted,
    finish: (id: string, endedAt: number) => { snapshot = { ...snapshot, turns: [{ id, status: 'completed', endedAt, blocks: [] }] }; } };
}

for (const boundary of ['reservation', 'online', 'native-start'] as const) {
  test(`interrupt at ${boundary} fences prompt submission and records interrupted completion`, async () => {
    const f = fixture();
    const reached = deferred<void>();
    const resume = deferred<void>();
    if (boundary === 'reservation') {
      const original = f.dependencies.getLocalAgentConfig;
      let first = true;
      f.dependencies.getLocalAgentConfig = async () => {
        if (first) { first = false; reached.resolve(); await resume.promise; }
        return original();
      };
    } else if (boundary === 'online') {
      f.dependencies.ensureClaudeStreamJsonAgentOnline = async () => { reached.resolve(); await resume.promise; };
    } else {
      const original = f.dependencies.startClaudeDeckTurn;
      f.dependencies.startClaudeDeckTurn = async (options, signal) => {
        reached.resolve(); await resume.promise;
        return original(options, signal);
      };
    }
    const lanes = f.make();
    const start = lanes.start('agent', 'must not execute');
    await reached.promise;
    expect((await lanes.interrupt('agent')).accepted).toBe(true);
    resume.resolve();
    await start;
    expect(f.submitted()).toBe(0);
    expect((await lanes.snapshot('agent', false)).completion?.status).toBe('interrupted');
    // Cancellation is scoped to the reservation, not the next start.
    await lanes.start('agent', 'next');
    expect(f.submitted()).toBe(1);
    f.output.resolve('done');
  });
}

test('newer broker completion supersedes cached Deck completion', async () => {
  const f = fixture();
  const lanes = f.make();
  await lanes.start('agent', 'A');
  f.finish('A', 100);
  f.output.resolve('A output');
  // Await the detached completion capture deterministically through snapshots.
  for (let i = 0; i < 10; i++) {
    if ((await lanes.snapshot('agent', false)).completion?.text === 'A output') break;
  }
  expect((await lanes.snapshot('agent', false)).completion?.text).toBe('A output');
  f.finish('B', 200);
  expect((await lanes.snapshot('agent', false)).completion?.turnId).toBe('B');
  f.finish('older', 50);
  expect((await lanes.snapshot('agent', false)).completion?.turnId).toBe('A');
});

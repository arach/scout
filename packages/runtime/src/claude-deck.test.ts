import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectClaudeDeck, startClaudeDeckTurn, interruptClaudeStreamJsonAgent, shutdownClaudeStreamJsonAgent } from './claude-stream-json.js';

test('Claude Deck connects without a prompt, rejects overlapping turns, captures text and interrupts the real process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scout-deck-'));
  const prior = process.env.OPENSCOUT_CLAUDE_BIN;
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env bun
import readline from 'node:readline';
process.on('SIGINT', () => process.exit(130));
console.log(JSON.stringify({type:'system',subtype:'init',session_id:'deck-test'}));
for await (const line of readline.createInterface({input:process.stdin})) {
 const text=JSON.parse(line).message.content;
 if(text==='long') await new Promise(r=>setTimeout(r,10000));
 else await new Promise(r=>setTimeout(r,100));
 console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'final '+text}]}}));
 console.log(JSON.stringify({type:'result',result:'final '+text}));
}
`);
  chmodSync(bin, 0o755);
  process.env.OPENSCOUT_CLAUDE_BIN = bin;
  const options = { agentName: 'deck-test', sessionId: 'deck-test', cwd: dir, systemPrompt: 'test', runtimeDirectory: join(dir, 'runtime'), logsDirectory: join(dir, 'logs'), launchArgs: [] };
  try {
    await connectClaudeDeck(options);
    const cancelled = new AbortController();
    const pending = startClaudeDeckTurn({ ...options, prompt: 'cancelled' }, cancelled.signal);
    cancelled.abort();
    await expect(pending).rejects.toThrow();
    const first = await startClaudeDeckTurn({ ...options, prompt: 'hello' });
    await expect(startClaudeDeckTurn({ ...options, prompt: 'overlap' })).rejects.toThrow('active or queued');
    expect(await first.output).toBe('final hello');
    const long = await startClaudeDeckTurn({ ...options, prompt: 'long' });
    const rejected = long.output.then(() => false, () => true);
    await interruptClaudeStreamJsonAgent(options);
    expect(await rejected).toBe(true);
  } finally {
    await shutdownClaudeStreamJsonAgent(options);
    if (prior === undefined) delete process.env.OPENSCOUT_CLAUDE_BIN; else process.env.OPENSCOUT_CLAUDE_BIN = prior;
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);

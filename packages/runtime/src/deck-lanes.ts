import {
  connectCodexDeckThread, getCodexDeckThreadSnapshot, getLocalAgentConfig,
  isCodexDeckThreadConnected, startCodexDeckTurn, steerCodexDeckTurn, interruptCodexDeckTurn,
} from './local-agents.js';
import {
  existingClaudeNativeSession, connectClaudeDeck, ensureClaudeStreamJsonAgentOnline, getClaudeStreamJsonAgentSnapshot,
  startClaudeDeckTurn, interruptClaudeStreamJsonAgent, isClaudeStreamJsonAgentAlive,
} from './claude-stream-json.js';
import { relayAgentLogsDirectory, relayAgentRuntimeDirectory } from './support-paths.js';
import type { SessionState } from '@openscout/agent-sessions';
type DeckLaneCapabilities = { send: boolean; steer: boolean; steerMode: 'native' | 'follow_up' | 'unsupported'; queue: boolean; interrupt: boolean; attachments: boolean; approvals: boolean; history: boolean };
type CodexDeckThreadSnapshot = { adapter: string; agentId: string; threadId: string | null; turnId: string | null; state: 'running' | 'idle' | 'disconnected'; phase: 'idle' | 'working' | 'awaiting_approval' | 'offline'; pendingApproval: { id: string; title: string; detail: string } | null; completion: { turnId: string; status: string; endedAt: number | null; text: string } | null; capabilities: { connect: boolean; start: boolean; steer: boolean; interrupt: boolean; queue: false; approvals: false }; capabilityNotes: { queue: string; approvals: string }; snapshot: SessionState | null };

export function deckLaneCapabilities(transport: string | null | undefined): DeckLaneCapabilities {
  const codex = transport === 'codex_app_server';
  const claude = transport === 'claude_stream_json';
  return { send: codex || claude, steer: codex, steerMode: codex ? 'native' : 'unsupported',
    queue: false, interrupt: codex || claude, attachments: false, approvals: false, history: codex || claude };
}

const defaultDependencies = {
  getLocalAgentConfig, connectCodexDeckThread, getCodexDeckThreadSnapshot, isCodexDeckThreadConnected,
  startCodexDeckTurn, steerCodexDeckTurn, interruptCodexDeckTurn, existingClaudeNativeSession,
  connectClaudeDeck, ensureClaudeStreamJsonAgentOnline, getClaudeStreamJsonAgentSnapshot,
  startClaudeDeckTurn, interruptClaudeStreamJsonAgent, isClaudeStreamJsonAgentAlive,
};

export function createDeckLanes(dependencies = defaultDependencies) {
  const {
    getLocalAgentConfig, connectCodexDeckThread, getCodexDeckThreadSnapshot, isCodexDeckThreadConnected,
    startCodexDeckTurn, steerCodexDeckTurn, interruptCodexDeckTurn, existingClaudeNativeSession,
    connectClaudeDeck, ensureClaudeStreamJsonAgentOnline, getClaudeStreamJsonAgentSnapshot,
    startClaudeDeckTurn, interruptClaudeStreamJsonAgent, isClaudeStreamJsonAgentAlive,
  } = dependencies;
  async function lane(agentId: string) {
    const config = await getLocalAgentConfig(agentId);
    if (!config) throw new Error(`Agent ${agentId} is not configured on this host.`);
    if (!deckLaneCapabilities(config.runtime.transport).send) throw new Error(`Unsupported Deck transport: ${config.runtime.transport}`);
    return { config, options: { agentName: agentId, sessionId: config.runtime.sessionId,
      cwd: config.runtime.cwd, systemPrompt: config.systemPrompt, launchArgs: config.launchArgs,
      runtimeDirectory: relayAgentRuntimeDirectory(agentId), logsDirectory: relayAgentLogsDirectory(agentId) } };
  }

  // Reserve before any await that can spawn or write. Never silently queue a start.
  const interrupted = new Set<string>();
  const starting = new Set<string>();
  const cancellations = new Map<string, AbortController>();
  const ended = new Map<string, NonNullable<CodexDeckThreadSnapshot["completion"]>>();
  return {
    async snapshot(agentId: string, connect: boolean): Promise<CodexDeckThreadSnapshot> {
      const { config, options } = await lane(agentId);
      const codex = config.runtime.transport === 'codex_app_server';
      const connected = connect ? codex ? await connectCodexDeckThread(agentId)
        : await connectClaudeDeck(options).then(() => ({ sessionId: options.sessionId })) : null;
      const online = codex ? Boolean(connected) || await isCodexDeckThreadConnected(agentId)
        : isClaudeStreamJsonAgentAlive(options);
      const snapshot = codex ? await getCodexDeckThreadSnapshot(agentId) : await getClaudeStreamJsonAgentSnapshot(options);
      const turn = snapshot?.turns.find(t => t.id === snapshot.currentTurnId);
      const native = codex ? null : existingClaudeNativeSession(agentId, options.sessionId)?.observe();
      const running = codex ? Boolean(turn && !['completed', 'interrupted', 'error'].includes(turn.status)) : native?.state === 'active';
      const pending = running ? turn?.blocks.find(b => (b.block.type === 'action' && b.block.action.status === 'awaiting_approval') || (b.block.type === 'question' && b.block.questionStatus === 'awaiting_answer')) : undefined;
      const last = snapshot?.turns.filter(t => ['completed', 'interrupted', 'error'].includes(t.status)).at(-1);
      const cached = ended.get(agentId);
      // Same-turn cache retains Deck interrupt classification. A newer native turn
      // must supersede it, including turns submitted outside Deck.
      const completion = last && (!cached || (last.id !== cached.turnId
        && (last.endedAt ?? 0) >= (cached.endedAt ?? 0)))
        ? { turnId: last.id, status: last.status, endedAt: last.endedAt ?? null,
            text: last.blocks.filter(b => b.block.type === 'text').map(b => b.block.type === 'text' ? b.block.text : '').join('\n') }
        : cached ?? null;
      const nativeId = snapshot?.session.providerMeta?.threadId;
      return { adapter: config.runtime.transport, agentId,
        threadId: typeof nativeId === 'string' ? nativeId : snapshot?.session.id ?? null,
        turnId: online && running ? turn?.id ?? null : null,
        state: online ? running || starting.has(agentId) ? 'running' : 'idle' : 'disconnected',
        phase: !online ? 'offline' : pending ? 'awaiting_approval' : running || starting.has(agentId) ? 'working' : 'idle',
        pendingApproval: pending ? { id: pending.block.id, title: pending.block.type === 'question' ? pending.block.header ?? 'Approval required' : 'Approval required', detail: pending.block.type === 'question' ? pending.block.question : pending.block.type === 'action' ? pending.block.action.output : '' } : null,
        completion,
        capabilities: { connect: true, start: true, steer: codex, interrupt: true, queue: false, approvals: false },
        capabilityNotes: { queue: 'No Deck queue; start rejects an active turn.', approvals: 'Approval is observable, not actionable from Deck.' }, snapshot };
    },
    async start(agentId: string, text: string) {
      if (!text.trim()) throw new Error('A non-empty turn prompt is required.');
      if (starting.has(agentId)) throw new Error('Lane already has an active Deck turn.');
      starting.add(agentId);
      const cancellation = new AbortController();
      cancellations.set(agentId, cancellation);
      interrupted.delete(agentId);
      let detached = false;
      try {
        const { config, options } = await lane(agentId);
        if (config.runtime.transport === 'codex_app_server') return await startCodexDeckTurn(agentId, text);
        const state = await this.snapshot(agentId, false);
        if (state.turnId) throw new Error('Lane already has an active turn.');
        await ensureClaudeStreamJsonAgentOnline(options);
        // Invoke owns completion and logs in the shared runtime, not this surface.
        cancellation.signal.throwIfAborted();
        const started = await startClaudeDeckTurn({ ...options, prompt: text }, cancellation.signal);
        ended.delete(agentId);
        detached = true;
        void started.output.then(async result => {
          const snap = await getClaudeStreamJsonAgentSnapshot(options);
          ended.set(agentId, { turnId: snap?.turns.at(-1)?.id ?? crypto.randomUUID(), status: interrupted.delete(agentId) ? 'interrupted' : 'completed', endedAt: snap?.turns.at(-1)?.endedAt ?? Date.now(), text: result });
        }, async error => {
          const snap = await getClaudeStreamJsonAgentSnapshot(options);
          const last = snap?.turns.at(-1);
          ended.set(agentId, { turnId: last?.id ?? crypto.randomUUID(), status: interrupted.delete(agentId) ? 'interrupted' : 'error', endedAt: last?.endedAt ?? Date.now(), text: last?.blocks.filter(b => b.block.type === 'text').map(b => b.block.type === 'text' ? b.block.text : '').join('\n') ?? '' });
          console.error(`[deck] ${agentId} turn ended:`, error);
        }).catch(error => console.error('[deck] completion capture failed:', error)).finally(() => { starting.delete(agentId); cancellations.delete(agentId); });
        return { accepted: true, agentId, threadId: state.threadId, mode: 'start' as const };
      } catch (error) {
        if (!cancellation.signal.aborted) throw error;
        ended.set(agentId, { turnId: crypto.randomUUID(), status: 'interrupted', endedAt: Date.now(), text: '' });
        return { accepted: true, agentId, threadId: null, mode: 'start' as const };
      } finally {
        // Claude reservation is held until completion; Codex has a native conflict guard.
        if (!detached) { starting.delete(agentId); cancellations.delete(agentId); }
      }
    },
    async steer(agentId: string, text: string) {
      const { config } = await lane(agentId);
      if (config.runtime.transport !== 'codex_app_server') throw new Error('This lane has no native mid-turn steer; wait for idle and start a follow-up turn.');
      return steerCodexDeckTurn(agentId, text);
    },
    async interrupt(agentId: string) {
      const { config, options } = await lane(agentId);
      if (config.runtime.transport === 'codex_app_server') return interruptCodexDeckTurn(agentId);
      const state = await this.snapshot(agentId, false);
      if (!state.turnId && !starting.has(agentId)) throw new Error('Lane has no active turn to interrupt.');
      interrupted.add(agentId);
      cancellations.get(agentId)?.abort();
      await interruptClaudeStreamJsonAgent(options);
      return { accepted: true, agentId, threadId: state.threadId, mode: 'interrupt' as const };
    },
  };

}

export const deckLanes = createDeckLanes();

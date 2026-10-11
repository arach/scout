import { requestScoutBrokerJson } from '@openscout/runtime/broker-api';
import { resolveBrokerServiceConfig } from '@openscout/runtime/broker-process-manager';
import type { CodexDeckThreadSnapshot, DeckLaneCapabilities } from '../../client/surface-contract/scout-surface-contract.ts';
export function deckLaneCapabilities(transport: string | null | undefined): DeckLaneCapabilities {
  const codex = transport === 'codex_app_server', claude = transport === 'claude_stream_json';
  return { send: codex || claude, steer: codex, steerMode: codex ? 'native' : 'unsupported', queue: false,
    interrupt: codex || claude, attachments: false, approvals: false, history: codex || claude };
}
async function call<T>(action: string, agentId: string, text?: string, connect?: boolean): Promise<T> {
  const { brokerUrl } = resolveBrokerServiceConfig();
  return requestScoutBrokerJson<T>(brokerUrl, '/v1/surfaces/deck', { method: 'POST', body: { action, agentId, text, connect } });
}
export const deckLanes = {
  snapshot: (agentId: string, connect: boolean) => call<CodexDeckThreadSnapshot>('snapshot', agentId, undefined, connect),
  start: (agentId: string, text: string) => call('start', agentId, text),
  steer: (agentId: string, text: string) => call('steer', agentId, text),
  interrupt: (agentId: string) => call('interrupt', agentId),
};

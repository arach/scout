import { principalSchema } from "./identity.ts";
import { labelBrief, labelFeed, matchingLabelWorks } from "./label-views.ts";
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { diagnoseAgentIdentity, parseAgentIdentity, namedChannelNaturalKey, systemChannelNaturalKey, stableChannelId, parseScoutComposerRouteTarget, parseScoutRuntimeSpec, SCOUT_MCP_CORE_TOOL_NAMES, type McpEventPrincipal } from '@openscout/protocol';
import definitions from './core-tools.json';
import { RuntimeHttpClient } from './http-client.ts';

const tools = definitions as unknown as Tool[];
const validators = new AjvJsonSchemaValidator();
const values = (input: any): any[] => Array.isArray(input) ? input : Object.values(input ?? {});
const pick = (input: Record<string, any>, names: string[]) => Object.fromEntries(names.filter(k => input[k] !== undefined).map(k => [k, input[k]]));
function channelIdentity(name: string) {
  const normalized = name.trim().toLowerCase().replace(/^channel\./, '').replace(/[^a-z0-9_.-]+/g, '-');
  const channel = normalized === 'shared' ? 'broadcast' : normalized;
  const naturalKey = channel === 'system' ? systemChannelNaturalKey(channel) : namedChannelNaturalKey(channel);
  return { channel, naturalKey, id: stableChannelId(naturalKey) };
}
const query = (path: string, input: Record<string, any>) => {
  const q = new URLSearchParams(); for (const [k,v] of Object.entries(input)) if (v !== undefined && v !== null) {
    for (const item of Array.isArray(v) ? v : [v]) q.append(k, String(item));
  }
  return `${path}?${q}`;
};
export function selectCoreTools(selection: 'core' | readonly string[] = 'core'): Tool[] {
  const names = selection === 'core' ? [...SCOUT_MCP_CORE_TOOL_NAMES] : [...selection];
  const unsupported = names.filter(name => !SCOUT_MCP_CORE_TOOL_NAMES.includes(name as never));
  if (!names.length || unsupported.length) throw new Error(`unsupported bridge tools: ${unsupported.join(', ') || '(empty list)'}`);
  return [...new Set(names)].map(name => tools.find(t => t.name === name)!);
}
export class CoreHttpAdapter {
  readonly tools: Tool[];
  constructor(readonly options: { client: RuntimeHttpClient; principal: McpEventPrincipal; tools?: 'core' | readonly string[]; currentDirectory?: string; replyContext?: Record<string, unknown>; diagnosticsIdentityVerified?: boolean }) {
    this.tools = selectCoreTools(options.tools);
    principalSchema.parse(options.principal);
  }
  async call(name: string, input: unknown = {}, signal?: AbortSignal): Promise<any> {
    const tool = this.tools.find(t => t.name === name); if (!tool) throw new Error(`unsupported bridge tool: ${name}`);
    const checked = validators.getValidator<Record<string, any>>(tool.inputSchema as never)(input);
    if (!checked.valid) throw new Error(`invalid arguments for ${name}`);
    const a = { ...checked.data };const p = this.options.principal; const senderId = p.agentId;
    if (a.senderId !== undefined && a.senderId !== senderId) throw new Error('sender identity is pinned to the relay principal');
    const currentDirectory = a.currentDirectory ?? this.options.currentDirectory ?? '/';
    const request = (path: string, body?: unknown) => this.options.client.request(path, body, signal);
    const snapshot = () => request('/v1/snapshot');
    const context = { currentDirectory, brokerUrl: this.options.client.origin, senderId };
    if (name.startsWith('sessions_')) return request(`/v1/external-sessions/${name.slice(9)}`, { ...a, ownerId: senderId });
    if (name === 'whoami') return { ...context, defaultSenderId: senderId };
    if (name === 'current_reply_context') return { active: !!this.options.replyContext, context: this.options.replyContext ?? null };
    if (name === 'feedback_send') {
      // Provenance is constructor state from the authenticated envelope, never a tool argument.
      const saved = await request('/v1/mesh/bridge/feedback/collect', { message: a.note, diagnostics: a.diagnostics === true && this.options.diagnosticsIdentityVerified !== false, principal: p });
      if (a.localOnly) return saved;
      try { return { ...saved, ...await request('/v1/mesh/bridge/feedback/upload', { id: saved.id, principal: p }) }; }
      catch { return saved; } // A failed upload never switches to local-operator provenance.
    }
    if (name === 'tail_events') return { ...context, ...await request(query('/v1/tail/recent', { limit: a.limit ?? 80, ...pick(a, ['sources','kinds','sessionId','project','cwd','query']), transcripts: a.transcripts ? '1' : '0' })) };
    if (name === 'broker_feed') return { ...context, ...await request(query('/v1/broker/messages', { agentId: a.agentId ?? senderId, ...pick(a,['since','limit']), includeAcknowledged: a.includeAcknowledged ? '1' : undefined })) };
    if (name === 'messages_inbox' || name === 'messages_channel') {
      const filter = name === 'messages_inbox' ? { participantId: senderId, inboxOnly: '1' } : { conversationId: channelIdentity(a.channel ?? 'shared').id };
      const messages = await request(query('/v1/messages', { ...filter, limit: a.limit ?? 20, since: a.since }));
      return { ...context, ...filter, limit: a.limit ?? 20, since: a.since ?? null, messages };
    }
    if (name === 'agents_search' || name === 'agents_resolve') {
      const s = await snapshot();const agents = values(s.agents).map(agent => ({ ...agent, agentId: agent.id }));
      const term = String(a.query ?? a.label ?? '').trim().replace(/^@/, '').toLowerCase();
      let candidates = agents.filter(v => [v.id,v.name,v.label,v.displayName,v.handle,v.selector].some(s => typeof s === 'string' && (name === 'agents_resolve' ? s.replace(/^@/,'').toLowerCase() === term : s.toLowerCase().includes(term))));
      let kind = candidates.length === 1 ? 'resolved' : candidates.length ? 'ambiguous' : 'unresolved';
      if (name === 'agents_resolve') {
        const identity = parseAgentIdentity(a.label);
        if (identity) {
          const identities = agents.map(agent => ({ ...agent, agentId: agent.id, definitionId: agent.definitionId ?? agent.id,
            aliases: [agent.name,agent.displayName,agent.selector,agent.handle].filter(Boolean),
            profile: agent.metadata?.profile ?? agent.profile, model: agent.metadata?.model ?? agent.model, harness: agent.metadata?.harness ?? agent.harness }));
          const diagnosis = diagnoseAgentIdentity(identity, identities);
          if (diagnosis.kind === 'resolved') { candidates = [diagnosis.match];kind = 'resolved'; }
          else if (diagnosis.kind === 'ambiguous') { candidates = diagnosis.candidates;kind = 'ambiguous'; }
        }
      }
      candidates = candidates.slice(0, a.limit ?? 50);
      return name === 'agents_search' ? { ...context, query: term, candidates } : { ...context, label: a.label, kind, candidate: kind === 'resolved' ? candidates[0] : null, candidates };
    }

    if (name === 'invocations_get' || name === 'invocations_wait') {
      const deadline = Date.now() + (name === 'invocations_wait' ? (a.timeoutSeconds ?? 30) * 1000 : 0);
      let flight: any, lifecycle: any;
      do {
        const s = await snapshot();flight = values(s.flights).find(v => v.id === a.flightId);
        if (!flight || ['completed','failed','cancelled'].includes(flight.state) || Date.now() >= deadline) break;
        await delay(Math.min(500, deadline - Date.now()), undefined, { signal });
      } while (true);
      if (flight?.invocationId) lifecycle = await request(`/v1/invocations/${encodeURIComponent(flight.invocationId)}/lifecycle`);
      return { ...context, flightId: a.flightId, found: !!flight, flight: flight ?? null, lifecycle: lifecycle ?? null, waitStatus: name === 'invocations_get' ? 'not_requested' : flight && ['completed','failed','cancelled'].includes(flight.state) ? 'completed' : 'timed_out' };
    }
    if (name === 'labels_brief' || name === 'labels_feed') {
      const s = await snapshot();
      if (name === 'labels_brief') return { ...context, ...labelBrief(s,a.label) };
      const ids = matchingLabelWorks(s,a.label).map(v => v.id).slice(0,128);
      const events = [];
      for (const recordId of ids) events.push(...values(await request(query('/v1/collaboration/events', { recordId, limit: a.limit ?? 100 }))));
      return { ...context, ...labelFeed(s,a.label,events,a.since,a.limit) };
    }

    if (name === 'work_update') {
      const s = await snapshot();const previous = values(s.collaborationRecords).find(v => v.kind === 'work_item' && v.id === a.work.workId);
      if (!previous) throw new Error('unknown work item');
      const now = Date.now(), state = a.work.state ?? previous.state;
      const updated = { ...previous, waitingOn: a.work.waitingOn === undefined ? state === 'waiting' ? previous.waitingOn : undefined : a.work.waitingOn, ...pick(a.work, ['title','summary','state','acceptanceState','ownerId','nextMoveOwnerId','priority','labels','waitingOn','progress']), updatedAt: now,
        metadata: { ...previous.metadata, ...a.work.metadata }, ...(state === 'working' ? { startedAt: previous.startedAt ?? now } : {}),
        ...(state === 'review' ? { reviewRequestedAt: previous.reviewRequestedAt ?? now } : {}),
        ...(['done','cancelled'].includes(state) ? { completedAt: previous.completedAt ?? now } : {}) };
      await request('/v1/collaboration/records', updated);
      await request('/v1/collaboration/events', { id: `evt.${randomUUID()}`, recordId: updated.id, recordKind: 'work_item', kind: updated.acceptanceState !== previous.acceptanceState && ['accepted','reopened'].includes(updated.acceptanceState) ? updated.acceptanceState : state !== previous.state ? ({ waiting: 'waiting', review: 'review_requested', done: 'done', cancelled: 'cancelled', working: previous.state === 'open' ? 'claimed' : 'progressed' } as Record<string,string>)[state] ?? 'progressed' : updated.ownerId !== previous.ownerId || updated.nextMoveOwnerId !== previous.nextMoveOwnerId ? 'handoff' : 'progressed', actorId: senderId, at: now, summary: a.work.eventSummary ?? updated.summary ?? updated.title, metadata: { source: 'scout-mesh-http' } });
      return { ...context, usedBroker: true, workItem: updated, workId: updated.id };
    }
    if (name === 'messages_reply') {
      const reply = { ...pick(this.options.replyContext ?? {}, ['conversationId','replyToMessageId']), ...pick(a, ['requestId','body','conversationId','replyToMessageId','shouldSpeak','attachments','completion']) };
      if (!reply.conversationId || !reply.replyToMessageId) throw new Error('reply requires an exact conversation and message context');
      const s = await snapshot();
      const conversation = values(s.conversations).find(v => v.id === reply.conversationId);
      const original = values(s.messages).find(v => v.id === reply.replyToMessageId);
      if (!conversation || !original || original.conversationId !== conversation.id) throw new Error('reply target does not match conversation');
      if (!conversation.participantIds?.includes(senderId)) throw new Error('sender is not a conversation participant');
      const node = await request('/v1/node');
      const id = a.requestId ? `msg.request.${createHash('sha256').update(JSON.stringify([senderId,a.requestId])).digest('hex')}` : `msg.${randomUUID()}`;
      return request(a.completion ? '/v1/messages/reply' : '/v1/messages', {
        id, ...pick(reply,['requestId','body','conversationId','replyToMessageId','attachments']), actorId: senderId,
        originNodeId: node.nodeId ?? node.id, class: conversation.kind === 'system' ? 'system' : 'agent', visibility: conversation.visibility, policy: 'durable', createdAt: Date.now(),
        ...(original.actorId !== senderId ? { audience: { notify: [original.actorId], reason: 'thread_reply' } } : {}),
        ...(a.shouldSpeak ? { speech: { text: a.body } } : {}),
        metadata: { source: 'scout-mesh-http', ...(a.completion ? { completionReply: a.completion } : {}) },
      });
    }
    if (name === 'ask' || name === 'messages_send' || name === 'notify_operator' || name === 'consult_operator') {
      const isAsk = name === 'ask' || name === 'messages_send' && a.interaction === 'work', operator = name === 'notify_operator' || name === 'consult_operator';
      const mentions = [...new Set<string>(a.mentionAgentIds ?? [])];
      if (mentions.length > 1 && isAsk) throw new Error('owned-work messages require one explicit target');
      if (mentions.length > 1 && !a.channel) throw new Error('multiple targets require an explicit channel');
      if (mentions.length && a.channel && name === 'messages_send' && !isAsk) {
        const s = await snapshot();
        if (mentions.some(id => !values(s.agents).some(v => v.id === id))) throw new Error('unknown exact group target');
        const channel = channelIdentity(a.channel);const previous = values(s.conversations).find(v => v.id === channel.id);
        const node = await request('/v1/node');
        const participants = [...new Set<string>([...(previous?.participantIds ?? []), senderId, 'operator', ...mentions])].sort();
        const conversation = { ...previous, id: channel.id, kind: channel.channel === 'system' ? 'system' : 'channel', title: channel.channel,
          authorityNodeId: previous?.authorityNodeId ?? node.nodeId ?? node.id, visibility: previous?.visibility ?? 'workspace', shareMode: previous?.shareMode ?? 'local',
          participantIds: participants, metadata: { ...previous?.metadata, naturalKey: channel.naturalKey, channel: channel.channel } };
        await request('/v1/conversations', conversation);
        const id = a.requestId ? `msg.request.${createHash('sha256').update(JSON.stringify([senderId,a.requestId])).digest('hex')}` : `msg.${randomUUID()}`;
        await request('/v1/messages', { id, ...pick(a,['requestId','body']), conversationId: channel.id, actorId: senderId,
          originNodeId: node.nodeId ?? node.id, class: 'agent', visibility: conversation.visibility, policy: 'durable', createdAt: Date.now(),
          mentions: mentions.map(actorId => ({ actorId, label: actorId })), audience: { notify: mentions, reason: 'mention' },
          metadata: { source: 'scout-mesh-http', relayTargetIds: mentions, relayMessageId: id } });
        return { ...context, usedBroker: true, conversationId: channel.id, messageId: id, invokedTargetIds: mentions, unresolvedTargetIds: [] };
      }
      if (mentions.length === 1 && !a.targetAgentId) a.targetAgentId = mentions[0];
      if (a.profile && !a.projectPath) { if (!this.options.currentDirectory || this.options.currentDirectory === '/') throw new Error('profile requires an explicit projectPath');a.projectPath = this.options.currentDirectory; }
      if (a.on && (!a.projectPath || a.to || a.targetSessionId || a.profile)) throw new Error('on requires projectPath and cannot combine with an exact target or profile');
      let target = operator ? { kind: 'agent_id', agentId: 'operator' } : a.targetAgentId ? { kind: 'agent_id', agentId: a.targetAgentId }
        : a.targetSessionId ? { kind: 'session_id', sessionId: a.targetSessionId }
        : a.projectPath ? { kind: 'project_path', projectPath: a.projectPath, ...(a.on ? { host: a.on } : {}) }
        : parseScoutComposerRouteTarget(a.to ?? a.targetLabel ?? (a.channel ? `channel:${a.channel}` : ''));
      if (a.profile && a.projectPath) target = { kind: 'runtime_profile', profile: a.profile, projectPath: a.projectPath };
      if (!target) throw new Error('one explicit target or project is required');
      if ((a.completion || a.relation) && (!a.requestId || !['agent_id','session_id'].includes(target.kind))) throw new Error('completion requires requestId and an exact target');
      let execution = pick(a,['harness','model','reasoningEffort','placement']);
      if (a.runtime) {
        const spec = parseScoutRuntimeSpec(a.runtime);if (!spec.ok) throw new Error('invalid runtime specification');
        for (const [key,value] of Object.entries(spec.value)) if (execution[key] !== undefined && execution[key] !== value) throw new Error(`conflicting runtime field ${key}`);
        execution = { ...spec.value, ...execution };
      }
      if (target.kind === 'session_id') a.targetSessionId = target.sessionId;
      const body = name === 'consult_operator' ? `${a.question}\n\nDefault if there is no reply: ${a.defaultAction}` : operator ? a.message : a.body;
      if (target.kind === 'route_alias' && (a.aliasProject || a.aliasHost)) target = { ...target, scope: { ...(a.aliasProject ? { projectRoot: a.aliasProject } : {}), ...(a.aliasHost ? { authorityNodeId: a.aliasHost } : {}) } } as typeof target;
      const intent = isAsk ? a.completion || a.relation ? 'explicit_consult' : 'consult' : 'tell';
      const workRecordId = a.workItem ? a.requestId ? `work-request-${createHash('sha256').update(JSON.stringify([senderId,a.requestId])).digest('hex')}` : `work.${randomUUID()}` : undefined;
      const metadata = { source: 'scout-mesh-http', ...(a.workspace ? { askWorkspace: a.workspace } : {}),
        ...(workRecordId ? { collaborationRecordId: workRecordId, workId: workRecordId } : {}),
        ...(a.labels ? { labels: a.labels } : {}), ...(a.replyToSessionId ? { replyToSessionId: a.replyToSessionId } : {}),
        replyMode: a.wait ? 'inline' : a.replyMode ?? 'notify', senderContext: { agentId: senderId, cwd: currentDirectory } };
      const result = await request('/v1/deliver', { caller: { actorId: senderId, currentDirectory, metadata: { source: 'scout-mesh-http' } }, target, body, intent,
        ...pick(a,['requestId','completion','relation','targetSessionId','replyToSessionId','traceparent','labels','channel']),
        ...(isAsk ? { execution: { ...execution, session: a.targetSessionId ? 'existing' : 'new' } } : {}), ...(operator ? {} : { ensureAwake: isAsk || a.wake === true }), ...(a.shouldSpeak ? { speechText: body } : {}),
        ...(a.workItem ? { collaborationRecordId: workRecordId, workItem: { id: workRecordId, ...a.workItem } } : {}),
        messageMetadata: isAsk ? metadata : { source: 'scout-mesh-http' }, ...(isAsk ? { invocationMetadata: metadata } : {}),
        ...(name === 'notify_operator' ? { operatorSignal: { kind: 'notify', blocking: false, replyExpectation: 'none' } } : {}),
        ...(name === 'consult_operator' ? { operatorSignal: { kind: 'consult', blocking: false, replyExpectation: 'optional', defaultAction: a.defaultAction } } : {}),
      });
      const flightId = result.flight?.id ?? result.flightId;
      const inline = isAsk && (a.wait || a.replyMode === 'inline') && flightId ? await this.call('invocations_wait', { flightId, timeoutSeconds: a.timeoutSeconds ?? 30 }, signal) : undefined;
      return { ...context, ...result, ...(inline ? { flight: inline.flight, waitStatus: inline.waitStatus } : {}), flightId,
        ids: { flightId, invocationId: result.flight?.invocationId ?? result.invocationId, messageId: result.message?.id ?? result.messageId, conversationId: result.conversation?.id ?? result.conversationId }, usedBroker: true };
    }
    throw new Error(`unsupported bridge tool: ${name}`);
  }
  server() {
    const server = new Server({ name: 'scout-mesh', version: '0.3.9' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.tools }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try { const result = await this.call(request.params.name, request.params.arguments, extra.signal);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result && typeof result === 'object' && !Array.isArray(result) ? result : { result } }; }
      catch { return { isError: true, content: [{ type: 'text', text: `Scout tool ${request.params.name} failed; check arguments, consent and runtime availability.` }] }; }
    });
    return server;
  }
}

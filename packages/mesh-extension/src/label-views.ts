// Pure projections of HTTP snapshots, never a runtime store or transcript reader.
const values = (v: any): any[] => Array.isArray(v) ? v : Object.values(v ?? {});
const labels = (v: any): string[] => [...new Set<string>([...(v?.labels ?? []), ...(v?.metadata?.labels ?? [])].filter((s: unknown) => typeof s === 'string').map((s: string) => s.trim()))];
const workId = (v: any) => v?.metadata?.workRecordId ?? v?.metadata?.workItemId ?? v?.collaborationRecordId ?? v?.workId;
export const matchingLabelWorks = (s: any, label: string): any[] => values(s.collaborationRecords).filter(v => v.kind === 'work_item' && labels(v).includes(label.trim()));
const at = (v: any) => v.updatedAt ?? v.completedAt ?? v.lastActivityAt ?? v.startedAt ?? v.createdAt ?? 0;
export function labelBrief(s: any, label: string, maximum = 12) {
  label = label.trim();const works = matchingLabelWorks(s,label), ids = new Set(works.map(v => v.id));const people = new Set<string>();
  const flights = values(s.flights).flatMap(f => {
    const i = s.invocations?.[f.invocationId];const work = workId(f) ?? workId(i);const ls = [...new Set([...labels(f),...labels(i)])];
    if (!ls.includes(label) && !ids.has(work)) return [];
    for (const p of [f.requesterId,f.targetAgentId]) if (p) people.add(p);
    return [{ ...f, labels: ls, lastActivityAt: Math.max(at(f),at(i ?? {})), workId: work ?? null,
      conversationId: f.conversationId ?? i?.conversationId ?? f.metadata?.conversationId ?? null, messageId: f.messageId ?? i?.messageId ?? null,
      summary: f.summary ?? null, output: f.output ?? null, error: f.error ?? null, startedAt: f.startedAt ?? null, completedAt: f.completedAt ?? null }];
  }).sort((a,b) => b.lastActivityAt-a.lastActivityAt);
  const workItems = works.map(w => { for (const p of [w.ownerId,w.nextMoveOwnerId]) if (p) people.add(p);return { ...w, summary: w.summary ?? null, ownerId: w.ownerId ?? null, nextMoveOwnerId: w.nextMoveOwnerId ?? null }; }).sort((a,b) => b.updatedAt-a.updatedAt);
  const active = flights.filter(v => !['completed','failed','cancelled'].includes(v.state));const counts: Record<string,number> = {};
  for (const flight of flights) counts[flight.state] = (counts[flight.state] ?? 0) + 1;
  return { label, generatedAt: Date.now(), lastActivityAt: Math.max(0,...flights.map(at),...works.map(at)) || null,
    participants: [...people].sort(), counts: { flights: flights.length, activeFlights: active.length, workItems: works.length },
    flightsByState: counts, activeFlights: active.slice(0,maximum), recentFlights: flights.slice(0,maximum), workItems: workItems.slice(0,maximum) };
}
export function labelFeed(s: any, label: string, collaborationEvents: any[], since?: number, limit = 100) {
  label = label.trim();const works = matchingLabelWorks(s,label), ids = new Set(works.map(v => v.id));const events: any[] = [];
  const push = (e: any) => events.push({ label, actorId: null, targetAgentId: null, conversationId: null, messageId: null, invocationId: null, flightId: null, workId: null, state: null, eventKind: null, ...e, labels: [...new Set([label,...labels(e)])] });
  for (const m of values(s.messages)) if (labels(m).includes(label) || ids.has(workId(m))) push({ id: `message:${m.id}`, at: m.createdAt, kind: 'message', category: 'message', actorId: m.actorId, conversationId: m.conversationId, messageId: m.id, workId: workId(m) ?? null, summary: m.body });
  for (const f of labelBrief(s,label,Number.MAX_SAFE_INTEGER).recentFlights) {
    if (f.startedAt) push({ id: `flight:${f.id}:started:${f.startedAt}`, at: f.startedAt, kind: 'flight_started', category: 'flight', flightId: f.id, invocationId: f.invocationId, summary: f.summary, state: f.state, labels: f.labels });
    push({ id: `flight:${f.id}:state:${f.state}:${at(f)}`, at: at(f), kind: f.completedAt ? `flight_${f.state}` : 'flight_state', category: 'flight', flightId: f.id, invocationId: f.invocationId, summary: f.summary, state: f.state, labels: f.labels });
  }
  for (const e of collaborationEvents) if (ids.has(e.recordId)) push({ ...e, id: `work:${e.id}`, category: 'work', kind: 'work_event', eventKind: e.kind, workId: e.recordId });
  for (const w of works) if (!collaborationEvents.some(e => e.recordId === w.id)) push({ id: `work:${w.id}:snapshot:${w.updatedAt}`, at: w.updatedAt, kind: 'work_snapshot', category: 'work', workId: w.id, state: w.state, summary: w.progress?.summary ?? w.summary ?? w.title });
  const sorted = [...new Map(events.map(e => [e.id,e])).values()].filter(e => since === undefined || e.at > since).sort((a,b) => a.at-b.at || a.id.localeCompare(b.id)).slice(-limit);
  return { label, generatedAt: Date.now(), since: since ?? null, cursor: sorted.at(-1)?.id ?? null, counts: { events: sorted.length, messages: sorted.filter(e => e.category === 'message').length, invocations: sorted.filter(e => e.category === 'invocation').length, flights: sorted.filter(e => e.category === 'flight').length, workEvents: sorted.filter(e => e.category === 'work').length }, events: sorted };
}

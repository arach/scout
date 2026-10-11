import { setImmediate as yieldLoop, setTimeout as waitForRead } from "node:timers/promises";
import { db, openReadonlyDb } from "./internal/db.ts";
import { readTroubleDeliveries, type BrokerDelivery } from "../world-broker-rows.ts";

export type WorldAskRow = {
  created_at: number; completed_at: number | null; state: string;
  requester_id: string; target_agent_id: string; task: string | null; error: string | null;
};
export type WorldMessageRow = { created_at: number; actor_id: string; class: string | null };
export type WorldActorRow = { id: string; kind: string; display_name: string; metadata_json: string | null };
export type WorldAgentRow = {
  id: string; node_qualifier: string | null; workspace_qualifier: string | null;
  agent_class: string | null; metadata_json: string | null;
};
export type WorldBrokerSnapshot = {
  asks: WorldAskRow[]; messages: WorldMessageRow[]; actors: WorldActorRow[]; agents: WorldAgentRow[];
  /** messages the broker could not deliver, or has not yet (world-broker-rows.ts) — FAILED / STUCK on the World */
  deliveries?: BrokerDelivery[];
};

/** SQLite lock waits must not sleep on the API event loop. */
export async function readWorldBrokerSnapshot(
  from: number,
  open = () => openReadonlyDb(0),
): Promise<WorldBrokerSnapshot> {
  for (let attempt = 0; ; attempt++) {
    let connection: ReturnType<typeof open> | undefined;
    try {
      connection = open();
      const steps = worldSnapshotSteps(from, connection);
      for (;;) {
        const step = steps.next();
        if (step.done) return step.value;
        await yieldLoop();
      }
    } catch (error) {
      if (attempt >= 5 || !/SQLITE_(BUSY|LOCKED)/.test(String((error as { code?: string }).code))) throw error;
    } finally { connection?.close(); }
    await waitForRead(25 * 2 ** attempt);
  }
}

/** Observed projection only. The shared connection is readonly and query_only. */
export function queryWorldBrokerSnapshot(from: number, connection = db()): WorldBrokerSnapshot {
  const steps = worldSnapshotSteps(from, connection);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

function* worldSnapshotSteps(from: number, connection: ReturnType<typeof db>): Generator<void, WorldBrokerSnapshot> {
  // Filter rowids using a covering timestamp index before loading task/error
  // bodies. There is no standalone invocations(created_at) index, and a direct
  // range query otherwise scans every historical invocation's large payload.
  const asks = connection.query(`select created_at, completed_at, state, requester_id,
    target_agent_id, task, error from invocations where rowid in
    (select rowid from invocations where created_at > ?) order by created_at`).all(from) as WorldAskRow[];
  yield;
  const messages = connection.query(`select created_at, actor_id, class from messages
    where created_at > ? order by created_at`).all(from) as WorldMessageRow[];
  yield;
  const deliveries = readTroubleDeliveries(connection, from);
  yield;
  const ids = new Set([...asks.flatMap(r => [r.requester_id, r.target_agent_id]), ...messages.map(r => r.actor_id), ...deliveries.map(d => d.from).filter(Boolean)]);
  const actorQuery = connection.query("select id, kind, display_name, metadata_json from actors where id = ?");
  const agentQuery = connection.query("select id, node_qualifier, workspace_qualifier, agent_class, metadata_json from agents where id = ?");
  const actors: WorldActorRow[] = [], agents: WorldAgentRow[] = [];
  for (const id of ids) {
    const actor = actorQuery.get(id) as WorldActorRow | null;
    const agent = agentQuery.get(id) as WorldAgentRow | null;
    if (actor) actors.push(actor);
    if (agent) agents.push(agent);
    yield;
  }
  return { asks, messages, actors, agents, deliveries };
}

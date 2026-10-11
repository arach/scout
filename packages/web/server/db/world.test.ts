import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureReadonlyDb } from "./internal/db.ts";
import { queryWorldBrokerSnapshot, readWorldBrokerSnapshot } from "./world.ts";

describe("World broker read projection", () => {
  test("yields between reads and retries SQLite contention asynchronously", async () => {
    const events: string[] = [];
    let attempts = 0, timerRan = false;
    const fake = {
      query: (sql: string) => ({
        all: () => {
          events.push(sql.includes("invocations") ? "asks" : "messages");
          if (attempts === 1) throw Object.assign(new Error("busy"), { code: "SQLITE_BUSY" });
          if (sql.includes("messages")) expect(timerRan).toBe(true);
          return [];
        },
      }),
      close: () => { events.push("close"); },
    };
    const result = readWorldBrokerSnapshot(50, () => {
      attempts++;
      return fake as unknown as Database;
    });
    const timer = setTimeout(() => { timerRan = true; }, 0);
    try {
      expect(await result).toEqual({ asks: [], messages: [], deliveries: [], actors: [], agents: [] });
      expect(attempts).toBe(2);
      expect(events).toEqual(["asks", "close", "asks", "messages", "messages", "close"]);   // messages, then deliveries (which reads messages too)
    } finally { clearTimeout(timer); }
  });

  test("reads asks/messages/actor metadata through a query-only connection without writes", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        create table invocations (created_at integer, completed_at integer, state text, requester_id text, target_agent_id text, task text, error text);
        create table messages (created_at integer, actor_id text, class text);
        create table actors (id text, kind text, display_name text, metadata_json text);
        create table agents (id text, node_qualifier text, workspace_qualifier text, agent_class text, metadata_json text);
        insert into invocations values (100, 120, 'completed', 'human', 'worker', 'Inspect fixture', null), (10, null, 'failed', 'old', 'old', 'Old task', 'old error');
        insert into messages values (110, 'worker', 'work');
        insert into actors values ('worker', 'agent', 'Worker', '{}'), ('human', 'human', 'Operator', '{}'), ('old', 'agent', 'Old', '{}');
        insert into agents values ('worker', 'mini', 'main', null, '{}');
      `);
      configureReadonlyDb(db);
      const result = queryWorldBrokerSnapshot(50, db);
      expect(result.asks).toHaveLength(1);
      expect(result.messages).toEqual([{ created_at: 110, actor_id: "worker", class: "work" }]);
      expect(result.actors.map(a => a.id).sort()).toEqual(["human", "worker"]);
      expect(result.agents[0].node_qualifier).toBe("mini");
      expect(() => db.exec("delete from messages")).toThrow();
      expect(db.query("select count(*) as n from messages").get()).toEqual({ n: 1 });
    } finally { db.close(); }
  });
});

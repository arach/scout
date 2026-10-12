import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const model = runInNewContext(readFileSync(import.meta.dir + "/HudModel.js", "utf8") + "; ({fresh, validCount, capacities, work})");
test("HUD keeps unknown and stale values unavailable", () => {
  const snapshot = {updatedAt: 1000, errors: {}, activeCount: null, budgets: [{provider: "Claude", used: null}]};
  expect(model.validCount(snapshot, "activeCount", "work", 2000)).toBe("—");
  expect(model.capacities(snapshot, 1000, 2000)[0].remaining).toBeNull();
  expect(model.capacities(snapshot, 1000, 92000)).toHaveLength(0);
  expect(model.work({...snapshot, errors: {work: "Disconnected"}, activeWork: [{title: "old work"}]}, 1000, 2000)).toHaveLength(0);
});
test("capacity shows the most constrained observed provider window", () => {
  const snapshot = {budgets: [{provider: "Claude", used: 20}, {provider: "Claude", used: 65}, {provider: "Codex", used: 200}]};
  expect(JSON.parse(JSON.stringify(model.capacities(snapshot, 1000, 2000)))).toEqual([{provider: "Claude", remaining: 35}, {provider: "Codex", remaining: 0}]);
});

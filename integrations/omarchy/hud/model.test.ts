import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const model = runInNewContext(readFileSync(import.meta.dir + "/HudModel.js", "utf8") + "; ({fresh, validCount, capacities, work, fullReady})");
test("HUD keeps unknown and stale values unavailable", () => {
  const snapshot = {updatedAt: 1000, errors: {}, activeCount: null, budgets: [{provider: "Claude", used: null}]};
  expect(model.validCount(snapshot, "activeCount", "work", 2000)).toBe("—");
  expect(model.capacities(snapshot, 1000, 2000)[0].remaining).toBeNull();
  expect(model.capacities(snapshot, 1000, 92000)).toHaveLength(0);
  expect(model.work({...snapshot, errors: {work: "Disconnected"}, activeWork: [{title: "old work"}]}, 1000, 2000)).toHaveLength(0);
});
test("capacity shows the most constrained observed provider window", () => {
  const snapshot = {budgets: [{provider: "Claude", used: 20, capturedAt: 1000}, {provider: "Claude", used: 65, capturedAt: 1000}, {provider: "Codex", used: 200, capturedAt: 1000}]};
  expect(JSON.parse(JSON.stringify(model.capacities(snapshot, 1000, 2000)))).toEqual([{provider: "Claude", remaining: 35}, {provider: "Codex", remaining: 0}]);
});
test("fresh polling cannot make an old or missing quota observation current", () => {
  for (const capturedAt of [undefined, 1, NaN, 4000000]) {
    const snapshot = {budgets: [{provider: "Fixture", used: 10, capturedAt}]};
    expect(model.capacities(snapshot, 2000000, 2000001)[0].remaining).toBeNull();
  }
  const snapshot = {budgets: [{provider: "Fixture", used: 10, capturedAt: 1000}, {provider: "Fixture", used: 20}]};
  expect(model.capacities(snapshot, 1000, 2000)[0].remaining).toBeNull();
});
test("partial reads and reader failures cannot keep full-only data live", () => {
  const snapshot = {updatedAt: 2000000, errors: {}};
  expect(model.fullReady(snapshot, 1000, 2000001, "", "work")).toBe(false);
  for (const failure of ["Parse error", "Reader stopped"]) expect(model.fullReady(snapshot, 2000000, 2000001, failure, "work")).toBe(false);
  expect(model.fullReady({...snapshot, errors: {budgets: "Unavailable"}}, 2000000, 2000001, "", "budgets")).toBe(false);
  expect(model.fullReady(snapshot, 2000000, 2000001, "", "work")).toBe(true);
});

import { expect, test } from "bun:test";
import { SCOUT_MODEL_TASTE, assertValidScoutModelTaste, resolveScoutModelTaste } from "./model-taste.js";
import { SCOUT_RUNTIME_CATALOG } from "./runtime-execution.js";
import { buildOrchestrationProviderMap } from "./orchestration-provider-map.js";

test("taste resolves reviewed family and gateway IDs rather than storing model versions", () => {
  const resolved = resolveScoutModelTaste(SCOUT_MODEL_TASTE, SCOUT_RUNTIME_CATALOG);
  expect(resolved.sol?.route.model).toBe("gpt-6.1-sol");
  expect(resolved.grok?.route.model).toBe("grok-4.7");
  expect(resolved.glm?.route.model).toBe("opencode-go/glm-5.3");
  expect(resolved.kimi?.route.model).toBeNull();
  expect(SCOUT_MODEL_TASTE.opinionBasis).toContain("not benchmark");
});

test("published preferences and catalog affect advisory picks without changing catalog defaults", () => {
  const taste = structuredClone(SCOUT_MODEL_TASTE);
  const catalog = structuredClone(SCOUT_RUNTIME_CATALOG);
  const role = Object.keys(taste.roles)[0]!;
  taste.roles[role]!.candidates = [{ runtime: "luna", fit: 100, rationale: "Prefer economical research" }];
  const luna = catalog.harnesses.find(h => h.id === "codex")!.models.find(m => m.id.endsWith("-luna"))!;
  luna.id = "gpt-7-luna"; luna.version = "7 Luna";
  const report = { generatedAt: 1, generatedAtLocal: "fixture", providers: [] };
  const map = buildOrchestrationProviderMap(report, { taste, catalog, now: 1 });
  expect(map.assignments[0]?.route.model).toBe("gpt-7-luna");
  expect(SCOUT_RUNTIME_CATALOG.harnesses.find(h => h.id === "codex")!.models.find(m => m.default)?.id).toBe("gpt-6-astra");
});

test("malformed remote opinions cannot enter the routing map", () => {
  for (const mutate of [
    (t: any) => { t.runtimes.sol.selector = { tier: 12 }; },
    (t: any) => { t.runtimes.sol.effort = {}; },
    (t: any) => { t.roles[Object.keys(t.roles)[0]].candidates[0].runtime = "missing"; },
    (t: any) => { t.roles[Object.keys(t.roles)[0]].candidates[0].fit = 101; },
    (t: any) => { t.roles = []; },
    (t: any) => { t.runtimes.sol.selector = { family: "Sol", tier: "sol" }; },
  ]) {
    const taste = structuredClone(SCOUT_MODEL_TASTE); mutate(taste);
    expect(() => assertValidScoutModelTaste(taste)).toThrow();
  }
});

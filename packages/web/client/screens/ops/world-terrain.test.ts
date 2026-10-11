import { expect, test } from "bun:test";
import { baseTerrainAt, buildTerrainPlan, normalizeTerrainMask, TERRAIN_TILE, terrainChunk, terrainKindAt, terrainTileAt, terraceFor } from "./world-terrain.ts";
import { buildSharedFloorLayout } from "./shared-floor-layout.ts";
import type { AgentLane } from "./agent-lanes-model.ts";

test("blob adjacency has exactly 47 valid states, including concave corners", () => {
  expect(new Set(Array.from({ length: 256 }, (_, mask) => normalizeTerrainMask(mask))).size).toBe(47);
  expect(normalizeTerrainMask(255)).toBe(255);
  expect(normalizeTerrainMask(240)).toBe(0);
  expect(normalizeTerrainMask(15)).toBe(15);
});

test("terrain extension preserves old cells, including negative world coordinates", () => {
  const plan = buildTerrainPlan([], "watergarden", 71);
  const before = terrainChunk(plan, -1, 0);
  terrainChunk(plan, 0, 0); terrainChunk(plan, -2, 1);
  expect(terrainChunk(plan, -1, 0)).toEqual(before);
  expect(baseTerrainAt(-8, 5, 71, "watergarden")).toBe(baseTerrainAt(-8, 5, 71, "watergarden"));
  expect(terrainChunk(plan, 0, 0).find(tile => tile.x === 0 && tile.y === 4)).toEqual(terrainTileAt(plan, 0, 4));
});

test("1–64 agents grow a stone terrace and every pair of feet remains on stone", () => {
  let previousArea = 0;
  let previousTerrace: ReturnType<typeof terraceFor> | undefined;
  for (const count of [1, 3, 8, 16, 32, 64]) {
    const lanes = Array.from({ length: count }, (_, i) => ({ id: `agent-${i}`, agent: { name: `agent-${i}`, cwd: "/garden" }, observe: null } as AgentLane));
    const { groups } = buildSharedFloorLayout(lanes);
    const plan = buildTerrainPlan(groups, "watergarden");
    const terrace = terraceFor(groups[0]!);
    const area = (terrace.right - terrace.left + 1) * (terrace.bottom - terrace.top + 1);
    expect(area).toBeGreaterThanOrEqual(previousArea); previousArea = area;
    if (previousTerrace) {
      expect(terrace.left).toBe(previousTerrace.left);
      expect(terrace.top).toBe(previousTerrace.top);
      expect(terrace.right).toBeGreaterThanOrEqual(previousTerrace.right);
      expect(terrace.bottom).toBeGreaterThanOrEqual(previousTerrace.bottom);
    }
    previousTerrace = terrace;
    for (const actor of groups[0]!.actors) {
      expect(terrainKindAt(plan, Math.floor(actor.centerX / TERRAIN_TILE), Math.floor((groups[0]!.y + actor.y + 84) / TERRAIN_TILE))).toBe("stone");
    }
  }
});

test("all workspaces connect by traversable paths, with bridges across water", () => {
  const workspaces = [
    { key: "a", x: 0, y: 0, width: 715, height: 894 },
    { key: "b", x: 1900, y: 1600, width: 715, height: 894 },
    { key: "c", x: 3300, y: 0, width: 715, height: 894 },
  ];
  const plan = buildTerrainPlan(workspaces, "watergarden");
  expect(plan.paths.size).toBeGreaterThan(0);
  expect([...plan.paths].some(position => { const [x, y] = position.split(",").map(Number); return terrainKindAt(plan, x!, y!) === "bridge"; })).toBe(true);
  const centers = plan.terraces.map(r => ({ x: Math.floor((r.left + r.right) / 2), y: Math.floor((r.top + r.bottom) / 2) }));
  const queue = [centers[0]!], visited = new Set<string>();
  while (queue.length) {
    const point = queue.pop()!, key = `${point.x},${point.y}`;
    if (visited.has(key)) continue;
    const kind = terrainKindAt(plan, point.x, point.y);
    if (!["stone", "path", "bridge"].includes(kind)) continue;
    visited.add(key);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) queue.push({ x: point.x + dx!, y: point.y + dy! });
  }
  for (const point of centers) expect(visited.has(`${point.x},${point.y}`)).toBe(true);
  expect(buildTerrainPlan([...workspaces].reverse(), "watergarden")).toEqual(plan);
});

import { expect, test } from "bun:test";
import type { AgentLane } from "../agent-lanes-model.ts";
import { buildScene, emptyLayout } from "./scene-model.ts";
import { cameraForActor, flightCamera, islandHints } from "./scene-camera.ts";
const size = { width: 1194, height: 834 };
const lanes = ["/one", "/two", "/three"].map(cwd => ({ id: cwd, agent: { name: cwd, cwd }, observe: null } as AgentLane));

test("flight ends exactly at the agent, pulling back for distant travel", () => {
  const from = { x: 100, y: 200, scale: 1 }, to = { x: -15000, y: 7500, scale: 1.6 };
  expect(flightCamera(from, to, size, 0)).toEqual(from);
  expect(flightCamera(from, to, size, 1)).toEqual(to);
  expect(flightCamera(from, to, size, .5).scale).toBeLessThan(from.scale);
  for (let i = 0; i <= 100; i++) {
    const camera = flightCamera(from, to, size, i / 100);
    expect(Number.isFinite(camera.x) && Number.isFinite(camera.y)).toBe(true);
    expect(camera.scale).toBeGreaterThanOrEqual(.079);
  }
});
test("agent focus lands the actual feet in the viewport", () => {
  const island = buildScene(lanes, [], emptyLayout()).islands[0]!, actor = island.actors[0]!;
  const camera = cameraForActor(island, actor, size);
  expect((island.x + actor.x) * camera.scale + camera.x).toBeCloseTo(size.width * .48);
  expect((island.y + actor.y - 30) * camera.scale + camera.y).toBeCloseTo(size.height * .52);
});
test("off-screen island hints stay on screen with distinct targets", () => {
  const scene = buildScene(lanes, [], emptyLayout());
  const hints = islandHints(scene, { x: -4000, y: -4000, scale: 1 }, size);
  expect(hints).toHaveLength(3);
  for (const hint of hints) {
    expect(hint.x).toBeGreaterThanOrEqual(62); expect(hint.x).toBeLessThanOrEqual(size.width - 62);
    expect(hint.y).toBeGreaterThanOrEqual(125); expect(hint.y).toBeLessThanOrEqual(size.height - 110);
  }
  expect(new Set(hints.map(h => `${h.x},${h.y}`)).size).toBe(3);
});

import { expect, test } from "bun:test";
import type { AgentLane } from "../agent-lanes-model.ts";
import { buildScene, emptyLayout, worldPoint, zoomAt } from "./scene-model.ts";
import { cameraAtMinimapPoint, MINIMAP_SIZE, minimapGeometry, minimapViewport } from "./scene-minimap.ts";

const lanes = ["/one", "/two"].map(cwd => ({ id: cwd, agent: { name: cwd, cwd }, observe: null } as AgentLane));
const scene = buildScene(lanes, [], emptyLayout());
scene.islands[0]!.x = -4200; scene.islands[0]!.y = -2700;
const size = { width: 1194, height: 834 };

test("negative and distant islands fit the minimap with invertible coordinates", () => {
  const geometry = minimapGeometry(scene);
  for (const island of scene.islands) {
    for (const world of [{ x: island.x, y: island.y }, { x: island.x + island.width, y: island.y + island.height }]) {
      const mapped = geometry.point(world), recovered = geometry.world(mapped);
      expect(mapped.x).toBeGreaterThanOrEqual(11.99); expect(mapped.x).toBeLessThanOrEqual(MINIMAP_SIZE.width - 11.99);
      expect(mapped.y).toBeGreaterThanOrEqual(11.99); expect(mapped.y).toBeLessThanOrEqual(MINIMAP_SIZE.height - 11.99);
      expect(recovered.x).toBeCloseTo(world.x); expect(recovered.y).toBeCloseTo(world.y);
    }
  }
});

test("camera frame and recenter use the same world coordinates at every zoom", () => {
  const geometry = minimapGeometry(scene), target = geometry.point({ x: -3900, y: -2400 });
  for (const scale of [.08, .4, 1.6, 2.5]) {
    const camera = cameraAtMinimapPoint(geometry, target, { x: 100, y: 300, scale }, size);
    const rect = minimapViewport(geometry, camera, size);
    expect(rect.x + rect.width / 2).toBeCloseTo(target.x);
    expect(rect.y + rect.height / 2).toBeCloseTo(target.y);
    const world = worldPoint({ x: size.width / 2, y: size.height / 2 }, camera);
    expect(world.x).toBeCloseTo(-3900); expect(world.y).toBeCloseTo(-2400);
    expect(camera.scale).toBe(scale);
  }
});

test("dragging from an offset in the camera frame does not jump", () => {
  const geometry = minimapGeometry(scene), camera = { x: 380, y: -900, scale: .7 };
  const rect = minimapViewport(geometry, camera, size);
  const down = { x: rect.x + rect.width * .3, y: rect.y + rect.height * .7 };
  const offset = { x: rect.x + rect.width / 2 - down.x, y: rect.y + rect.height / 2 - down.y };
  const initial = cameraAtMinimapPoint(geometry, { x: down.x + offset.x, y: down.y + offset.y }, camera, size);
  expect(initial.x).toBeCloseTo(camera.x); expect(initial.y).toBeCloseTo(camera.y);
  const moved = cameraAtMinimapPoint(geometry, { x: down.x + offset.x + 12, y: down.y + offset.y - 5 }, camera, size);
  expect(moved.x - camera.x).toBeCloseTo(-12 / geometry.scale * camera.scale);
  expect(moved.y - camera.y).toBeCloseTo(5 / geometry.scale * camera.scale);
});

test("zoom shrinks the frame around the current view without moving island dots", () => {
  const geometry = minimapGeometry(scene), camera = { x: -400, y: 50, scale: .5 };
  const before = minimapViewport(geometry, camera, size);
  const after = minimapViewport(geometry, zoomAt(camera, { x: size.width / 2, y: size.height / 2 }, 2), size);
  expect(after.width).toBeCloseTo(before.width / 2);
  expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2);
  expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2);
});

test("an empty roster has finite minimap geometry", () => {
  const geometry = minimapGeometry({ islands: [], memory: {} });
  expect(Number.isFinite(geometry.scale)).toBe(true);
  expect(geometry.world(geometry.point({ x: 0, y: 0 }))).toEqual({ x: 0, y: 0 });
});

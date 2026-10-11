import { describe, expect, test } from "bun:test";
import { buildGardenLandscape, gardenCameraBounds, gardenEdgePlants, gardenRockFaces, gardenViewDetail, gardenPonds, GARDEN_DEPTH, GARDEN_PADDING, type GardenPoint } from "./garden-geometry.ts";
import { projectFloorPoint } from "./shared-floor-camera.ts";
import { TERRAIN_TILE, terraceFor } from "./world-terrain.ts";

function inside(p: GardenPoint, rings: GardenPoint[][]) {
  let result = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
const a = { key: "a", x: 30, y: 30, width: 715, height: 894 };
const b = { key: "b", x: 1200, y: 30, width: 715, height: 894 };
const c = { key: "c", x: 400, y: 1150, width: 1073, height: 1341 };

describe("sculpted garden geometry", () => {
  test("real terraces and connecting ribbons stay on land, including a manually moved workspace", () => {
    for (const groups of [[a], [a, b, c], [a, { ...b, x: 3600, y: 2200 }], [{ ...a, width: 2800, height: 3500 }, { ...b, x: 3200 }]]) {
      const width = Math.max(...groups.map(g => g.x + g.width)) + 30, height = Math.max(...groups.map(g => g.y + g.height)) + 30;
      const landscape = buildGardenLandscape(groups, width, height);
      expect(landscape.contours.length).toBe(1);
      expect(landscape.routes.length).toBe(groups.length - 1);
      for (const group of groups) {
        const r = terraceFor(group);
        for (const x of [r.left * TERRAIN_TILE - 60, (r.right + 1) * TERRAIN_TILE + 60])
          for (const y of [r.top * TERRAIN_TILE - 60, (r.bottom + 1) * TERRAIN_TILE + 60]) expect(inside({ x, y }, landscape.contours)).toBe(true);
      }
      for (const route of landscape.routes) for (const p of route.points)
        for (const delta of [{ x: 0, y: 0 }, { x: 45, y: 0 }, { x: -45, y: 0 }, { x: 0, y: 45 }, { x: 0, y: -45 }]) expect(inside({ x: p.x + delta.x, y: p.y + delta.y }, landscape.contours)).toBe(true);
      expect(landscape.path).not.toMatch(/NaN|Infinity/);
    }
  });
  test("shoreline identity is independent of roster order; planting roots are on land", () => {
    const landscape = buildGardenLandscape([a, b, c], 2200, 2800);
    expect(buildGardenLandscape([c, a, b], 2200, 2800)).toEqual(landscape);
    for (const plant of gardenEdgePlants(landscape)) expect(inside(plant, landscape.contours)).toBe(true);
    expect(gardenEdgePlants(landscape).length).toBeLessThan(100);
  });
  test("at most two pools sit behind terraces, clear of all crew decks", () => {
    const groups = [a, b, c];
    const ponds = gardenPonds(groups, 2200, 2800);
    expect(ponds.length).toBe(2);
    for (const pond of ponds) for (const group of groups) {
      const r = terraceFor(group);
      const overlaps = pond.x < (r.right + 1) * TERRAIN_TILE && pond.x + pond.width > r.left * TERRAIN_TILE && pond.y < (r.bottom + 1) * TERRAIN_TILE && pond.y + pond.height > r.top * TERRAIN_TILE;
      expect(overlaps).toBe(false);
      expect(pond.y).toBeGreaterThan(-GARDEN_PADDING);
    }
  });
  test("Fit contains the planted contour, upright crowns and every cliff point", () => {
    const landscape = buildGardenLandscape([a, b, c], 2200, 2800);
    for (const projection of ["iso", "flat"] as const) {
      const bounds = gardenCameraBounds(landscape, projection, 2200, 2800);
      const center = projectFloorPoint(bounds.center.x, bounds.center.y, projection);
      for (const p of landscape.contours.flat()) {
        const q = projectFloorPoint(p.x, p.y, projection);
        expect(Math.abs(q.x - center.x)).toBeLessThanOrEqual(bounds.width / 2);
        expect(Math.abs(q.y - center.y)).toBeLessThanOrEqual(bounds.height / 2);
      }
      if (projection === "iso") for (const face of gardenRockFaces(landscape.contours)) {
        expect(face.path).not.toMatch(/NaN|Infinity/);
        for (const pair of face.path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
          expect(Math.abs(Number(pair[1]) - center.x)).toBeLessThanOrEqual(bounds.width / 2);
          expect(Math.abs(Number(pair[2]) - center.y)).toBeLessThanOrEqual(bounds.height / 2);
        }
      }
      expect(bounds.width).toBeGreaterThan(0); expect(bounds.height).toBeGreaterThan(0);
    }
    expect(GARDEN_DEPTH).toBeGreaterThan(0);
    expect(buildGardenLandscape([], 800, 600).contours).toEqual([]);
    expect(gardenCameraBounds(buildGardenLandscape([], 800, 600), "iso", 800, 600).center).toEqual({ x: 400, y: 300 });
  });
  test("distant labels and markers keep their screen scale", () => {
    expect(gardenViewDetail(.25).overview).toBe(false);
    expect(gardenViewDetail(.125).overview).toBe(true);
    expect(gardenViewDetail(.05).countOnly).toBe(true);
    for (const scale of [1, .75, .5, .25, .125, .05]) {
      expect(gardenViewDetail(scale).captionScale * scale * 16).toBeGreaterThanOrEqual(12);
      expect(gardenViewDetail(scale).inverseScale * scale).toBeCloseTo(1);
    }
    for (const scale of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const detail = gardenViewDetail(scale);
      expect(detail.captionScale).toBeLessThanOrEqual(32);
      expect(Number.isFinite(detail.inverseScale)).toBe(true);
    }
  });
});

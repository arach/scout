import { projectFloorPoint } from "./shared-floor-camera.ts";
import { TERRAIN_TILE, terraceFor, type TerrainWorkspace } from "./world-terrain.ts";

export const GARDEN_PADDING = TERRAIN_TILE * 2;
export const GARDEN_DEPTH = 160;
export type GardenPoint = { x: number; y: number };
export type GardenPond = GardenPoint & { key: string; width: number; height: number };
export type GardenRoute = { key: string; points: GardenPoint[]; path: string };
export type GardenLandscape = { contours: GardenPoint[][]; path: string; routes: GardenRoute[]; ponds: GardenPond[]; groves: (GardenPoint & { key: string; width: number })[] };
const rectFor = (group: TerrainWorkspace) => {
  const r = terraceFor(group);
  return { x: r.left * TERRAIN_TILE, y: r.top * TERRAIN_TILE, width: (r.right - r.left + 1) * TERRAIN_TILE, height: (r.bottom - r.top + 1) * TERRAIN_TILE };
};
const distance = (a: GardenPoint, b: GardenPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const coord = (p: GardenPoint) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
export const gardenContourPath = (contours: readonly GardenPoint[][]) => contours.map(points => `M ${points.map(coord).join(" L ")} Z`).join(" ");

/** At most two pools, behind measured terraces; adding a crew never stamps another lake. */
export function gardenPonds(groups: readonly TerrainWorkspace[], width: number, _height: number): GardenPond[] {
  const ordered = [...groups].sort((a, b) => b.width * b.height - a.width * a.height || a.key.localeCompare(b.key));
  return ordered.filter((_, i) => i === 0 || (i === ordered.length - 1 && ordered.length > 2)).flatMap((group, index) => {
    const terrace = rectFor(group), x = terrace.x + terrace.width * .48;
    const y = Math.max(-GARDEN_PADDING + 70, terrace.y - (index ? 240 : 330));
    const right = Math.min(width + GARDEN_PADDING - 70, terrace.x + terrace.width + 105), bottom = terrace.y - 64;
    return right - x > 100 && bottom - y > 80 ? [{ key: `${group.key}:rear`, x, y, width: right - x, height: bottom - y }] : [];
  });
}
export function gardenPondPath(pond: GardenPond): string {
  const p = (x: number, y: number) => coord({ x: pond.x + x * pond.width, y: pond.y + y * pond.height });
  return `M ${p(.13, .06)} C ${p(.32, -.05)} ${p(.65, .06)} ${p(.88, .04)} C ${p(1.02, .06)} ${p(1.03, .36)} ${p(.96, .59)} C ${p(.91, .79)} ${p(.99, .94)} ${p(.81, .98)} C ${p(.63, 1.02)} ${p(.61, .8)} ${p(.42, .91)} C ${p(.23, 1.02)} ${p(.06, .84)} ${p(.08, .61)} C ${p(.11, .4)} ${p(-.03, .19)} ${p(.13, .06)} Z`;
}

/** Deterministic spanning tree with cubic bends. Samples support connecting land. */
function gardenRoutes(groups: readonly TerrainWorkspace[]): GardenRoute[] {
  const centers = groups.map(group => { const r = rectFor(group); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const joined = new Set<number>(centers.length ? [0] : []), routes: GardenRoute[] = [];
  while (joined.size < centers.length) {
    let edge: { from: number; to: number; length: number } | undefined;
    for (const from of joined) for (let to = 0; to < centers.length; to++) {
      if (joined.has(to)) continue;
      const length = distance(centers[from]!, centers[to]!);
      if (!edge || length < edge.length) edge = { from, to, length };
    }
    if (!edge) break;
    const a = centers[edge.from]!, b = centers[edge.to]!, length = Math.max(1, edge.length);
    const dx = b.x - a.x, dy = b.y - a.y, bend = Math.min(160, length * .15);
    const c = { x: a.x + dx / 3 - dy / length * bend, y: a.y + dy / 3 + dx / length * bend };
    const d = { x: a.x + dx * 2 / 3 + dy / length * bend, y: a.y + dy * 2 / 3 - dx / length * bend };
    const count = Math.max(12, Math.ceil(length / 48));
    const points = Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count, u = 1 - t;
      return { x: u ** 3 * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u * u * t * c.y + 3 * u * t * t * d.y + t ** 3 * b.y };
    });
    routes.push({ key: `${groups[edge.from]!.key}:${groups[edge.to]!.key}`, points, path: `M ${coord(a)} C ${coord(c)} ${coord(d)} ${coord(b)}` });
    joined.add(edge.to);
  }
  return routes;
}
function roundedDistance(p: GardenPoint, r: { x: number; y: number; width: number; height: number }, radius: number) {
  const qx = Math.abs(p.x - r.x - r.width / 2) - r.width / 2 + radius, qy = Math.abs(p.y - r.y - r.height / 2) - r.height / 2 + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}
const smoothMin = (a: number, b: number) => { const h = Math.max(180 - Math.abs(a - b), 0) / 180; return Math.min(a, b) - h * h * 45; };

/** Shared contour drives ground, lip and rock. Interpolate the smooth union on a
 * 48px grid and round once. Enclosed pockets become land rather than sky. */
export function buildGardenLandscape(input: readonly TerrainWorkspace[], width: number, height: number): GardenLandscape {
  const groups = [...input].sort((a, b) => a.key.localeCompare(b.key));
  const routes = gardenRoutes(groups), ponds = gardenPonds(groups, width, height);
  const plots = groups.map(group => { const r = rectFor(group); return { x: r.x - 180, y: Math.max(-GARDEN_PADDING + 25, r.y - 395), width: r.width + 360, height: r.height + 600 }; });
  const samples = routes.flatMap(route => route.points);
  const step = 48, at = (x: number, y: number) => `${x},${y}`;
  const startX = Math.floor(-GARDEN_PADDING / step), startY = Math.floor(-GARDEN_PADDING / step);
  const endX = Math.ceil((width + GARDEN_PADDING) / step), endY = Math.ceil((height + GARDEN_PADDING) / step);
  const fields = new Map<string, number>();
  for (let y = startY; y <= endY; y++) for (let x = startX; x <= endX; x++) {
    const p = { x: x * step, y: y * step };
    let field = Infinity;
    for (const plot of plots) field = smoothMin(field, roundedDistance(p, plot, 225));
    for (const sample of samples) field = Math.min(field, distance(p, sample) - 175);
    const ripple = Math.sin(p.x / 151 + p.y / 211) * 14 + Math.cos(p.y / 109 - p.x / 247) * 9;
    const border = 20 - Math.min(p.x + GARDEN_PADDING, p.y + GARDEN_PADDING, width + GARDEN_PADDING - p.x, height + GARDEN_PADDING - p.y);
    fields.set(at(x, y), Math.max(field + ripple, border));
  }
  // Marching-square vertices interpolate the continuous field. Cell stair
  // steps never reach the renderer, even where a shoreline cuts across chunks.
  const points = new Map<string, GardenPoint>(), edges = new Map<string, string[]>();
  const segments: readonly (readonly number[])[] = [[], [0, 3], [1, 0], [1, 3], [2, 1], [0, 3, 2, 1], [2, 0], [2, 3], [3, 2], [0, 2], [1, 0, 3, 2], [1, 2], [3, 1], [0, 1], [3, 0], []];
  for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
    const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as const;
    const values = corners.map(([a, b]) => fields.get(at(a, b))!);
    const mask = values.reduce((value, field, i) => value | (field < 0 ? 1 << i : 0), 0);
    const ends = segments[mask]!;
    const vertex = (edge: number) => {
      const ids = [`h:${x},${y}`, `v:${x + 1},${y}`, `h:${x},${y + 1}`, `v:${x},${y}`];
      const id = ids[edge]!, a = corners[edge]!, b = corners[(edge + 1) % 4]!;
      if (!points.has(id)) {
        const u = values[edge]!, v = values[(edge + 1) % 4]!, t = u / (u - v);
        points.set(id, { x: (a[0] + (b[0] - a[0]) * t) * step, y: (a[1] + (b[1] - a[1]) * t) * step });
      }
      return id;
    };
    for (let i = 0; i < ends.length; i += 2) {
      const a = vertex(ends[i]!), b = vertex(ends[i + 1]!);
      edges.set(a, [...(edges.get(a) ?? []), b]);
    }
  }
  const contours: GardenPoint[][] = [];
  while (edges.size) {
    const start = edges.keys().next().value!;
    let current = start, ring: GardenPoint[] = [];
    do {
      ring.push(points.get(current)!);
      const next = edges.get(current); if (!next?.length) break;
      const prior = current; current = next.shift()!; if (!next.length) edges.delete(prior);
    } while (current !== start);
    if (ring.length < 4) continue;
    // One smoothing pass is enough after interpolation. Keep a small vertex
    // budget for SVG walls and recalculation during workspace dragging.
    ring = ring.flatMap((a, i) => { const b = ring[(i + 1) % ring.length]!; return [{ x: a.x * .75 + b.x * .25, y: a.y * .75 + b.y * .25 }, { x: a.x * .25 + b.x * .75, y: a.y * .25 + b.y * .75 }]; });
    const area = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]!; return sum + p.x * q.y - q.x * p.y; }, 0);
    // Enclosed pockets become planted ground, never unintended holes into sky.
    if (area > 0) contours.push(ring);
  }
  const groves = groups.flatMap(group => {
    const r = rectFor(group);
    return [{ key: `${group.key}:grove`, x: r.x + 80, y: r.y - 70, width: Math.min(520, r.width * .75) }, { key: `${group.key}:copse`, x: r.x + r.width - 80, y: r.y - 220, width: 340 }];
  }).filter(g => !ponds.some(p => g.x > p.x - 20 && g.x < p.x + p.width + 20 && g.y > p.y - 20 && g.y < p.y + p.height + 20));
  return { contours, path: gardenContourPath(contours), routes, ponds, groves };
}

/** A shallow bedrock edge, with a continuous material coordinate along the
 * shore. Depth is local: separate lobes never acquire a shared pointed root. */
export function gardenRockFaces(contours: readonly GardenPoint[][]) {
  const root = (p: GardenPoint) => ({ x: p.x, y: p.y + GARDEN_DEPTH - 14 + Math.sin(p.x / 181 + p.y / 213) * 8 });
  return contours.flatMap(ring => {
    let offset = 0;
    return ring.flatMap((point, i) => {
      const next = ring[(i + 1) % ring.length]!;
      const length = distance(point, next), start = offset;
      offset += length;
      const a = projectFloorPoint(point.x, point.y, "iso"), b = projectFloorPoint(next.x, next.y, "iso");
      if (a.x <= b.x || length < .001) return [];
      const c = root(b), d = root(a);
      const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
      return [{ path: `M ${coord(a)} L ${coord(b)} L ${coord(c)} L ${coord(d)} Z`, top: `M ${coord(a)} L ${coord(b)}`,
        materialTransform: `matrix(${tx} ${ty} 0 1 ${a.x - tx * start} ${a.y - ty * start})`,
        shade: .12 + .16 * Math.max(0, -ty),
      }];
    });
  });
}

export function gardenViewDetail(scale: number) {
  const safe = Math.max(.001, Number.isFinite(scale) ? scale : 1);
  return { overview: safe < .17, distant: safe < .5, countOnly: safe < .085, hideCaptions: safe < .028, captionScale: Math.min(32, Math.max(1, .75 / safe)), inverseScale: 1 / safe };
}

/** Planting follows the real shore at even arc-length intervals, inset toward
 * land. Width and spacing vary gently; no square perimeter or tile lattice. */
export function gardenEdgePlants(landscape: GardenLandscape) {
  return landscape.contours.flatMap((ring, ringIndex) => {
    const plants: (GardenPoint & { key: string; width: number; mirror: boolean })[] = [];
    let remaining = 80;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!, length = distance(a, b);
      if (length < .01) continue;
      const pa = projectFloorPoint(a.x, a.y, "iso"), pb = projectFloorPoint(b.x, b.y, "iso");
      if (pa.x <= pb.x) continue;
      while (remaining <= length) {
        const t = remaining / length, index = plants.length;
        plants.push({ key: `shore:${ringIndex}:${index}`, x: a.x + (b.x - a.x) * t - (b.y - a.y) / length * 105, y: a.y + (b.y - a.y) * t + (b.x - a.x) / length * 105, width: 200 + Math.sin(index * 1.7) * 45, mirror: index % 3 === 1 });
        remaining += [95, 135, 85, 310, 130, 110, 260][index % 7]!;
      }
      remaining -= length;
    }
    return plants;
  }).sort((a, b) => a.x + a.y - b.x - b.y);
}

/** Fit the living landscape rather than departed layout vacancies. The camera
 * and minimap share this center, including the cliff and upright tree crowns. */
export function gardenCameraBounds(landscape: GardenLandscape, projection: "flat" | "iso", width: number, height: number) {
  const points = landscape.contours.flat().map(p => projectFloorPoint(p.x, p.y, projection));
  for (const grove of landscape.groves) {
    const p = projectFloorPoint(grove.x, grove.y, projection);
    points.push({ x: p.x - grove.width / 2, y: p.y - grove.width * .91 }, { x: p.x + grove.width / 2, y: p.y });
  }
  if (!points.length) return { center: { x: width / 2, y: height / 2 }, width, height };
  const left = Math.min(...points.map(p => p.x)) - 60, right = Math.max(...points.map(p => p.x)) + 60;
  const top = Math.min(...points.map(p => p.y)) - 40, bottom = Math.max(...points.map(p => p.y)) + (projection === "iso" ? GARDEN_DEPTH : 60);
  const x = (left + right) / 2, y = (top + bottom) / 2;
  const center = projection === "iso" ? { x: x / Math.sqrt(3) + y, y: y - x / Math.sqrt(3) } : { x, y };
  return { center, width: right - left, height: bottom - top };
}

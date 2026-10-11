/** Continuous terrain: integer cells, world-anchored noise, and 47-state blob
 * adjacency. Rendering and camera projection are intentionally separate. */
export const TERRAIN_TILE = 96;
export const TERRAIN_CHUNK = 12;
export type TerrainBiome = "meadow" | "orchard" | "watergarden";
export type TerrainKind = "grass" | "water" | "stone" | "path" | "bridge";
export type TerrainWorkspace = { key: string; x: number; y: number; width: number; height: number };
export type TerrainRect = { left: number; top: number; right: number; bottom: number };
export type TerrainPlan = { seed: number; biome: TerrainBiome; terraces: TerrainRect[]; paths: ReadonlySet<string> };
export type TerrainTile = { x: number; y: number; kind: TerrainKind; mask: number };

const key = (x: number, y: number) => `${x},${y}`;
function random(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const sx = x - ix, sy = y - iy;
  const u = sx * sx * (3 - 2 * sx), v = sy * sy * (3 - 2 * sy);
  const a = random(ix, iy, seed), b = random(ix + 1, iy, seed);
  const c = random(ix, iy + 1, seed), d = random(ix + 1, iy + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** Extending a chunk does not change any existing base cell. */
export function baseTerrainAt(x: number, y: number, seed: number, biome: TerrainBiome): "grass" | "water" {
  const field = noise(x / 5, y / 5, seed);
  if (biome === "watergarden") {
    const stream = Math.sin(x * .21 + seed * .13) * 3 + Math.cos(x * .08) * 2 + 7;
    return Math.abs(y - stream) < 1.1 || field > .8 ? "water" : "grass";
  }
  return field > (biome === "orchard" ? .86 : .77) ? "water" : "grass";
}

/** Stone claims use the same deck fractions as shared-floor-layout, plus a
 * safe border. More agents enlarge the existing rectangle by whole cells. */
export function terraceFor(workspace: TerrainWorkspace): TerrainRect {
  return {
    left: Math.floor((workspace.x + Math.min(workspace.width, 715) * .14) / TERRAIN_TILE),
    right: Math.ceil((workspace.x + workspace.width * .86) / TERRAIN_TILE) - 1,
    top: Math.floor((workspace.y + Math.min(workspace.height, 894) * .30) / TERRAIN_TILE),
    bottom: Math.ceil((workspace.y + workspace.height * .66) / TERRAIN_TILE) - 1,
  };
}

export function buildTerrainPlan(workspaces: readonly TerrainWorkspace[], biome: TerrainBiome = "meadow", seed = 42): TerrainPlan {
  const ordered = [...workspaces].sort((a, b) => a.key.localeCompare(b.key));
  const terraces = ordered.map(terraceFor);
  const centers = terraces.map(rect => ({ x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) }));
  const paths = new Set<string>();
  // Deterministic nearest-neighbor spanning tree: every workspace is reachable.
  const joined = new Set<number>(centers.length ? [0] : []);
  while (joined.size < centers.length) {
    let edge: { from: number; to: number; distance: number } | undefined;
    for (const from of joined) for (let to = 0; to < centers.length; to++) {
      if (joined.has(to)) continue;
      const distance = Math.abs(centers[from]!.x - centers[to]!.x) + Math.abs(centers[from]!.y - centers[to]!.y);
      if (!edge || distance < edge.distance) edge = { from, to, distance };
    }
    if (!edge) break;
    const from = centers[edge.from]!, to = centers[edge.to]!;
    let x = from.x, y = from.y;
    paths.add(key(x, y));
    while (x !== to.x) { x += Math.sign(to.x - x); paths.add(key(x, y)); }
    while (y !== to.y) { y += Math.sign(to.y - y); paths.add(key(x, y)); }
    joined.add(edge.to);
  }
  return { seed, biome, terraces, paths };
}

export function terrainKindAt(plan: TerrainPlan, x: number, y: number): TerrainKind {
  if (plan.terraces.some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return "stone";
  const ground = baseTerrainAt(x, y, plan.seed, plan.biome);
  if (plan.paths.has(key(x, y))) return ground === "water" ? "bridge" : "path";
  return ground;
}

/** N=1, E=2, S=4, W=8; NW=16, NE=32, SE=64, SW=128.
 * A corner counts only if both adjacent cardinal neighbors connect: 47 masks. */
export function normalizeTerrainMask(mask: number): number {
  let result = mask & 15;
  if ((mask & 9) === 9 && (mask & 16)) result |= 16;
  if ((mask & 3) === 3 && (mask & 32)) result |= 32;
  if ((mask & 6) === 6 && (mask & 64)) result |= 64;
  if ((mask & 12) === 12 && (mask & 128)) result |= 128;
  return result;
}

function sameSurface(a: TerrainKind, b: TerrainKind) {
  if (a === "stone" || a === "path" || a === "bridge") return b === "stone" || b === "path" || b === "bridge";
  return a === b;
}
const neighbors = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8], [-1, -1, 16], [1, -1, 32], [1, 1, 64], [-1, 1, 128]] as const;
export function terrainTileAt(plan: TerrainPlan, x: number, y: number): TerrainTile {
  const kind = terrainKindAt(plan, x, y);
  let mask = 0;
  for (const [dx, dy, bit] of neighbors) if (sameSurface(kind, terrainKindAt(plan, x + dx, y + dy))) mask |= bit;
  return { x, y, kind, mask: normalizeTerrainMask(mask) };
}

/** Query neighbors outside a chunk, so chunk boundaries cannot create seams. */
export function terrainChunk(plan: TerrainPlan, chunkX: number, chunkY: number): TerrainTile[] {
  const tiles: TerrainTile[] = [];
  for (let y = chunkY * TERRAIN_CHUNK; y < (chunkY + 1) * TERRAIN_CHUNK; y++)
    for (let x = chunkX * TERRAIN_CHUNK; x < (chunkX + 1) * TERRAIN_CHUNK; x++) tiles.push(terrainTileAt(plan, x, y));
  return tiles;
}

/** Fixed-size garden clusters live only on clear grass, never on a workspace,
 * path, or shoreline. Their identity is anchored to coordinates, like tiles. */
export function terrainGardens(plan: TerrainPlan, width: number, height: number) {
  const gardens: { x: number; y: number; key: string }[] = [];
  for (let y = 2; y < height / TERRAIN_TILE - 1; y += 4) for (let x = 2; x < width / TERRAIN_TILE - 1; x += 4) {
    if (random(x, y, plan.seed + 14) > (plan.biome === "orchard" ? .65 : .3)) continue;
    if ([-1, 0, 1].some(dy => [-1, 0, 1].some(dx => terrainKindAt(plan, x + dx, y + dy) !== "grass"))) continue;
    gardens.push({ key: key(x, y), x: (x + .5) * TERRAIN_TILE, y: (y + .5) * TERRAIN_TILE });
  }
  return gardens;
}

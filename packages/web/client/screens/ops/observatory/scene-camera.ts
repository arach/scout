import type { Camera, Point, Scene, SceneActor, SceneIsland, SceneRoom } from "./scene-model.ts";
type Size = { width: number; height: number };
export function cameraForIsland(island: SceneIsland, size: Size): Camera {
  const scale = Math.min(1.3, (size.width - 100) / island.width, (size.height - 140) / (island.artHeight * .72));
  return { scale, x: size.width / 2 - (island.x + island.width / 2) * scale, y: size.height / 2 - (island.y + island.artHeight * .44) * scale };
}
export function cameraForActor(island: SceneIsland, actor: SceneActor, size: Size): Camera {
  const scale = Math.min(1.6, Math.max(.85, size.width / 900));
  return { scale, x: size.width * .48 - (island.x + actor.x) * scale, y: size.height * .52 - (island.y + actor.y - 30) * scale };
}
export function cameraForRoom(island: SceneIsland, room: SceneRoom, size: Size): Camera {
  const actors = island.actors.filter(actor => actor.room === room.id);
  const left = Math.min(room.x - room.rx, ...actors.map(actor => actor.x - 60));
  const right = Math.max(room.x + room.rx, ...actors.map(actor => actor.x + 60));
  const top = Math.min(room.y - room.ry, ...actors.map(actor => actor.y - 100));
  const bottom = Math.max(room.y + room.ry + 45, ...actors.map(actor => actor.y + 30));
  const scale = Math.max(.08, Math.min(1.4, (size.width - 120) / (right - left), (size.height - 230) / (bottom - top)));
  return { scale, x: size.width / 2 - (island.x + (left + right) / 2) * scale, y: size.height * .48 - (island.y + (top + bottom) / 2) * scale };
}
/** A distant journey briefly pulls back, travels in world coordinates, then
 * approaches the destination. Exact endpoints and reduced-motion are explicit. */
export function flightCamera(from: Camera, to: Camera, size: Size, progress: number): Camera {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const t = progress * progress * (3 - 2 * progress);
  const a = { x: (size.width / 2 - from.x) / from.scale, y: (size.height / 2 - from.y) / from.scale };
  const b = { x: (size.width / 2 - to.x) / to.scale, y: (size.height / 2 - to.y) / to.scale };
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const cruise = Math.max(.08, Math.min(from.scale, to.scale, size.width / Math.max(1, distance * 1.2)));
  const baseline = Math.log(from.scale) * (1 - t) + Math.log(to.scale) * t;
  const pullback = Math.sin(Math.PI * t) ** 2;
  const scale = Math.exp(baseline * (1 - pullback) + Math.log(cruise) * pullback);
  return { scale, x: size.width / 2 - (a.x + (b.x - a.x) * t) * scale, y: size.height / 2 - (a.y + (b.y - a.y) * t) * scale };
}
export type IslandHint = Point & { island: SceneIsland; edge: "left" | "right" | "top" | "bottom" };
export function islandHints(scene: Scene, camera: Camera, size: Size): IslandHint[] {
  const center = { x: size.width / 2, y: size.height / 2 };
  const hints: IslandHint[] = [];
  for (const island of scene.islands) {
    const point = { x: (island.x + island.width / 2) * camera.scale + camera.x, y: (island.y + island.artHeight * .46) * camera.scale + camera.y };
    if (point.x > 50 && point.x < size.width - 50 && point.y > 70 && point.y < size.height - 70) continue;
    const dx = point.x - center.x, dy = point.y - center.y;
    const horizontal = Math.abs(dx) / Math.max(1, center.x - 60) > Math.abs(dy) / Math.max(1, center.y - 100);
    const edge = horizontal ? dx < 0 ? "left" : "right" : dy < 0 ? "top" : "bottom";
    const ratio = horizontal ? (center.x - 55) / Math.max(1, Math.abs(dx)) : (center.y - 100) / Math.max(1, Math.abs(dy));
    hints.push({ island, edge, x: Math.min(size.width - 62, Math.max(62, center.x + dx * ratio)), y: Math.min(size.height - 110, Math.max(125, center.y + dy * ratio)) });
  }
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    const peers = hints.filter(hint => hint.edge === edge), vertical = edge === "left" || edge === "right";
    const field = vertical ? "y" : "x", min = vertical ? 125 : 72, max = vertical ? size.height - 110 : size.width - 72;
    peers.sort((a, b) => a[field] - b[field]);
    const gap = Math.min(112, Math.max(0, (max - min) / Math.max(1, peers.length - 1)));
    for (let i = 1; i < peers.length; i++) peers[i]![field] = Math.max(peers[i]![field], peers[i - 1]![field] + gap);
    if (peers.length && peers.at(-1)![field] > max) {
      peers.at(-1)![field] = max;
      for (let i = peers.length - 2; i >= 0; i--) peers[i]![field] = Math.min(peers[i]![field], peers[i + 1]![field] - gap);
    }
  }
  return hints;
}

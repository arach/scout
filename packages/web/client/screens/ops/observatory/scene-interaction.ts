import { moveRoom, nearestSeat, placeActor, placeRoom, roomAt, swapActors, type Camera, type Point, type Scene, type SceneActor, type SceneLayout, type SceneRoom } from "./scene-model.ts";
import type { AgentLane } from "../agent-lanes-model.ts";

export type Pick = { kind: "actor" | "room" | "island"; island: string; id: string };
export type Gesture = {
  pointerId: number; pick: Pick | null; start: Point; point: Point; moved: boolean;
  camera: Camera; scene: Scene; layout: SceneLayout;
};

/** Discover a room without making its scenery a room drag handle. The revealed
 * grip owns a room drag; this generous halo merely reveals the floor inlay. */
export function previewRoomAt(scene: Scene, point: Point, pick: Pick | null): Pick | null {
  if (pick) {
    if (pick.kind === "room") return pick;
    const island = scene.islands.find(island => island.id === pick.island);
    const actor = pick.kind === "actor" && island?.actors.find(actor => actor.lane.id === pick.id);
    if (actor) return { kind: "room", island: pick.island, id: actor.room };
    if (pick.kind !== "island") return null;
  }
  for (const island of [...scene.islands].reverse()) {
    if (pick?.kind === "island" && island.id !== pick.island) continue;
    const room = island.rooms.find(room => ((point.x - island.x - room.x) / (room.rx * 1.25)) ** 2 + ((point.y - island.y - room.y) / (room.ry * 1.25)) ** 2 <= 1);
    if (room) return { kind: "room", island: island.id, id: room.id };
  }
  return null;
}

export function gestureDelta(gesture: Gesture): Point {
  return { x: (gesture.point.x - gesture.start.x) / gesture.camera.scale, y: (gesture.point.y - gesture.start.y) / gesture.camera.scale };
}
export function gestureDestination(gesture: Gesture) {
  const drop = gesturePlacement(gesture);
  if (!drop || drop.kind === "room-place" || drop.kind === "actor-place" && !drop.inside) return null;
  return { room: drop.room, seat: drop.kind === "actor-swap" ? drop.actor.seat : nearestSeat(drop.room, drop.point) };
}

type Placement = { point: Point } & (
  | { kind: "actor-swap"; actor: SceneActor; room: SceneRoom }
  | { kind: "actor-place"; room: SceneRoom; inside: boolean }
  | { kind: "room-swap"; room: SceneRoom }
  | { kind: "room-place" }
);
/** Free coordinates are the default. Only a deliberate drop near another
 * person's feet or another room's center opts into a swap. */
export function gesturePlacement(gesture: Gesture): Placement | null {
  if (!gesture.pick || gesture.pick.kind === "island") return null;
  const island = gesture.scene.islands.find(island => island.id === gesture.pick!.island)!;
  const delta = gestureDelta(gesture);
  if (gesture.pick.kind === "room") {
    const origin = island.rooms.find(room => room.id === gesture.pick!.id)!;
    const point = { x: origin.x + delta.x, y: origin.y + delta.y };
    const room = island.rooms.find(room => room.id !== origin.id && ((point.x - room.x) / (room.rx * .55)) ** 2 + ((point.y - room.y) / (room.ry * .55)) ** 2 <= 1);
    return room ? { kind: "room-swap", room, point } : { kind: "room-place", point };
  }
  const origin = island.actors.find(actor => actor.lane.id === gesture.pick!.id)!;
  const point = { x: origin.x + delta.x, y: origin.y + delta.y };
  const actor = island.actors.filter(actor => actor.lane.id !== origin.lane.id).sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y)).find(actor => ((actor.x - point.x) / 30) ** 2 + ((actor.y - point.y) / 22) ** 2 <= 1);
  if (actor) return { kind: "actor-swap", actor, room: island.rooms.find(room => room.id === actor.room)!, point };
  const room = roomAt(island, point);
  return { kind: "actor-place", point, room: room ?? island.rooms.find(room => room.id === origin.room)!, inside: !!room };
}

export function layoutAfterGesture(gesture: Gesture): SceneLayout {
  if (!gesture.pick) return gesture.layout;
  const island = gesture.scene.islands.find(island => island.id === gesture.pick!.island)!;
  if (gesture.pick.kind === "island") {
    const delta = gestureDelta(gesture);
    return { ...gesture.layout, islands: { ...gesture.layout.islands, [island.id]: { x: island.x + delta.x, y: island.y + delta.y } } };
  }
  const drop = gesturePlacement(gesture)!;
  if (drop.kind === "actor-swap") return swapActors(gesture.layout, island, gesture.pick.id, drop.actor.lane.id);
  if (drop.kind === "actor-place") return placeActor(gesture.layout, island, gesture.pick.id, drop.point, drop.room.id);
  if (drop.kind === "room-swap") return moveRoom(gesture.layout, island, gesture.pick.id, drop.room);
  return placeRoom(gesture.layout, island, gesture.pick.id, drop.point);
}

/** The same frozen scene and destination used by the commit drive the promise
 * shown before release, including swaps and free placement. */
export function dropDescription(gesture: Gesture, name: (lane: AgentLane) => string): string {
  if (!gesture.pick) return "Moving the view";
  const island = gesture.scene.islands.find(island => island.id === gesture.pick!.island)!;
  if (gesture.pick.kind === "island") return `Move ${island.label} island · all ${island.actors.length} agents stay together`;
  const target = gesturePlacement(gesture)!;
  if (gesture.pick.kind === "room") {
    const source = island.rooms.find(room => room.id === gesture.pick!.id)!;
    return target.kind === "room-swap" ? `Swap ${source.label} with ${target.room.label} · both groups move` : `Place ${source.label} here · ${source.actorIds.length} agents move together`;
  }
  const actor = island.actors.find(actor => actor.lane.id === gesture.pick!.id)!;
  if (target.kind === "actor-swap") return `Swap places with ${name(target.actor.lane)}`;
  if (target.kind !== "actor-place") return "Place here";
  return actor.room !== target.room.id ? `Move ${name(actor.lane)} into ${target.room.label}` : `Place ${name(actor.lane)} here · stays in ${target.room.label}`;
}

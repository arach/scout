import type { AgentLane } from "../agent-lanes-model.ts";
import { buildSharedFloorLayout } from "../shared-floor-layout.ts";
import { buildFloorMicroRooms, type FloorAffinityEdge, type FloorMicroRoomMemory } from "../floor-micro-rooms.ts";

export type Point = { x: number; y: number };
export type Camera = Point & { scale: number };
export type ActorPlacement = { room: string; seat: number };
export type RoomMembership = { id: string; label: string; actorIds: string[] };
export type SceneLayout = {
  islands: Record<string, Point>;
  rooms: Record<string, number>;
  actors: Record<string, ActorPlacement>;
  spaces?: Record<string, RoomMembership[]>;
  /** Room centers are island-relative; free actor points are room-relative. */
  roomPositions?: Record<string, Point>;
  actorPositions?: Record<string, Point>;
};
export type SceneRoom = Point & { id: string; label: string; slot: number; rx: number; ry: number; actorIds: string[]; seats: Point[] };
export type SceneActor = Point & { lane: AgentLane; room: string; seat: number };
export type SceneIsland = Point & {
  id: string; cwd: string; label: string; width: number; height: number;
  artWidth: number; artHeight: number; platforms: (Point & { width: number; height: number })[];
  rooms: SceneRoom[]; actors: SceneActor[];
};
export type SceneMemory = Record<string, FloorMicroRoomMemory>;
export type Scene = { islands: SceneIsland[]; memory: SceneMemory };
export const SCENE_STORAGE_KEY = "openscout:observatory-preview:layout:v1";
export const emptyLayout = (): SceneLayout => ({ islands: {}, rooms: {}, actors: {} });
export const roomKey = (island: string, room: string) => JSON.stringify([island, room]);

/** These are composed sizes, not a continuously extruded terrain. Extra rooms
 * use connected platforms in the SAME workspace; no actor is omitted. */
export function buildScene(lanes: readonly AgentLane[], edges: readonly FloorAffinityEdge[], layout: SceneLayout, previous: SceneMemory = {}): Scene {
  const source = buildSharedFloorLayout([...lanes].sort((a, b) => a.id.localeCompare(b.id))).groups.sort((a, b) => a.key.localeCompare(b.key));
  const memory: SceneMemory = {};
  const islands: SceneIsland[] = source.map(group => {
    const pins = Object.fromEntries(group.lanes.flatMap(lane => layout.actors[lane.id] ? [[lane.id, layout.actors[lane.id]!.room]] : []));
    const split = buildFloorMicroRooms(group, edges, previous[group.key], pins, { x: 0, y: 0, width: 1400, height: 800 });
    memory[group.key] = split.memory;
    const automatic = split.rooms.length ? split.rooms : [{ id: "room-1", label: "Commons", actorIds: group.actors.map(actor => actor.lane.id) }];
    const authored = layout.spaces?.[group.key];
    const memberships: RoomMembership[] = authored?.length
      ? authored.map(room => ({ ...room, actorIds: [] })) : automatic;
    if (authored?.length) {
      // Explicit rooms survive emptying and roster shrink. Pins win; newcomers
      // join their strongest known collaborators, or the least occupied room.
      const pending: string[] = [];
      for (const lane of group.lanes) {
        const destination = pins[lane.id] ?? authored.find(room => room.actorIds.includes(lane.id))?.id;
        const room = memberships.find(room => room.id === destination);
        if (room) room.actorIds.push(lane.id); else pending.push(lane.id);
      }
      for (const id of pending.sort()) {
        const affinity = (room: RoomMembership) => edges.reduce((score, edge) => score + (
          edge.from === id && room.actorIds.includes(edge.to) || edge.to === id && room.actorIds.includes(edge.from) ? edge.weight : 0
        ), 0);
        let room = memberships.filter(room => room.actorIds.length < 4).sort((a, b) => affinity(b) - affinity(a) || a.actorIds.length - b.actorIds.length || a.id.localeCompare(b.id))[0];
        if (!room) { const id = nextRoomId(memberships); room = { id, label: `Room ${id.slice(5)}`, actorIds: [] }; memberships.push(room); }
        room.actorIds.push(id);
      }
    }
    const width = memberships.length === 1 ? 900 : memberships.length === 2 ? 1140 : 1320;
    const height = width * 809 / 647;
    const platformCount = Math.ceil(memberships.length / 3);
    const platforms = Array.from({ length: platformCount }, (_, i) => ({ x: i * (width * .84), y: i % 2 ? height * .13 : 0, width, height }));
    const anchors = memberships.length === 1 ? [[.5, .46]] : memberships.length === 2 ? [[.34, .46], [.66, .46]] : [[.34, .425], [.66, .425], [.5, .535]];
    const occupied = new Set<number>();
    const slots = new Map<string, number>();
    for (const room of memberships) {
      const slot = layout.rooms[roomKey(group.key, room.id)];
      if (Number.isInteger(slot) && slot! >= 0 && slot! < memberships.length && !occupied.has(slot!)) { occupied.add(slot!); slots.set(room.id, slot!); }
    }
    for (const room of memberships) if (!slots.has(room.id)) {
      let slot = 0; while (occupied.has(slot)) slot++;
      occupied.add(slot); slots.set(room.id, slot);
    }
    const rooms: SceneRoom[] = memberships.map(room => {
      const slot = slots.get(room.id)!;
      const platform = platforms[Math.floor(slot / 3)]!;
      const anchor = anchors[slot % 3]!;
      const placed = layout.roomPositions?.[roomKey(group.key, room.id)];
      const x = placed?.x ?? platform.x + anchor[0]! * width, y = placed?.y ?? platform.y + anchor[1]! * height;
      const single = memberships.length === 1;
      const rx = width * (single ? .28 : .145), ry = height * (single ? .087 : .056);
      // A manual overfull room retains everyone, widening its seat grid. Normal
      // drag drops swap occupied seats, keeping the authored room capacity.
      const capacity = Math.max(single ? 6 : 4, room.actorIds.length);
      const cols = Math.ceil(capacity / 2);
      const seats = Array.from({ length: capacity }, (_, index) => ({
        x: x + ((index % cols) - (cols - 1) / 2) * Math.min(112, rx * 1.3 / Math.max(1, cols - 1)),
        y: y + (Math.floor(index / cols) - .5) * Math.min(80, ry * .9),
      }));
      return { id: room.id, label: room.label, actorIds: room.actorIds, slot, x, y, rx, ry, seats };
    });
    const actors: SceneActor[] = [];
    for (const room of rooms) {
      const taken = new Set<number>();
      const assignments = new Map<string, number>();
      for (const id of [...room.actorIds].sort()) {
        const pin = layout.actors[id];
        if (pin?.room === room.id && pin.seat >= 0 && pin.seat < room.seats.length && !taken.has(pin.seat)) { assignments.set(id, pin.seat); taken.add(pin.seat); }
      }
      for (const id of room.actorIds) {
        let seat = assignments.get(id);
        if (seat === undefined) { seat = 0; while (taken.has(seat)) seat++; taken.add(seat); }
        const lane = group.lanes.find(lane => lane.id === id)!;
        const free = layout.actorPositions?.[id];
        actors.push({ lane, room: room.id, seat, ...(free ? { x: room.x + free.x, y: room.y + free.y } : room.seats[seat]!) });
      }
    }
    return {
      id: group.key, cwd: group.cwd, label: group.cwd.split("/").filter(Boolean).at(-1) || "Unassigned",
      x: 0, y: 0, width: platforms.at(-1)!.x + width, height: height + (platformCount > 1 ? height * .13 : 0) + 60,
      artWidth: width, artHeight: height, platforms, rooms, actors,
    };
  });
  // Manual islands are obstacles. Automatically placed neighbours settle around
  // them only after a drop; the gesture holds a frozen scene during movement.
  const placed: SceneIsland[] = [];
  for (const island of islands) if (layout.islands[island.id]) { Object.assign(island, layout.islands[island.id]); placed.push(island); }
  const rowWidth = Math.max(2700, ...islands.map(island => island.width));
  let x = 0, y = 0, rowHeight = 0;
  for (const island of islands) {
    if (layout.islands[island.id]) continue;
    if (x && x + island.width > rowWidth) { x = 0; y += rowHeight + 80; rowHeight = 0; }
    let candidate = { ...island, x, y };
    while (placed.some(other => intersects(candidate, other))) {
      candidate.y = Math.max(...placed.filter(other => intersects(candidate, other)).map(other => other.y + other.height + 80));
    }
    Object.assign(island, { x: candidate.x, y: candidate.y }); placed.push(island);
    x = island.x + island.width + 100; y = island.y; rowHeight = Math.max(rowHeight, island.height);
  }
  return { islands, memory };
}

function intersects(a: SceneIsland, b: SceneIsland) {
  return a.x < b.x + b.width + 60 && a.x + a.width + 60 > b.x && a.y < b.y + b.height + 40 && a.y + a.height + 40 > b.y;
}
export function sceneBounds(scene: Scene) {
  if (!scene.islands.length) return { x: 0, y: 0, width: 900, height: 1000 };
  const boxes = scene.islands.flatMap(island => [
    { x: island.x, y: island.y, width: island.width, height: island.height },
    ...island.rooms.map(room => ({ x: island.x + room.x - room.rx, y: island.y + room.y - room.ry, width: room.rx * 2, height: room.ry * 2 + 60 })),
    ...island.actors.map(actor => ({ x: island.x + actor.x - 65, y: island.y + actor.y - 100, width: 130, height: 130 })),
  ]);
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}
export function fitScene(scene: Scene, size: { width: number; height: number }): Camera {
  const bounds = sceneBounds(scene);
  const scale = Math.max(.08, Math.min(1.15, (size.width - 90) / bounds.width, (size.height - 110) / bounds.height));
  return { scale, x: (size.width - bounds.width * scale) / 2 - bounds.x * scale, y: (size.height - bounds.height * scale) / 2 - bounds.y * scale + 15 };
}
export function worldPoint(point: Point, camera: Camera): Point { return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }; }
export function zoomAt(camera: Camera, point: Point, factor: number): Camera {
  const before = worldPoint(point, camera), scale = Math.min(2.5, Math.max(.08, camera.scale * factor));
  return { scale, x: point.x - before.x * scale, y: point.y - before.y * scale };
}
export function roomAt(island: SceneIsland, point: Point): SceneRoom | undefined {
  return island.rooms.find(room => ((point.x - room.x) / room.rx) ** 2 + ((point.y - room.y) / room.ry) ** 2 <= 1);
}
export function nearestSeat(room: SceneRoom, point: Point): number {
  return room.seats.reduce((best, seat, index) => Math.hypot(seat.x - point.x, seat.y - point.y) < Math.hypot(room.seats[best]!.x - point.x, room.seats[best]!.y - point.y) ? index : best, 0);
}
export function moveActor(layout: SceneLayout, island: SceneIsland, actorId: string, room: SceneRoom, seat: number): SceneLayout {
  const actor = island.actors.find(actor => actor.lane.id === actorId);
  if (!actor || !room.seats[seat]) return layout;
  const occupant = island.actors.find(actor => actor.room === room.id && actor.seat === seat && actor.lane.id !== actorId);
  const actors = { ...layout.actors, [actorId]: { room: room.id, seat } };
  if (occupant) actors[occupant.lane.id] = { room: actor.room, seat: actor.seat };
  const actorPositions = { ...layout.actorPositions };
  delete actorPositions[actorId];
  if (occupant) delete actorPositions[occupant.lane.id];
  return { ...layout, actors, actorPositions };
}
export function moveRoom(layout: SceneLayout, island: SceneIsland, roomId: string, target: SceneRoom): SceneLayout {
  const room = island.rooms.find(room => room.id === roomId);
  if (!room || room.id === target.id) return layout;
  const sourceKey = roomKey(island.id, room.id), targetKey = roomKey(island.id, target.id);
  const free = layout.roomPositions?.[sourceKey] || layout.roomPositions?.[targetKey];
  return { ...layout, rooms: { ...layout.rooms, [sourceKey]: target.slot, [targetKey]: room.slot },
    ...(free ? { roomPositions: { ...layout.roomPositions, [sourceKey]: { x: target.x, y: target.y }, [targetKey]: { x: room.x, y: room.y } } } : {}) };
}

function retainSpaces(layout: SceneLayout, island: SceneIsland): SceneLayout {
  return { ...layout, spaces: { ...layout.spaces, [island.id]: island.rooms.map(({ id, label, actorIds }) => ({ id, label, actorIds: [...actorIds] })) } };
}
export function placeRoom(layout: SceneLayout, island: SceneIsland, roomId: string, point: Point): SceneLayout {
  if (!island.rooms.some(room => room.id === roomId)) return layout;
  return { ...retainSpaces(layout, island), roomPositions: { ...layout.roomPositions, [roomKey(island.id, roomId)]: point } };
}
export function placeActor(layout: SceneLayout, island: SceneIsland, actorId: string, point: Point, roomId?: string): SceneLayout {
  const actor = island.actors.find(actor => actor.lane.id === actorId);
  const room = island.rooms.find(room => room.id === (roomId ?? actor?.room));
  if (!actor || !room) return layout;
  const occupied = new Set(island.actors.filter(other => other.lane.id !== actorId && other.room === room.id).map(other => other.seat));
  let seat = actor.room === room.id ? actor.seat : 0;
  while (occupied.has(seat)) seat++;
  return { ...retainSpaces(layout, island), actors: { ...layout.actors, [actorId]: { room: room.id, seat } },
    actorPositions: { ...layout.actorPositions, [actorId]: { x: point.x - room.x, y: point.y - room.y } } };
}
export function swapActors(layout: SceneLayout, island: SceneIsland, actorId: string, targetId: string): SceneLayout {
  const actor = island.actors.find(actor => actor.lane.id === actorId), target = island.actors.find(actor => actor.lane.id === targetId);
  if (!actor || !target || actor === target) return layout;
  const from = island.rooms.find(room => room.id === actor.room)!, to = island.rooms.find(room => room.id === target.room)!;
  return { ...retainSpaces(layout, island), actors: { ...layout.actors, [actorId]: { room: target.room, seat: target.seat }, [targetId]: { room: actor.room, seat: actor.seat } },
    actorPositions: { ...layout.actorPositions, [actorId]: { x: target.x - to.x, y: target.y - to.y }, [targetId]: { x: actor.x - from.x, y: actor.y - from.y } } };
}

function nextRoomId(rooms: readonly RoomMembership[]) {
  let number = 1; while (rooms.some(room => room.id === `room-${number}`)) number++;
  return `room-${number}`;
}
export function createRoom(layout: SceneLayout, island: SceneIsland): { layout: SceneLayout; roomId: string } {
  const rooms = island.rooms.map(({ id, label, actorIds }) => ({ id, label, actorIds: [...actorIds] }));
  const roomId = nextRoomId(rooms);
  rooms.push({ id: roomId, label: `Room ${roomId.slice(5)}`, actorIds: [] });
  return { roomId, layout: { ...layout, spaces: { ...layout.spaces, [island.id]: rooms } } };
}
export function removeEmptyRoom(layout: SceneLayout, island: SceneIsland, roomId: string): SceneLayout {
  if (island.rooms.length < 2 || !island.rooms.some(room => room.id === roomId && !room.actorIds.length)) return layout;
  const rooms = island.rooms.filter(room => room.id !== roomId).map(({ id, label, actorIds }) => ({ id, label, actorIds: [...actorIds] }));
  const roomPositions = { ...layout.roomPositions }; delete roomPositions[roomKey(island.id, roomId)];
  return { ...layout, spaces: { ...layout.spaces, [island.id]: rooms }, roomPositions };
}

/** The preview never reads or migrates the production floor's storage keys. */
export function parseLayout(raw: string | null): SceneLayout {
  const result = emptyLayout();
  try {
    const value = JSON.parse(raw || "null");
    if (!value || typeof value !== "object") return result;
    for (const [id, point] of Object.entries(value.islands ?? {}) as [string, any][]) {
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 100000 && Math.abs(point.y) < 100000) Object.defineProperty(result.islands, id, { value: { x: point.x, y: point.y }, enumerable: true, configurable: true, writable: true });
    }
    for (const [id, slot] of Object.entries(value.rooms ?? {})) if (Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < 10000) Object.defineProperty(result.rooms, id, { value: slot, enumerable: true, configurable: true, writable: true });
    for (const [id, pin] of Object.entries(value.actors ?? {}) as [string, any][]) if (pin && /^room-\d+$/.test(pin.room) && Number.isInteger(pin.seat) && pin.seat >= 0 && pin.seat < 1000) Object.defineProperty(result.actors, id, { value: { room: pin.room, seat: pin.seat }, enumerable: true, configurable: true, writable: true });
    for (const field of ["roomPositions", "actorPositions"] as const) {
      for (const [id, point] of Object.entries(value[field] ?? {}) as [string, any][]) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1000000 || Math.abs(point.y) > 1000000) continue;
        result[field] ??= {};
        Object.defineProperty(result[field], id, { value: { x: point.x, y: point.y }, enumerable: true, configurable: true, writable: true });
      }
    }
    for (const [island, rooms] of Object.entries(value.spaces ?? {})) {
      if (!Array.isArray(rooms)) continue;
      const ids = new Set<string>();
      const valid = rooms.filter(room => room && typeof room.id === "string" && /^room-\d+$/.test(room.id) && !ids.has(room.id) && ids.add(room.id)).map(room => ({ id: room.id, label: typeof room.label === "string" ? room.label.slice(0, 60) : `Room ${room.id.slice(5)}`, actorIds: Array.isArray(room.actorIds) ? [...new Set(room.actorIds.filter((id: unknown): id is string => typeof id === "string"))] as string[] : [] }));
      if (valid.length) { result.spaces ??= {}; Object.defineProperty(result.spaces, island, { value: valid, enumerable: true, configurable: true, writable: true }); }
    }
  } catch { /* A malformed preview save cannot affect either scene. */ }
  return result;
}

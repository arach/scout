import type { SharedFloorLayoutGroup } from "./shared-floor-layout.ts";
import { TERRAIN_TILE, terraceFor } from "./world-terrain.ts";

/** Crowded workspaces split into small rooms on the same terrace. Grouping is
 * evidence-only (real exchange edges), deterministic, and sticky: a refresh that
 * nudges weights never reshuffles people. Manual placement always wins. */

export const MICRO_ROOM_THRESHOLD = 7;
export const MICRO_ROOM_CAPACITY = 4;
/** Feet of the 84px actor box, relative to its group-local x/y. */
export const FLOOR_ACTOR_FEET = { x: 42, y: 84 } as const;
const ACTOR_WIDTH = 84;
const CENTER_Y = 70;
export const MICRO_ROOM_GAP = 56;
const ROOM_GAP = MICRO_ROOM_GAP;
const MIN_ROOM_GAP = 48;
const ROOM_PAD = 18;
/** An actor leaves its remembered room only for clearly stronger evidence. */
const MOVE_RATIO = 2;
const MOVE_MARGIN = 3;

export type FloorAffinityEdge = { from: string; to: string; weight: number };
export type FloorMicroRoom = { id: string; label: string; actorIds: string[]; x: number; y: number; width: number; height: number };
/** JSON-safe; store one per group key. */
export type FloorMicroRoomMemory = { groupKey: string; rooms: { id: string; actorIds: string[] }[] };
type Actor = SharedFloorLayoutGroup["actors"][number];
/** Group-local walkable rectangle rooms must fit (terrace or painted deck). */
export type FloorMicroRoomBounds = { x: number; y: number; width: number; height: number };
export type FloorMicroRoomLayout = { rooms: FloorMicroRoom[]; actors: Actor[]; memory: FloorMicroRoomMemory };

const roomNumber = (id: string) => { const match = /^room-(\d+)$/.exec(id); return match ? Number(match[1]) : null; };
const compareRoomIds = (a: string, b: string) => {
  const na = roomNumber(a), nb = roomNumber(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Undirected, summed, finite positive weights between present actors only. */
export function floorAffinity(edges: readonly FloorAffinityEdge[], present: ReadonlySet<string>) {
  const weights = new Map<string, Map<string, number>>();
  const add = (a: string, b: string, w: number) => {
    const row = weights.get(a) ?? new Map<string, number>();
    row.set(b, (row.get(b) ?? 0) + w);
    weights.set(a, row);
  };
  for (const edge of edges) {
    if (edge.from === edge.to || !present.has(edge.from) || !present.has(edge.to)) continue;
    if (!Number.isFinite(edge.weight) || edge.weight <= 0) continue;
    add(edge.from, edge.to, edge.weight);
    add(edge.to, edge.from, edge.weight);
  }
  return (a: string, b: string) => weights.get(a)?.get(b) ?? 0;
}

export function buildFloorMicroRooms(
  group: SharedFloorLayoutGroup,
  edges: readonly FloorAffinityEdge[],
  previous?: FloorMicroRoomMemory,
  assignments: Readonly<Record<string, string>> = {},
  bounds: FloorMicroRoomBounds = floorTerraceLocal(group),
): FloorMicroRoomLayout {
  const ids = group.actors.map(actor => actor.lane.id);
  const remembered = previous?.groupKey === group.key ? previous.rooms : [];
  if (ids.length < MICRO_ROOM_THRESHOLD) {
    // Keep prior rooms so a crew dipping to 6 and back does not reshuffle.
    return { rooms: [], actors: group.actors, memory: { groupKey: group.key, rooms: remembered.map(room => ({ id: room.id, actorIds: [...room.actorIds] })) } };
  }
  const present = new Set(ids);
  const affinity = floorAffinity(edges, present);
  const strength = new Map(ids.map(id => [id, ids.reduce((sum, other) => sum + affinity(id, other), 0)]));

  const members = new Map<string, string[]>();
  const manual = new Map<string, string>();
  for (const id of [...ids].sort(byId)) {
    const room = assignments[id]?.trim();
    if (!room) continue;
    manual.set(id, room);
    members.set(room, [...(members.get(room) ?? []), id]);
  }
  const auto = ids.filter(id => !manual.has(id));
  const needed = Math.ceil(ids.length / MICRO_ROOM_CAPACITY);
  const capacityLeft = (room: string) => Math.max(0, MICRO_ROOM_CAPACITY - (members.get(room)?.length ?? 0));

  // Room set: manual rooms, then remembered rooms (fullest first), then fresh
  // room-N ids, until there are enough rooms and enough automatic capacity.
  const previousRoom = new Map<string, string>();
  for (const room of remembered) for (const id of room.actorIds) if (present.has(id) && !manual.has(id)) previousRoom.set(id, room.id);
  const rememberedRooms = remembered
    .map(room => ({ id: room.id, kept: room.actorIds.filter(id => previousRoom.get(id) === room.id).length }))
    .filter(room => !members.has(room.id))
    .sort((a, b) => b.kept - a.kept || compareRoomIds(a.id, b.id));
  const autoCapacity = () => [...members.keys()].reduce((sum, room) => sum + capacityLeft(room), 0);
  for (const room of rememberedRooms) {
    if (members.size >= needed && autoCapacity() >= auto.length) break;
    if (room.kept > 0) members.set(room.id, []);
  }
  let next = 1;
  while (members.size < needed || autoCapacity() < auto.length) {
    while (members.has(`room-${next}`)) next++;
    members.set(`room-${next}`, []);
  }
  const autoRooms = () => [...members.keys()];

  // 1. Hysteresis: remembered members return, strongest ties first when a room shrank.
  const placed = new Set<string>();
  const roomAffinity = (id: string, room: string) => (members.get(room) ?? []).reduce((sum, other) => sum + (other === id ? 0 : affinity(id, other)), 0);
  const returning = auto.filter(id => members.has(previousRoom.get(id) ?? "\u0000"));
  const rememberedAffinity = (id: string) => remembered.find(room => room.id === previousRoom.get(id))!.actorIds.reduce((sum, other) => sum + (other === id ? 0 : affinity(id, other)), 0);
  for (const id of returning.sort((a, b) => rememberedAffinity(b) - rememberedAffinity(a) || byId(a, b))) {
    const room = previousRoom.get(id)!;
    if (capacityLeft(room) > 0) { members.get(room)!.push(id); placed.add(id); }
  }

  // 2. Evidence moves: leave only for a clearly stronger room with space.
  for (const id of [...placed].sort(byId)) {
    const current = previousRoom.get(id)!;
    const here = roomAffinity(id, current);
    let best: { room: string; score: number } | undefined;
    for (const room of autoRooms()) {
      if (room === current || capacityLeft(room) === 0) continue;
      const score = roomAffinity(id, room);
      if (!best || score > best.score) best = { room, score };
    }
    if (best && best.score >= here * MOVE_RATIO && best.score - here >= MOVE_MARGIN) {
      members.set(current, members.get(current)!.filter(other => other !== id));
      members.get(best.room)!.push(id);
    }
  }

  // 3. Newcomers: greedy strongest (actor, room) tie; otherwise seed the emptiest room.
  const pending = new Set(auto.filter(id => !placed.has(id)));
  while (pending.size) {
    let pick: { id: string; room: string; score: number } | undefined;
    for (const id of [...pending].sort(byId)) for (const room of autoRooms()) {
      if (capacityLeft(room) === 0) continue;
      const score = roomAffinity(id, room);
      if (score > 0 && (!pick || score > pick.score)) pick = { id, room, score };
    }
    if (!pick) {
      const id = [...pending].sort((a, b) => strength.get(b)! - strength.get(a)! || byId(a, b))[0]!;
      const room = autoRooms().filter(room => capacityLeft(room) > 0)
        .sort((a, b) => members.get(a)!.length - members.get(b)!.length || compareRoomIds(a, b))[0]!;
      pick = { id, room, score: 0 };
    }
    members.get(pick.room)!.push(pick.id);
    pending.delete(pick.id);
  }

  // 4. Balance: automatic rooms below the even share borrow the weakest-tied
  // automatic member of a full room, so 9 actors read 3·3·3 rather than 4·4·1.
  const priorOrder = new Map(remembered.flatMap(room => room.actorIds).map((id, index) => [id, index]));
  // Without evidence, the most recently remembered member moves (newcomers last of all).
  const recency = (id: string) => priorOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  const floorShare = Math.min(3, Math.floor(ids.length / members.size));
  for (let guard = 0; guard < ids.length; guard++) {
    const small = autoRooms().filter(room => ![...members.get(room)!].some(id => manual.has(id)) && members.get(room)!.length < floorShare)
      .sort((a, b) => members.get(a)!.length - members.get(b)!.length || compareRoomIds(a, b))[0];
    if (!small) break;
    let donor: { room: string; id: string; loss: number } | undefined;
    for (const room of autoRooms()) {
      const list = members.get(room)!;
      if (room === small || list.length <= floorShare) continue;
      for (const id of list) {
        if (manual.has(id)) continue;
        const loss = roomAffinity(id, room) - roomAffinity(id, small);
        if (!donor || loss < donor.loss || (loss === donor.loss && (recency(id) > recency(donor.id) || (recency(id) === recency(donor.id) && byId(id, donor.id) > 0)))) donor = { room, id, loss };
      }
    }
    if (!donor) break;
    members.set(donor.room, members.get(donor.room)!.filter(id => id !== donor!.id));
    members.get(small)!.push(donor.id);
  }

  // 5. Swaps: full rooms must not freeze. Exchange two automatic members only
  // when the pair's total in-room affinity at least doubles and rises by the
  // margin. The reverse swap can never qualify, so identical input is a fixed point.
  for (let guard = 0; guard < ids.length; guard++) {
    let best: { a: string; roomA: string; b: string; roomB: string; gain: number } | undefined;
    const rooms = autoRooms().sort(compareRoomIds);
    for (const [i, roomA] of rooms.entries()) for (const roomB of rooms.slice(i + 1)) {
      for (const a of [...members.get(roomA)!].sort(byId)) for (const b of [...members.get(roomB)!].sort(byId)) {
        if (manual.has(a) || manual.has(b)) continue;
        const before = roomAffinity(a, roomA) + roomAffinity(b, roomB);
        const after = roomAffinity(a, roomB) - affinity(a, b) + roomAffinity(b, roomA) - affinity(a, b);
        const gain = after - before;
        if (after >= before * MOVE_RATIO && gain >= MOVE_MARGIN && (!best || gain > best.gain)) best = { a, roomA, b, roomB, gain };
      }
    }
    if (!best) break;
    const { a, roomA, b, roomB } = best;
    members.set(roomA, members.get(roomA)!.map(id => (id === a ? b : id)));
    members.set(roomB, members.get(roomB)!.map(id => (id === b ? a : id)));
  }

  // Empty rooms disappear; stable member order follows memory, then id.
  const order = (a: string, b: string) => (priorOrder.get(a) ?? Infinity) - (priorOrder.get(b) ?? Infinity) || byId(a, b);
  const roomIds = autoRooms().filter(room => members.get(room)!.length).sort(compareRoomIds);
  const frames = roomFrames(bounds, roomIds.length);
  const rooms: FloorMicroRoom[] = roomIds.map((id, index) => {
    const number = roomNumber(id);
    return { id, label: `Room ${number ?? index + 1}`, actorIds: [...members.get(id)!].sort(order), ...frames[index]! };
  });
  const position = new Map<string, { x: number; y: number }>();
  for (const room of rooms) room.actorIds.forEach((id, slot) => position.set(id, actorSlot(room, slot, room.actorIds.length)));
  const actors = group.actors.map(actor => {
    const p = position.get(actor.lane.id)!;
    return { ...actor, x: p.x, y: p.y, centerX: group.x + p.x + ACTOR_WIDTH / 2, centerY: group.y + p.y + CENTER_Y };
  });
  return { rooms, actors, memory: { groupKey: group.key, rooms: rooms.map(room => ({ id: room.id, actorIds: [...room.actorIds] })) } };
}

/** Group-local terrace, the only walkable stone. Rooms never leave it. */
export function floorTerraceLocal(group: SharedFloorLayoutGroup) {
  const t = terraceFor(group);
  return { x: t.left * TERRAIN_TILE - group.x, y: t.top * TERRAIN_TILE - group.y, width: (t.right - t.left + 1) * TERRAIN_TILE, height: (t.bottom - t.top + 1) * TERRAIN_TILE };
}

/** Row-major grid with grass gaps; picks the column count whose rooms are
 * closest to a gently wide shape. Gaps shrink to 48 before rooms get cramped. */
function roomFrames(terrace: FloorMicroRoomBounds, count: number) {
  if (!count) return [];
  let best: { cols: number; rows: number; gap: number; score: number } | undefined;
  for (const gap of [ROOM_GAP, MIN_ROOM_GAP]) {
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const w = (terrace.width - (cols - 1) * gap) / cols, h = (terrace.height - (rows - 1) * gap) / rows;
      if (w <= 0 || h <= 0) continue;
      const fits = w >= ACTOR_WIDTH * 2 + ROOM_PAD * 2 && h >= 110 + ROOM_PAD * 2;
      const score = (fits ? 0 : 100) + Math.abs(Math.log(w / h / 1.3)) + (cols * rows - count) * .35;
      if (!best || score < best.score) best = { cols, rows, gap, score };
    }
    if (best && best.score < 100) break;
  }
  const { cols, rows, gap } = best ?? { cols: count, rows: 1, gap: MIN_ROOM_GAP };
  const w = Math.max(1, (terrace.width - (cols - 1) * gap) / cols), h = Math.max(1, (terrace.height - (rows - 1) * gap) / rows);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / cols), inRow = Math.min(cols, count - row * cols);
    // A short last row is centred rather than left-hanging.
    const offset = (cols - inRow) * (w + gap) / 2;
    return { x: Math.round(terrace.x + offset + (i % cols) * (w + gap)), y: Math.round(terrace.y + row * (h + gap)), width: Math.floor(w), height: Math.floor(h) };
  });
}

/** Feet spread evenly inside the padded room; the box never matters, only feet. */
function actorSlot(room: Pick<FloorMicroRoom, "x" | "y" | "width" | "height">, slot: number, count: number) {
  const cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols);
  const pad = Math.min(ROOM_PAD, room.width / 4, room.height / 4);
  const innerW = room.width - pad * 2, innerH = room.height - pad * 2;
  const row = Math.floor(slot / cols), inRow = Math.min(cols, count - row * cols);
  const fx = room.x + pad + innerW * ((slot % cols) + .5 + (cols - inRow) / 2) / cols;
  const fy = room.y + pad + innerH * (row + .5) / rows;
  return { x: Math.round(fx - FLOOR_ACTOR_FEET.x), y: Math.round(fy - FLOOR_ACTOR_FEET.y) };
}

/** Drop target for a dragged actor (group-local x/y of its box). Returns the
 * room under its feet, else the nearest room within `snap`, else null. */
export function floorMicroRoomAtFeet(rooms: readonly Pick<FloorMicroRoom, "id" | "x" | "y" | "width" | "height">[], actorX: number, actorY: number, snap = MIN_ROOM_GAP / 2): string | null {
  const fx = actorX + FLOOR_ACTOR_FEET.x, fy = actorY + FLOOR_ACTOR_FEET.y;
  let nearest: { id: string; distance: number } | undefined;
  for (const room of rooms) {
    const dx = Math.max(room.x - fx, 0, fx - (room.x + room.width));
    const dy = Math.max(room.y - fy, 0, fy - (room.y + room.height));
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return room.id;
    if (distance <= snap && (!nearest || distance < nearest.distance)) nearest = { id: room.id, distance };
  }
  return nearest?.id ?? null;
}


/** Room holding an actor, for its label and members. */
export function floorMicroRoomForActor<T extends Pick<FloorMicroRoom, "actorIds">>(rooms: readonly T[], actorId: string): T | null {
  return rooms.find(room => room.actorIds.includes(actorId)) ?? null;
}

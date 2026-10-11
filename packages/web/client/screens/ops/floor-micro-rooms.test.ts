import { describe, expect, test } from "bun:test";
import type { AgentLane } from "./agent-lanes-model.ts";
import type { SharedFloorLayoutGroup } from "./shared-floor-layout.ts";
import { buildFloorMicroRooms, FLOOR_ACTOR_FEET, floorMicroRoomAtFeet, floorMicroRoomForActor, floorTerraceLocal, type FloorAffinityEdge } from "./floor-micro-rooms.ts";

const lane = (id: string) => ({ id, agent: { name: id }, observe: null }) as unknown as AgentLane;
function group(count: number, height = 1400): SharedFloorLayoutGroup {
  const actors = Array.from({ length: count }, (_, i) => ({ lane: lane(`a${i}`), x: i * 10, y: 0, centerX: 0, centerY: 0 }));
  return { key: "/repo", cwd: "/repo", lanes: actors.map(a => a.lane), x: 400, y: 300, width: 900, height, actors };
}
const roomOf = (rooms: { id: string; actorIds: string[] }[], id: string) => rooms.find(room => room.actorIds.includes(id))?.id;
const pairs = (list: [string, string, number][]): FloorAffinityEdge[] => list.map(([from, to, weight]) => ({ from, to, weight }));

function expectSound(g: SharedFloorLayoutGroup, result: ReturnType<typeof buildFloorMicroRooms>, bounds = floorTerraceLocal(g)) {
  const all = result.rooms.flatMap(room => room.actorIds).sort();
  expect(all).toEqual(g.actors.map(a => a.lane.id).sort());
  expect(result.actors.map(a => a.lane.id)).toEqual(g.actors.map(a => a.lane.id));
  const terrace = bounds;
  for (const room of result.rooms) {
    expect(room.x).toBeGreaterThanOrEqual(terrace.x);
    expect(room.y).toBeGreaterThanOrEqual(terrace.y);
    expect(room.x + room.width).toBeLessThanOrEqual(terrace.x + terrace.width + 1);
    expect(room.y + room.height).toBeLessThanOrEqual(terrace.y + terrace.height + 1);
    for (const id of room.actorIds) {
      const actor = result.actors.find(a => a.lane.id === id)!;
      const fx = actor.x + FLOOR_ACTOR_FEET.x, fy = actor.y + FLOOR_ACTOR_FEET.y;
      expect(fx).toBeGreaterThanOrEqual(room.x); expect(fx).toBeLessThanOrEqual(room.x + room.width);
      expect(fy).toBeGreaterThanOrEqual(room.y); expect(fy).toBeLessThanOrEqual(room.y + room.height);
      expect(floorMicroRoomAtFeet(result.rooms, actor.x, actor.y)).toBe(room.id);
      expect(actor.centerX).toBe(g.x + actor.x + 42);
      expect(actor.centerY).toBe(g.y + actor.y + 70);
    }
  }
  for (const [i, a] of result.rooms.entries()) for (const b of result.rooms.slice(i + 1)) {
    const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
    const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(46);
  }
}

describe("floor micro rooms", () => {
  test("small crews get no rooms and unchanged actors", () => {
    const g = group(6);
    const result = buildFloorMicroRooms(g, pairs([["a0", "a1", 5]]), undefined, { a0: "room-9" });
    expect(result.rooms).toEqual([]);
    expect(result.actors).toBe(g.actors);
  });

  test("crowds split into ceil(n/4) rooms of 3-4, sound geometry, deterministic", () => {
    for (const count of [7, 8, 9, 10, 12, 13]) {
      const g = group(count);
      const result = buildFloorMicroRooms(g, []);
      expect(result.rooms.length).toBe(Math.ceil(count / 4));
      for (const room of result.rooms) { expect(room.actorIds.length).toBeLessThanOrEqual(4); expect(room.actorIds.length).toBeGreaterThanOrEqual(3); }
      expectSound(g, result);
      expect(buildFloorMicroRooms(g, [])).toEqual(result);
      expect(result.rooms.map(r => r.label)).toEqual(result.rooms.map((_, i) => `Room ${i + 1}`));
    }
  });

  test("frequent collaborators share a room; unknown and self edges are ignored", () => {
    const g = group(8);
    const edges = pairs([["a0", "a5", 9], ["a5", "a7", 6], ["a0", "a7", 4], ["a1", "a2", 8], ["a2", "a3", 3], ["a0", "a0", 99], ["a0", "ghost", 99], ["a4", "a6", -5]]);
    const result = buildFloorMicroRooms(g, edges);
    expect(roomOf(result.rooms, "a5")).toBe(roomOf(result.rooms, "a0"));
    expect(roomOf(result.rooms, "a7")).toBe(roomOf(result.rooms, "a0"));
    expect(roomOf(result.rooms, "a2")).toBe(roomOf(result.rooms, "a1"));
    expect(roomOf(result.rooms, "a1")).not.toBe(roomOf(result.rooms, "a0"));
    expectSound(g, result);
  });

  test("weight drift on refresh does not churn; strong new evidence does", () => {
    const g = group(7);
    const first = buildFloorMicroRooms(g, pairs([["a0", "a1", 5], ["a2", "a3", 5]]));
    const drift = buildFloorMicroRooms(g, pairs([["a0", "a1", 6], ["a2", "a3", 4], ["a0", "a2", 2]]), first.memory);
    expect(drift.memory).toEqual(first.memory);
    // Reordered roster with memory keeps rooms too.
    const reordered = { ...g, actors: [...g.actors].reverse() };
    expect(buildFloorMicroRooms(reordered, [], first.memory).memory.rooms).toEqual(first.memory.rooms);
    // Strong new evidence moves an actor into a room with space.
    const full = first.memory.rooms.find(room => room.actorIds.length === 4)!;
    const open = first.memory.rooms.find(room => room.actorIds.length === 3)!;
    const mover = full.actorIds.find(id => !["a0", "a1", "a2", "a3"].includes(id))!;
    const shifted = buildFloorMicroRooms(g, pairs([[mover, open.actorIds[0]!, 6], [mover, open.actorIds[1]!, 6]]), first.memory);
    expect(roomOf(shifted.rooms, mover)).toBe(open.id);
    expectSound(g, shifted);
  });

  test("manual assignments win, including over capacity, and fresh ids are stable", () => {
    const g = group(9);
    const assignments = { a0: "room-1", a1: "room-1", a2: "room-1", a3: "room-1", a4: "room-1", a5: "room-7" };
    const result = buildFloorMicroRooms(g, pairs([["a6", "a5", 9]]), undefined, assignments);
    expect(result.rooms.find(r => r.id === "room-1")!.actorIds.sort()).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(roomOf(result.rooms, "a5")).toBe("room-7");
    expect(roomOf(result.rooms, "a6")).toBe("room-7");
    expectSound(g, result);
  });

  test("growing and shrinking reuse remembered rooms and keep membership", () => {
    const g7 = group(7);
    const first = buildFloorMicroRooms(g7, pairs([["a0", "a1", 5]]));
    const g9 = group(9);
    const grown = buildFloorMicroRooms(g9, pairs([["a0", "a1", 5]]), first.memory);
    expect(grown.rooms.length).toBe(3);
    expect(roomOf(grown.rooms, "a0")).toBe(roomOf(grown.rooms, "a1"));
    for (const room of grown.rooms) expect(room.actorIds.length).toBe(3);
    expectSound(g9, grown);
    const shrunk = buildFloorMicroRooms(group(8), pairs([["a0", "a1", 5]]), grown.memory);
    expect(shrunk.rooms.length).toBe(2);
    expect(roomOf(shrunk.rooms, "a0")).toBe(roomOf(shrunk.rooms, "a1"));
    expectSound(group(8), shrunk);
    // Dipping below the threshold keeps memory for the return.
    const dipped = buildFloorMicroRooms(group(6), [], shrunk.memory);
    expect(dipped.memory.rooms).toEqual(shrunk.memory.rooms);
  });

  test("full rooms swap for clearly stronger new evidence, then hold still", () => {
    const g = group(8);
    const first = buildFloorMicroRooms(g, []);
    const [roomA, roomB] = first.memory.rooms;
    expect(roomA!.actorIds.length).toBe(4); expect(roomB!.actorIds.length).toBe(4);
    // x (in A) talks heavily with B's members; y (in B) has no ties anywhere.
    const x = roomA!.actorIds[0]!, y = roomB!.actorIds[0]!;
    const edges = roomB!.actorIds.slice(1).map((other): [string, string, number] => [x, other, 5]);
    const swapped = buildFloorMicroRooms(g, pairs(edges), first.memory);
    expect(roomOf(swapped.rooms, x)).toBe(roomB!.id);
    expect(roomOf(swapped.rooms, y)).toBe(roomA!.id);
    expect(swapped.rooms.map(room => room.actorIds.length)).toEqual([4, 4]);
    expectSound(g, swapped);
    // Repeating identical input (and its own memory) is a fixed point.
    let memory = swapped.memory;
    for (let i = 0; i < 4; i++) {
      const again = buildFloorMicroRooms(g, pairs(edges), memory);
      expect(again.memory).toEqual(swapped.memory);
      memory = again.memory;
    }
    // Weak evidence (below the 2x/+3 bar) does not swap.
    const weak = buildFloorMicroRooms(g, pairs([[x, roomB!.actorIds[1]!, 2]]), first.memory);
    expect(weak.memory).toEqual(first.memory);
  });

  test("swaps work at 12 and never move manual pins", () => {
    const g = group(12);
    const first = buildFloorMicroRooms(g, []);
    const [roomA, roomB] = first.memory.rooms;
    const x = roomA!.actorIds[0]!;
    const edges = roomB!.actorIds.slice(0, 3).map((other): [string, string, number] => [x, other, 6]);
    const free = buildFloorMicroRooms(g, pairs(edges), first.memory);
    expect(roomOf(free.rooms, x)).toBe(roomB!.id);
    expectSound(g, free);
    // Pinned in place, x stays put, and pinned partners are never swapped out either.
    const pins = { [x]: roomA!.id, [roomB!.actorIds[0]!]: roomB!.id, [roomB!.actorIds[1]!]: roomB!.id, [roomB!.actorIds[2]!]: roomB!.id };
    const pinned = buildFloorMicroRooms(g, pairs(edges), first.memory, pins);
    expect(roomOf(pinned.rooms, x)).toBe(roomA!.id);
    for (const id of roomB!.actorIds.slice(0, 3)) expect(roomOf(pinned.rooms, id)).toBe(roomB!.id);
    expectSound(g, pinned);
  });

  test("painted floating-deck bounds override the terrace", () => {
    const g = group(10);
    const deck = { x: 60, y: 210, width: 360 * 2 + 64, height: 240 * 2 + 64 };
    const result = buildFloorMicroRooms(g, pairs([["a0", "a9", 4]]), undefined, {}, deck);
    expect(result.rooms.length).toBe(3);
    expectSound(g, result, deck);
    const room = floorMicroRoomForActor(result.rooms, "a9")!;
    expect(room.actorIds).toContain("a0");
    expect(room.label).toMatch(/^Room \d+$/);
    expect(floorMicroRoomForActor(result.rooms, "ghost")).toBeNull();
  });

  test("hit test snaps across the grass gap and rejects open space", () => {
    const rooms = [{ id: "room-1", x: 0, y: 0, width: 200, height: 160 }, { id: "room-2", x: 256, y: 0, width: 200, height: 160 }];
    expect(floorMicroRoomAtFeet(rooms, 300 - 42, 80 - 84)).toBe("room-2");
    expect(floorMicroRoomAtFeet(rooms, 210 - 42, 80 - 84)).toBe("room-1");
    expect(floorMicroRoomAtFeet(rooms, 600, 600)).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { buildSharedFloorLayout } from "./shared-floor-layout.ts";
import { buildFloorMicroRooms } from "./floor-micro-rooms.ts";
import type { AgentLane } from "./agent-lanes-model.ts";
import { parseWorldRoomLayout, roomPlacementAt, roomPlacedActor } from "./world-room-layout.ts";

describe("saved room placements", () => {
  test("corrupt storage is ignored; valid rooms survive invalid neighbors", () => {
    for (const raw of [null, "oops", "[]", "null", "12"]) expect(parseWorldRoomLayout(raw)).toEqual({});
    expect(parseWorldRoomLayout(JSON.stringify({ workspace: { a: { roomId: "room-2", u: -.2, v: 2 }, b: null, c: { roomId: 3 }, d: { roomId: "room-1" } } }))).toEqual({ workspace: { a: { roomId: "room-2", u: 0, v: 1 }, d: { roomId: "room-1" } } });
  });
  test("a drop round trips and remains inside a growing or moved room", () => {
    const room = { id: "room-2", x: 100, y: 150, width: 350, height: 260 };
    const feet = { x: 230, y: 300 };
    const saved = roomPlacementAt(room, feet);
    const point = roomPlacedActor(room, saved)!;
    expect(point.x + 42).toBeCloseTo(feet.x); expect(point.y + 84).toBeCloseTo(feet.y);
    const grown = { ...room, x: 300, width: 600, height: 400 };
    const moved = roomPlacedActor(grown, saved)!;
    expect(moved.x + 42).toBeGreaterThan(grown.x); expect(moved.x + 42).toBeLessThan(grown.x + grown.width);
    expect(moved.y + 84).toBeGreaterThan(grown.y); expect(moved.y + 84).toBeLessThan(grown.y + grown.height);
    const clipped = roomPlacedActor(room, roomPlacementAt(room, { x: -10000, y: 10000 }))!;
    expect(clipped.x + 42).toBeGreaterThan(room.x); expect(clipped.y + 84).toBeLessThan(room.y + room.height);
    expect(roomPlacedActor(room, { roomId: room.id })).toBeNull();
  });
});


test("real packed islands reserve sufficient room for both surface styles", () => {
  for (const count of [7, 8, 10, 12, 13, 20, 40]) for (const style of ["terrain", "illustrated"] as const) {
    const lanes = Array.from({ length: count }, (_, i) => ({ id: `a${i}`, agent: { name: `a${i}`, cwd: "/repo" }, observe: null }) as AgentLane);
    const packed = buildSharedFloorLayout(lanes, undefined, { microRooms: style });
    const group = packed.groups[0]!;
    const bounds = style === "illustrated" ? { x: group.width * .22, y: group.height * .36, width: group.width * .56, height: group.height * .22 } : undefined;
    const rooms = buildFloorMicroRooms(group, [], undefined, {}, bounds);
    expect(rooms.actors.length).toBe(count);
    for (const room of rooms.rooms) { expect(room.width).toBeGreaterThanOrEqual(204); expect(room.height).toBeGreaterThanOrEqual(146); }
    for (const [i, actor] of rooms.actors.entries()) for (const other of rooms.actors.slice(i + 1)) {
      expect(Math.abs(actor.x - other.x) >= 84 || Math.abs(actor.y - other.y) >= 70).toBe(true);
    }
  }
});

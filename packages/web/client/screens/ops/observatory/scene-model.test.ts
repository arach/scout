import { describe, expect, test } from "bun:test";
import type { AgentLane } from "../agent-lanes-model.ts";
import { buildScene, createRoom, emptyLayout, fitScene, moveActor, moveRoom, removeEmptyRoom, nearestSeat, parseLayout, roomAt, SCENE_STORAGE_KEY, worldPoint, zoomAt } from "./scene-model.ts";
import { dropDescription, gestureDestination, type Gesture } from "./scene-interaction.ts";

const lanesFor = (count: number, cwd = "/repo") => Array.from({ length: count }, (_, index) => ({ id: `${cwd}:actor-${index}`, agent: { name: `Actor ${index}`, cwd }, observe: null } as AgentLane));

describe("bounded illustrated scene", () => {
  test("explicit rooms can be created for two people and retain empty spaces after reload and departure", () => {
    const lanes = lanesFor(2), initial = buildScene(lanes, [], emptyLayout()).islands[0]!;
    const created = createRoom(emptyLayout(), initial);
    const restored = parseLayout(JSON.stringify(created.layout));
    const island = buildScene(lanes, [], restored).islands[0]!;
    expect(island.rooms).toHaveLength(2);
    const room = island.rooms.find(room => room.id === created.roomId)!;
    expect(room.actorIds).toEqual([]);
    const placed = moveActor(restored, island, lanes[0]!.id, room, 0);
    const reloaded = buildScene(lanes, [], parseLayout(JSON.stringify(placed))).islands[0]!;
    expect(reloaded.actors.find(actor => actor.lane.id === lanes[0]!.id)?.room).toBe(created.roomId);
    const departed = buildScene([lanes[1]!], [], placed).islands[0]!;
    expect(departed.rooms.find(room => room.id === created.roomId)?.actorIds).toEqual([]);
    expect(departed.rooms).toHaveLength(2);
    const removed = removeEmptyRoom(placed, departed, created.roomId);
    expect(buildScene([lanes[1]!], [], removed).islands[0]!.rooms).toHaveLength(1);
    expect(removeEmptyRoom(placed, reloaded, created.roomId)).toBe(placed);
  });
  test("newcomers fill explicit spaces without losing actors or widening artwork", () => {
    const original = lanesFor(2), initial = buildScene(original, [], emptyLayout()).islands[0]!;
    const created = createRoom(emptyLayout(), initial);
    const lanes = lanesFor(25), island = buildScene(lanes, [{ from: lanes[2]!.id, to: lanes[0]!.id, weight: 10 }], created.layout).islands[0]!;
    expect(island.actors).toHaveLength(25);
    expect(new Set(island.actors.map(actor => actor.lane.id)).size).toBe(25);
    expect(island.artWidth).toBeLessThanOrEqual(1320);
    expect(island.rooms.every(room => room.actorIds.length <= 4)).toBe(true);
  });
  test("keeps every actor on a finite seat, without growing the artwork beyond its largest variant", () => {
    for (const count of [1, 6, 7, 8, 10, 12, 13, 25, 80]) {
      const scene = buildScene(lanesFor(count), [], emptyLayout());
      const island = scene.islands[0]!;
      expect(island.actors).toHaveLength(count);
      expect(island.artWidth).toBeLessThanOrEqual(1320);
      expect(island.platforms).toHaveLength(Math.ceil(island.rooms.length / 3));
      expect(new Set(island.actors.map(actor => `${actor.room}:${actor.seat}`)).size).toBe(count);
      for (const actor of island.actors) {
        expect(Number.isFinite(actor.x) && Number.isFinite(actor.y)).toBe(true);
        expect(roomAt(island, actor)?.id).toBe(actor.room);
        const room = island.rooms.find(room => room.id === actor.room)!;
        expect(nearestSeat(room, actor)).toBe(actor.seat);
      }
    }
  });
  test("roster sorting and live-state updates do not rearrange the scene", () => {
    const lanes = [...lanesFor(12), ...lanesFor(3, "/other")];
    const first = buildScene(lanes, [], emptyLayout());
    const second = buildScene([...lanes].reverse(), [], emptyLayout(), first.memory);
    expect(second).toEqual(first);
  });
  test("affinity still groups known collaborators", () => {
    const lanes = lanesFor(8);
    const edges = [0, 1, 2, 3].flatMap(a => [0, 1, 2, 3].filter(b => b !== a).map(b => ({ from: lanes[a]!.id, to: lanes[b]!.id, weight: 10 })));
    const scene = buildScene(lanes, edges, emptyLayout());
    expect(new Set(scene.islands[0]!.actors.filter(a => lanes.slice(0, 4).some(l => l.id === a.lane.id)).map(a => a.room)).size).toBe(1);
  });
  test("an occupied seat exchanges agents across rooms and survives serialization", () => {
    const lanes = lanesFor(8), scene = buildScene(lanes, [], emptyLayout()), island = scene.islands[0]!;
    const origin = island.actors[0]!, target = island.actors.find(a => a.room !== origin.room)!;
    const room = island.rooms.find(r => r.id === target.room)!;
    const moved = moveActor(emptyLayout(), island, origin.lane.id, room, target.seat);
    const restored = parseLayout(JSON.stringify(moved));
    const next = buildScene(lanes, [], restored, scene.memory).islands[0]!;
    expect(next.actors.find(a => a.lane.id === origin.lane.id)).toMatchObject({ room: target.room, seat: target.seat, x: target.x, y: target.y });
    expect(next.actors.find(a => a.lane.id === target.lane.id)).toMatchObject({ room: origin.room, seat: origin.seat, x: origin.x, y: origin.y });
    expect(new Set(next.actors.map(a => `${a.room}:${a.seat}`)).size).toBe(8);
  });
  test("moving a room exchanges whole groups without changing collaboration membership", () => {
    const lanes = lanesFor(12), first = buildScene(lanes, [], emptyLayout()), island = first.islands[0]!;
    const [a, b] = island.rooms;
    const layout = moveRoom(emptyLayout(), island, a!.id, b!);
    const next = buildScene(lanes, [], layout, first.memory).islands[0]!;
    expect(next.rooms.find(r => r.id === a!.id)).toMatchObject({ x: b!.x, y: b!.y, actorIds: a!.actorIds });
    expect(next.rooms.find(r => r.id === b!.id)).toMatchObject({ x: a!.x, y: a!.y, actorIds: b!.actorIds });
  });
  test("manual island placement is exact and automatic siblings avoid it", () => {
    const lanes = [...lanesFor(8), ...lanesFor(2, "/other")];
    const first = buildScene(lanes, [], emptyLayout()), id = first.islands[0]!.id;
    const next = buildScene(lanes, [], { ...emptyLayout(), islands: { [id]: { x: 100, y: 300 } } });
    const pinned = next.islands.find(i => i.id === id)!, sibling = next.islands.find(i => i.id !== id)!;
    expect(pinned).toMatchObject({ x: 100, y: 300 });
    expect(sibling.x >= pinned.x + pinned.width || sibling.y >= pinned.y + pinned.height).toBe(true);
  });
});

describe("picking and camera coordinates", () => {
  test("drop copy distinguishes a seat swap, group swap, and free placement", () => {
    const scene = buildScene(lanesFor(8), [], emptyLayout()), island = scene.islands[0]!;
    const actor = island.actors[0]!, room = island.rooms.find(room => room.id !== actor.room)!, seat = room.seats[0]!;
    const gesture: Gesture = { pointerId: 1, pick: { kind: "actor", island: island.id, id: actor.lane.id }, start: { x: 0, y: 0 }, point: { x: seat.x - actor.x, y: seat.y - actor.y }, moved: true, camera: { x: 0, y: 0, scale: 1 }, scene, layout: emptyLayout() };
    const occupant = island.actors.find(actor => actor.room === room.id && actor.seat === 0)!;
    const name = (lane: AgentLane) => lane.agent.name;
    expect(dropDescription(gesture, name)).toBe(`Swap places with ${name(occupant.lane)}`);
    expect(dropDescription({ ...gesture, point: { x: -10000, y: 0 } }, name)).toBe(`Place ${name(actor.lane)} here · stays in ${island.rooms.find(room => room.id === actor.room)!.label}`);
    const source = island.rooms.find(room => room.id === actor.room)!;
    expect(dropDescription({ ...gesture, pick: { kind: "room", island: island.id, id: source.id }, point: { x: room.x - source.x, y: room.y - source.y } }, name)).toBe(`Swap ${source.label} with ${room.label} · both groups move`);
  });
  test("zoom preserves the world point under the cursor, at every supported scale", () => {
    for (const scale of [.08, .2, .7, 1.5, 2.5]) {
      const camera = { x: -219, y: 351, scale }, point = { x: 445, y: 223 };
      const before = worldPoint(point, camera), after = worldPoint(point, zoomAt(camera, point, 1.4));
      expect(after.x).toBeCloseTo(before.x, 8); expect(after.y).toBeCloseTo(before.y, 8);
    }
  });
  test("room picking follows the drawn ellipse, not its transparent bounding corners", () => {
    const island = buildScene(lanesFor(12), [], emptyLayout()).islands[0]!, room = island.rooms[0]!;
    expect(roomAt(island, room)?.id).toBe(room.id);
    expect(roomAt(island, { x: room.x - room.rx * .99, y: room.y - room.ry * .99 })).toBeUndefined();
  });
  test("a drag uses its initial scene and grab offset at any zoom", () => {
    const scene = buildScene(lanesFor(8), [], emptyLayout()), island = scene.islands[0]!;
    const origin = island.actors[0]!, room = island.rooms.find(r => r.id !== origin.room)!, seat = room.seats[0]!;
    for (const scale of [.2, .8, 2]) {
      const gesture: Gesture = { pointerId: 1, pick: { kind: "actor", island: island.id, id: origin.lane.id }, start: { x: 500, y: 400 }, point: { x: 500 + (seat.x - origin.x) * scale, y: 400 + (seat.y - origin.y) * scale }, moved: true, camera: { scale, x: -80, y: 100 }, scene, layout: emptyLayout() };
      expect(gestureDestination(gesture)).toMatchObject({ room: { id: room.id }, seat: 0 });
      expect(gestureDestination({ ...gesture, point: { x: -10000, y: -10000 } })).toBeNull();
    }
  });
  test("fit contains all islands with useful margins", () => {
    const scene = buildScene([...lanesFor(12), ...lanesFor(4, "/b")], [], emptyLayout());
    for (const size of [{ width: 1194, height: 834 }, { width: 1600, height: 900 }]) {
      const camera = fitScene(scene, size);
      for (const island of scene.islands) {
        expect(island.x * camera.scale + camera.x).toBeGreaterThan(0);
        expect((island.x + island.width) * camera.scale + camera.x).toBeLessThan(size.width);
        expect((island.y + island.height) * camera.scale + camera.y).toBeLessThan(size.height);
      }
    }
  });
});

test("preview storage rejects malformed values and has no production key", () => {
  expect(SCENE_STORAGE_KEY).toBe("openscout:observatory-preview:layout:v1");
  expect(parseLayout("{broken")).toEqual(emptyLayout());
  expect(parseLayout(JSON.stringify({ islands: { bad: { x: "12", y: 0 } }, rooms: { bad: -1 }, actors: { bad: { room: "unknown", seat: 2 } } }))).toEqual(emptyLayout());
});

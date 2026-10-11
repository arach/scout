import { expect, test } from "bun:test";
import type { AgentLane } from "../agent-lanes-model.ts";
import { buildScene, emptyLayout, fitScene, moveRoom, parseLayout, placeActor, placeRoom, roomKey, type Point, type Scene, type SceneLayout } from "./scene-model.ts";
import { gesturePlacement, layoutAfterGesture, type Gesture, type Pick } from "./scene-interaction.ts";
import { cameraForRoom } from "./scene-camera.ts";
import { minimapGeometry } from "./scene-minimap.ts";

const lanes = Array.from({ length: 8 }, (_, index) => ({ id: `agent-${index}`, agent: { name: `Agent ${index}`, cwd: "/repo" }, observe: null } as AgentLane));
function drag(scene: Scene, layout: SceneLayout, kind: Pick["kind"], id: string, delta: Point, scale = .7): Gesture {
  return { scene, layout, pick: { kind, id, island: scene.islands[0]!.id }, camera: { x: 27, y: -400, scale }, moved: true, pointerId: 1, start: { x: 430, y: 310 }, point: { x: 430 + delta.x * scale, y: 310 + delta.y * scale } };
}

test("an agent released into space keeps its exact position and membership after reload", () => {
  const scene = buildScene(lanes, [], emptyLayout()), island = scene.islands[0]!, actor = island.actors[0]!;
  for (const scale of [.2, 1, 2.5]) {
    const gesture = drag(scene, emptyLayout(), "actor", actor.lane.id, { x: -2500, y: -1500 }, scale);
    expect(gesturePlacement(gesture)?.kind).toBe("actor-place");
    const layout = parseLayout(JSON.stringify(layoutAfterGesture(gesture)));
    const next = buildScene(lanes, [], layout, scene.memory).islands[0]!.actors.find(a => a.lane.id === actor.lane.id)!;
    expect(next.room).toBe(actor.room);
    expect(next.x).toBeCloseTo(actor.x - 2500); expect(next.y).toBeCloseTo(actor.y - 1500);
  }
});

test("moving a room into space carries every member, including a freely placed agent", () => {
  const initial = buildScene(lanes, [], emptyLayout()), original = initial.islands[0]!, actor = original.actors[0]!;
  const pinned = placeActor(emptyLayout(), original, actor.lane.id, { x: -300, y: -200 });
  const scene = buildScene(lanes, [], pinned, initial.memory), island = scene.islands[0]!;
  const room = island.rooms.find(room => room.id === actor.room)!;
  const gesture = drag(scene, pinned, "room", room.id, { x: -2300, y: 2700 });
  expect(gesturePlacement(gesture)?.kind).toBe("room-place");
  const layout = parseLayout(JSON.stringify(layoutAfterGesture(gesture)));
  const next = buildScene(lanes, [], layout, scene.memory).islands[0]!;
  for (const before of island.actors) {
    const after = next.actors.find(a => a.lane.id === before.lane.id)!;
    expect(after.x).toBeCloseTo(before.x + (before.room === room.id ? -2300 : 0));
    expect(after.y).toBeCloseTo(before.y + (before.room === room.id ? 2700 : 0));
  }
  const movedIsland = layoutAfterGesture(drag({ ...scene, islands: [next] }, layout, "island", island.id, { x: 700, y: -900 }));
  const carried = buildScene(lanes, [], movedIsland, scene.memory).islands[0]!;
  expect(carried.x - next.x).toBeCloseTo(700); expect(carried.y - next.y).toBeCloseTo(-900);
  expect(carried.actors).toEqual(next.actors);
});

test("direct drops swap two floating actors; nearby empty space remains free", () => {
  const scene = buildScene(lanes, [], emptyLayout()), island = scene.islands[0]!;
  const source = island.actors[0]!, target = island.actors.find(actor => actor.room !== source.room)!;
  let layout = placeActor(emptyLayout(), island, source.lane.id, { x: -500, y: -800 });
  layout = placeActor(layout, island, target.lane.id, { x: 2100, y: 2200 });
  const floating = buildScene(lanes, [], layout, scene.memory), from = floating.islands[0]!.actors.find(a => a.lane.id === source.lane.id)!, to = floating.islands[0]!.actors.find(a => a.lane.id === target.lane.id)!;
  const gesture = drag(floating, layout, "actor", source.lane.id, { x: to.x - from.x, y: to.y - from.y });
  expect(gesturePlacement(gesture)?.kind).toBe("actor-swap");
  expect(gesturePlacement(drag(floating, layout, "actor", source.lane.id, { x: to.x - from.x + 80, y: to.y - from.y }))?.kind).toBe("actor-place");
  const swapped = buildScene(lanes, [], parseLayout(JSON.stringify(layoutAfterGesture(gesture))), floating.memory).islands[0]!;
  expect(swapped.actors.find(a => a.lane.id === source.lane.id)).toMatchObject({ x: to.x, y: to.y, room: to.room });
  expect(swapped.actors.find(a => a.lane.id === target.lane.id)).toMatchObject({ x: from.x, y: from.y, room: from.room });
});

test("free placements within another room change membership without losing its occupants", () => {
  const scene = buildScene(lanes, [], emptyLayout()), island = scene.islands[0]!;
  const actor = island.actors[0]!, room = island.rooms.find(room => room.id !== actor.room)!;
  const gesture = drag(scene, emptyLayout(), "actor", actor.lane.id, { x: room.x - actor.x, y: room.y - actor.y });
  expect(gesturePlacement(gesture)?.kind).toBe("actor-place");
  const next = buildScene(lanes, [], layoutAfterGesture(gesture), scene.memory).islands[0]!;
  expect(next.actors).toHaveLength(lanes.length);
  const placed = next.actors.find(a => a.lane.id === actor.lane.id)!;
  expect(placed.room).toBe(room.id); expect(placed.x).toBeCloseTo(room.x); expect(placed.y).toBeCloseTo(room.y);
  expect(new Set(next.actors.map(a => `${a.room}:${a.seat}`)).size).toBe(lanes.length);
});

test("floating rooms swap exact positions and survive a roster shrinking below seven", () => {
  const scene = buildScene(lanes, [], emptyLayout()), island = scene.islands[0]!, room = island.rooms[0]!;
  const layout = placeRoom(emptyLayout(), island, room.id, { x: -1900, y: -1400 });
  const floating = buildScene(lanes, [], layout, scene.memory).islands[0]!, a = floating.rooms[0]!, b = floating.rooms[1]!;
  const swapped = moveRoom(layout, floating, a.id, b);
  const next = buildScene(lanes.slice(0, 2), [], parseLayout(JSON.stringify(swapped)), scene.memory).islands[0]!;
  expect(next.rooms).toHaveLength(2);
  expect(next.rooms.find(room => room.id === b.id)).toMatchObject({ x: a.x, y: a.y });
  expect(next.rooms.find(room => room.id === a.id)).toMatchObject({ x: b.x, y: b.y });
});

test("Fit, room travel and minimap include outlying agents and rooms", () => {
  const initial = buildScene(lanes, [], emptyLayout()).islands[0]!, actor = initial.actors[0]!;
  const layout = placeActor(emptyLayout(), initial, actor.lane.id, { x: -2000, y: -1800 });
  const scene = buildScene(lanes, [], layout), island = scene.islands[0]!, placed = island.actors.find(a => a.lane.id === actor.lane.id)!;
  const size = { width: 1194, height: 834 };
  for (const camera of [fitScene(scene, size), cameraForRoom(island, island.rooms.find(room => room.id === actor.room)!, size)]) {
    expect((island.x + placed.x) * camera.scale + camera.x).toBeGreaterThan(0);
    expect((island.y + placed.y - 90) * camera.scale + camera.y).toBeGreaterThan(0);
  }
  const mapped = minimapGeometry(scene).point({ x: island.x + placed.x, y: island.y + placed.y });
  expect(mapped.x).toBeGreaterThan(0); expect(mapped.y).toBeGreaterThan(0);
});

test("free-position parsing ignores non-finite coordinates and preserves existing layout data", () => {
  const key = roomKey("island", "room-1");
  const layout = parseLayout(JSON.stringify({ ...emptyLayout(), roomPositions: { [key]: { x: -80, y: 900 }, bad: { x: "20", y: 0 } }, actorPositions: { bad: { x: null, y: 0 } } }));
  expect(layout.roomPositions).toEqual({ [key]: { x: -80, y: 900 } });
  expect(layout.actorPositions).toBeUndefined();
});

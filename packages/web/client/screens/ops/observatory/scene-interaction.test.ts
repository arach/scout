import { expect, test } from "bun:test";
import type { AgentLane } from "../agent-lanes-model.ts";
import { buildScene, emptyLayout } from "./scene-model.ts";
import { previewRoomAt } from "./scene-interaction.ts";

const scene = buildScene(Array.from({ length: 8 }, (_, index) => ({ id: `agent-${index}`, agent: { name: `Agent ${index}`, cwd: "/one" }, observe: null } as AgentLane)), [], emptyLayout());
const island = scene.islands[0]!;
island.x = -1900; island.y = 650;
const room = island.rooms[0]!;

test("room discovery follows island positions and includes the approach to its grip", () => {
  const expected = { kind: "room" as const, island: island.id, id: room.id };
  expect(previewRoomAt(scene, { x: island.x + room.x, y: island.y + room.y }, null)).toEqual(expected);
  expect(previewRoomAt(scene, { x: island.x + room.x, y: island.y + room.y + room.ry * 1.1 }, null)).toEqual(expected);
  expect(previewRoomAt(scene, { x: island.x - 500, y: island.y }, null)).toBeNull();
});

test("an actual actor or grip takes precedence over underlying scenery", () => {
  const actor = island.actors.at(-1)!;
  const point = { x: island.x + room.x, y: island.y + room.y };
  expect(previewRoomAt(scene, point, { kind: "actor", island: island.id, id: actor.lane.id })).toEqual({ kind: "room", island: island.id, id: actor.room });
  const grip = { kind: "room" as const, island: island.id, id: actor.room };
  expect(previewRoomAt(scene, point, grip)).toEqual(grip);
  expect(previewRoomAt(scene, point, { kind: "island", island: island.id, id: island.id })).toEqual({ kind: "room", island: island.id, id: room.id });
});

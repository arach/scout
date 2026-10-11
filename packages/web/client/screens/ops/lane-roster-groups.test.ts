import { expect, test } from "bun:test";
import { groupLaneRoster } from "./lane-roster-groups.ts";
import type { LaneRosterEntry } from "./lane-roster-store.ts";

const lane = (id: string, islandId: string, roomId: string) => ({ id, label: id, floor: { place: { islandId, islandLabel: "openscout", workspace: `/${islandId}/openscout`, roomId, roomLabel: roomId } } }) as LaneRosterEntry;
test("identically named islands stay separate and grouping never loses unplaced agents", () => {
  const groups = groupLaneRoster([lane("a", "checkout-a", "room-1"), lane("b", "checkout-b", "room-1"), lane("c", "checkout-a", "room-2"), { id: "d" } as LaneRosterEntry]);
  expect(groups.map(group => group.count)).toEqual([2, 1, 1]);
  expect(groups[0]!.rooms.map(room => room.entries.map(entry => entry.id))).toEqual([["a"], ["c"]]);
  expect(groups[1]!.rooms[0]!.entries[0]!.id).toBe("b");
  expect(groups[2]!.rooms[0]!.entries[0]!.id).toBe("d");
});

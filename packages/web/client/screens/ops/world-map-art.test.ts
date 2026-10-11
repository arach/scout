import { describe, expect, test } from "bun:test";
import { DAYLIGHT_WORLD_MAPS, ENGRAVED_WORLD_MAPS, WORLD_MAPS, WORLD_TERRAINS, worldMapArt } from "./world-map-art.ts";

describe("world map art", () => {
  test("terrain and platform choices have distinct IDs and themed landmarks", () => {
    const choices = [...WORLD_TERRAINS, ...WORLD_MAPS];
    expect(new Set(choices.map(choice => choice.id)).size).toBe(choices.length);
    expect(worldMapArt("/project", "orchard").map).toBe(DAYLIGHT_WORLD_MAPS[1]);
    expect(worldMapArt("/project", "watergarden").map).toBe(DAYLIGHT_WORLD_MAPS[2]);
  });
  test("each explicit map can be selected independently of workspace identity", () => {
    for (const map of ENGRAVED_WORLD_MAPS) {
      expect(worldMapArt("/project/one", map.id).map).toBe(map);
      expect(worldMapArt("/project/two", map.id).map).toBe(map);
    }
  });
  test("collection assignment is stable and reaches all four maps", () => {
    const keys = Array.from({ length: 32 }, (_, i) => `/project/${i}`);
    const assigned = new Map(keys.map(key => [key, worldMapArt(key, "engraved").map?.id]));
    for (const key of keys.reverse()) expect(worldMapArt(key, "engraved").map?.id).toBe(assigned.get(key));
    expect(new Set(assigned.values()).size).toBe(4);
  });
  test("classic preserves the legacy three-panel crop and sky position", () => {
    expect(worldMapArt("/a", "classic")).toEqual({ map: null, outpostPosition: "0% center", skyPosition: "54% 64%" });
  });
});

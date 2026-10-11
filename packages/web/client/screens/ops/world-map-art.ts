import type { TerrainBiome } from "./world-terrain.ts";

/** Engraved islands share the existing 647 × 809 panel and clear deck contract.
 * Keep this order stable: workspace hashes choose a member of the collection. */
export const ENGRAVED_WORLD_MAPS = [
  { id: "relay-commons", name: "Relay Commons", url: new URL("./assets/world-maps/relay-commons.png", import.meta.url).href },
  { id: "archive-trove", name: "Archive Trove", url: new URL("./assets/world-maps/archive-trove.png", import.meta.url).href },
  { id: "listening-garden", name: "Listening Garden", url: new URL("./assets/world-maps/listening-garden.png", import.meta.url).href },
  { id: "ring-observatory", name: "Ring Observatory", url: new URL("./assets/world-maps/ring-observatory.png", import.meta.url).href },
] as const;

const daylightPlatform = new URL("./assets/world-maps/daylight-platform.png", import.meta.url).href;
export const DAYLIGHT_WORLD_MAPS = [
  { id: "sunroom", name: "Sunroom", url: daylightPlatform, landmarkUrl: new URL("./assets/world-maps/sunroom-landmark.png", import.meta.url).href },
  { id: "orchard-pavilion", name: "Orchard Pavilion", url: daylightPlatform, landmarkUrl: new URL("./assets/world-maps/orchard-landmark.png", import.meta.url).href },
  { id: "kite-harbor", name: "Kite Harbor", url: daylightPlatform, landmarkUrl: new URL("./assets/world-maps/kite-landmark.png", import.meta.url).href },
] as const;

export const WORLD_TERRAINS: readonly { id: TerrainBiome; name: string }[] = [
  { id: "meadow", name: "Meadow Reach" },
  { id: "orchard", name: "Orchard Vale" },
  { id: "watergarden", name: "Water Gardens" },
];
export type WorldMapStyle = "classic" | "engraved" | "daylight" | TerrainBiome | typeof ENGRAVED_WORLD_MAPS[number]["id"] | typeof DAYLIGHT_WORLD_MAPS[number]["id"];
export type WorldMapArtwork = { id: string; name: string; url: string; landmarkUrl?: string };
export const WORLD_MAPS: readonly WorldMapArtwork[] = [...DAYLIGHT_WORLD_MAPS, ...ENGRAVED_WORLD_MAPS];
export const WORLD_MAP_STYLE_KEY = "openscout:world-map-style:v1";

function isWorldMapStyle(value: unknown): value is WorldMapStyle {
  return value === "classic" || value === "engraved" || value === "daylight" || WORLD_MAPS.some(map => map.id === value) || WORLD_TERRAINS.some(map => map.id === value);
}

export function readWorldMapStyle(): WorldMapStyle {
  try {
    const saved = localStorage.getItem(WORLD_MAP_STYLE_KEY);
    if (isWorldMapStyle(saved)) return saved;
  } catch { /* The map still works when browser storage is unavailable. */ }
  return "meadow";
}

export function writeWorldMapStyle(style: WorldMapStyle): void {
  try { localStorage.setItem(WORLD_MAP_STYLE_KEY, style); } catch { /* Session-only selection. */ }
}

export function worldMapTerrain(style: WorldMapStyle): TerrainBiome | undefined {
  return WORLD_TERRAINS.find(map => map.id === style)?.id;
}

/** Stable per workspace, independent of crew order, size, and camera projection. */
export function worldMapArt(key: string, style: WorldMapStyle) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const collection = style === "engraved" ? ENGRAVED_WORLD_MAPS : DAYLIGHT_WORLD_MAPS;
  const map: WorldMapArtwork | null = style === "classic" ? null
    : style === "orchard" ? DAYLIGHT_WORLD_MAPS[1]
    : style === "watergarden" ? DAYLIGHT_WORLD_MAPS[2]
    : WORLD_MAPS.find(candidate => candidate.id === style)
      ?? collection[((Math.imul(hash ^ (hash >>> 16), 2246822507) >>> 0) % collection.length)]!;
  return {
    map,
    outpostPosition: `${(hash % 3) * 50}% center`,
    skyPosition: `${hash % 100}% ${18 + (hash % 58)}%`,
  };
}

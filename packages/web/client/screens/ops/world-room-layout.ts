/** Local room choices belong to the operator, not to the broker's routing model. */
export type WorldRoomPlacement = { roomId: string; u?: number; v?: number };
export type WorldRoomLayout = Record<string, Record<string, WorldRoomPlacement>>;
const KEY = "openscout:world-room-layout:v1";

export function parseWorldRoomLayout(raw: string | null): WorldRoomLayout {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const groups: WorldRoomLayout = Object.create(null);
    for (const [key, entries] of Object.entries(value)) {
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
      const actors: Record<string, WorldRoomPlacement> = Object.create(null);
      for (const [id, entry] of Object.entries(entries)) {
        if (!entry || typeof entry !== "object") continue;
        const point = entry as { roomId?: unknown; u?: unknown; v?: unknown };
        if (typeof point.roomId !== "string" || !point.roomId) continue;
        const placement: WorldRoomPlacement = { roomId: point.roomId };
        if (typeof point.u === "number" && Number.isFinite(point.u) && typeof point.v === "number" && Number.isFinite(point.v)) {
          placement.u = Math.max(0, Math.min(1, point.u)); placement.v = Math.max(0, Math.min(1, point.v));
        }
        actors[id] = placement;
      }
      groups[key] = actors;
    }
    return groups;
  } catch { return {}; }
}
export function readWorldRoomLayout(): WorldRoomLayout {
  try { return parseWorldRoomLayout(globalThis.localStorage?.getItem(KEY) ?? null); } catch { return {}; }
}
export function writeWorldRoomLayout(layout: WorldRoomLayout) {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(layout)); } catch { /* Keep the in-memory choice when storage is unavailable. */ }
}

type RoomBounds = { x: number; y: number; width: number; height: number };
/** Store feet relative to the room so a growing island keeps the user's choice. */
export function roomPlacementAt(room: RoomBounds & { id: string }, feet: { x: number; y: number }): WorldRoomPlacement {
  return { roomId: room.id, u: Math.max(0, Math.min(1, (feet.x - room.x - 48) / Math.max(1, room.width - 96))), v: Math.max(0, Math.min(1, (feet.y - room.y - 50) / Math.max(1, room.height - 85))) };
}
export function roomPlacedActor(room: RoomBounds, placement: WorldRoomPlacement) {
  if (placement.u === undefined || placement.v === undefined) return null;
  return { x: room.x + 48 + placement.u * Math.max(1, room.width - 96) - 42, y: room.y + 50 + placement.v * Math.max(1, room.height - 85) - 84 };
}

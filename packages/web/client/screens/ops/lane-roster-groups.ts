import type { LaneRosterEntry } from "./lane-roster-store.ts";

/** Group the published scene, never infer membership from project labels. */
export function groupLaneRoster(entries: readonly LaneRosterEntry[]) {
  const islands = new Map<string, { id: string; label: string; workspace: string; count: number; rooms: Map<string, { id: string; label: string; entries: LaneRosterEntry[] }> }>();
  for (const entry of entries) {
    const place = entry.floor?.place;
    const id = place?.islandId ?? "unplaced";
    if (!islands.has(id)) islands.set(id, { id, label: place?.islandLabel ?? "Other agents", workspace: place?.workspace ?? "", count: 0, rooms: new Map() });
    const island = islands.get(id)!;
    const roomId = place?.roomId ?? "unplaced";
    if (!island.rooms.has(roomId)) island.rooms.set(roomId, { id: roomId, label: place?.roomLabel ?? "Unassigned", entries: [] });
    island.count++;
    island.rooms.get(roomId)!.entries.push(entry);
  }
  return [...islands.values()].map(island => ({ ...island, rooms: [...island.rooms.values()] }));
}

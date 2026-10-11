import type { FloorMicroRoom } from "./floor-micro-rooms.ts";
const plantingUrl = new URL("./assets/world-maps/garden-planted-lip.webp", import.meta.url).href;

/** Room surfaces share the map plane; plaques and planting stand upright. */
export function FloorMicroRooms({ rooms, width, height, terrain, dropRoom, dragging, onOpen }: {
  rooms: readonly FloorMicroRoom[]; width: number; height: number; terrain: boolean;
  dropRoom: string | null; dragging: boolean; onOpen: (roomId: string) => void;
}) {
  if (!rooms.length) return null;
  return <div className={`shared-floor__micro-rooms${dragging ? " is-receiving" : ""}`}>
    <svg width={width} height={height} aria-hidden="true" className="shared-floor__room-surfaces">
      {rooms.map(room => <g key={room.id} className={dropRoom === room.id ? "is-drop-target" : undefined}>
        {terrain ? <rect x={room.x + 8} y={room.y + 8} width={Math.max(1, room.width - 16)} height={Math.max(1, room.height - 16)} rx="28" className="shared-floor__room-outline" /> : <>
          <ellipse cx={room.x + room.width / 2} cy={room.y + room.height / 2} rx={room.width / 2} ry={room.height / 2} className="shared-floor__room-inlay" />
          <ellipse cx={room.x + room.width / 2} cy={room.y + room.height / 2} rx={Math.max(1, room.width / 2 - 8)} ry={Math.max(1, room.height / 2 - 8)} className="shared-floor__room-outline" />
        </>}
      </g>)}
    </svg>
    {rooms.map(room => <div key={room.id} className="shared-floor__room-marker" style={{ left: room.x + room.width / 2, top: room.y + room.height + 10 }}>
      <button type="button" className="shared-floor__room-label" aria-label={`${room.label}, ${room.actorIds.length} agents. Open workspace rooms`} onPointerDown={event => event.stopPropagation()} onClick={() => onOpen(room.id)}>{room.label}<span>{room.actorIds.length}</span></button>
    </div>)}
    {terrain ? rooms.map(room => <span key={room.id} className="shared-floor__room-planting" style={{ left: room.x + room.width - 20, top: room.y + 12 }}><img src={plantingUrl} alt="" draggable={false} /></span>) : null}
  </div>;
}

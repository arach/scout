import { useId, useMemo, useState } from "react";
import { groupLaneRoster } from "./lane-roster-groups.ts";
import "./fleet-groups.css";
import "../../scout/slots/ctx-panel.css";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { focusDeckLane } from "./lane-focus.ts";
import { buildFallbackLaneRoster } from "./lane-roster-fallback.ts";
import {
  getFloorLedgerHandlers,
  useLaneFocusId,
  useLaneRoster,
  type LaneRosterEntry,
} from "./lane-roster-store.ts";

/** Lanes-mode left rail: a 1:1 mirror of the deck's rendered columns so the
 *  count and order always match the strip on screen, and off-viewport lanes
 *  (the deck h-scrolls) get a jump target. The deck publishes the roster it
 *  rendered; until it does (the rail can mount a beat early), we show an interim
 *  fleet-derived list so the rail isn't blank. When the FLOOR layout publishes,
 *  entries carry a rich ledger projection (action line, activity strip, counts)
 *  and rows hover-link to the floor's lanes through the store.
 *
 *  Floor rows are titled the way the floor titles its people — harness mark,
 *  then the name or the harness plus the lane's last four — with the workspace
 *  underneath. Titling them by workspace instead put the same word on every row
 *  of a repo, which is a list you cannot pick anything out of. */
export function OpsLanesLeft() {
  const { agents, navigate } = useScout();
  const published = useLaneRoster();
  const focusedLaneId = useLaneFocusId();
  const groupId = useId();
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const collapseControl = (key: string, label: string, controls: string) => <button
    type="button" className="fleet-group-toggle" aria-expanded={!folded.has(key)} aria-controls={controls}
    aria-label={`${folded.has(key) ? "Expand" : "Collapse"} ${label}`}
    onClick={() => setFolded(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    })}
  ><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="m5 3 4 4-4 4" /></svg></button>;

  // Interim roster while the deck hasn't published yet: the same fleet agents
  // that seed the deck's scout lanes (live transport / provider session, minus
  // idle codex relays), read from the already-loaded fleet without the deck's
  // tail/observe polling. Ignored the moment `published` (the real mirror) lands.
  const fallback = useMemo<LaneRosterEntry[]>(
    () => buildFallbackLaneRoster(agents),
    [agents],
  );

  const lanes = published ?? fallback;
  const floorMode = lanes.some((entry) => entry.floor);

  const spatial = lanes.some(entry => entry.floor?.place);
  const groups = useMemo(() => groupLaneRoster(lanes), [lanes]);
  const renderEntry = (entry: LaneRosterEntry) => entry.floor ? (
    <button
      key={entry.id}
      type="button"
      className={`agent-floor__ledger-row is-rail${focusedLaneId === entry.id ? " is-focus" : ""}`}
      onClick={() => {
        const handlers = getFloorLedgerHandlers();
        if (handlers) handlers.onSelect(entry.id);
        else focusDeckLane(entry.id, entry.agentId, navigate);
      }}
      onPointerEnter={() => getFloorLedgerHandlers()?.onHover(entry.id)}
      onPointerLeave={() => getFloorLedgerHandlers()?.onHover(null)}
      onContextMenu={event => {
        const handler = getFloorLedgerHandlers()?.onContextMenu;
        if (!handler) return;
        event.preventDefault();
        handler(entry.id, { x: event.clientX, y: event.clientY });
      }}
    >
      <span className="agent-floor__ledger-id">
        <HarnessMark harness={entry.floor.harness} size={15} title={null} />
        <span className="agent-floor__ledger-lines">
          <span className="agent-floor__ledger-name">{entry.floor.identity}</span>
          {entry.floor.project && !entry.floor.place ? (
            <span className="agent-floor__ledger-where">{entry.floor.project}</span>
          ) : null}
        </span>
        <span className={`agent-floor__card-dot${entry.floor.live ? " is-live" : ""}`} />
      </span>
      <span className="agent-floor__ledger-strip">
        {entry.floor.strip.slice(-6).map((kind, blockIndex) => (
          <span key={blockIndex} className={`agent-floor__ledger-cell is-${kind}`} />
        ))}
      </span>
    </button>
  ) : (
    <RailRow
      key={entry.id}
      name={entry.label}
      // SCO-085: two-line rows — project/machine + harness under the name;
      // status semantics via tone dot (running/waiting/failed/idle).
      sub={entry.statusLabel || undefined}
      meta={entry.updatedAt ? timeAgo(entry.updatedAt) : undefined}
      tone={entry.tone}
      title={entry.statusLabel}
      onClick={() => focusDeckLane(entry.id, entry.agentId, navigate)}
    />
  );

  return (
    <div className="ctx-panel ctx-panel--ops">
      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          {floorMode ? "Fleet" : "Lanes"}
          {lanes.length > 0 && <span className="ctx-panel-count">{lanes.length}</span>}
        </div>
        {lanes.length === 0 ? (
          <div className="ctx-panel-empty">No active lanes</div>
        ) : (
          spatial ? groups.map((island, islandIndex) => {
            const islandKey = JSON.stringify([island.id]);
            const islandContents = `${groupId}-island-${islandIndex}`;
            return <section className="fleet-island" key={island.id} aria-label={`${island.label} island`}>
              <div className="fleet-group-heading fleet-group-heading--island">
                {collapseControl(islandKey, `${island.label} island`, islandContents)}
                <button className="fleet-island-heading" type="button" title={`Fly to ${island.workspace || island.label}`} onClick={() => getFloorLedgerHandlers()?.onPlaceSelect?.(island.id)}>
                  <span><strong>{island.label}</strong><small>{island.workspace.split("/").filter(Boolean).slice(-2).join("/")}</small></span><span>{island.count}</span>
                </button>
              </div>
              <div id={islandContents} hidden={folded.has(islandKey)}>
                {island.rooms.map((room, roomIndex) => {
                  const roomKey = JSON.stringify([island.id, room.id]);
                  const roomContents = `${islandContents}-room-${roomIndex}`;
                  return <section className="fleet-room" key={room.id} aria-label={`${room.label}, ${room.entries.length} agents`}>
                    <div className="fleet-group-heading">
                      {collapseControl(roomKey, `${room.label} in ${island.label}`, roomContents)}
                      <button className="fleet-room-heading" type="button" title={`Fly to ${room.label}`} onClick={() => getFloorLedgerHandlers()?.onPlaceSelect?.(island.id, room.id)}><span>{room.label}</span><span>{room.entries.length}</span></button>
                    </div>
                    <div id={roomContents} hidden={folded.has(roomKey)}>{room.entries.map(renderEntry)}</div>
                  </section>;
                })}
              </div>
            </section>;
          }) : lanes.map(renderEntry)
        )}
      </section>
    </div>
  );
}

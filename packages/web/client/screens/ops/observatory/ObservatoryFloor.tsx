/**
 * THESIS: An illustrated observatory with unambiguous things to pick up.
 * OWN-WORLD: Ring Observatory's stone, brass and crew, in neutral black stars.
 * STORY: See the live team, move a person, exchange room positions, place islands.
 * FIRST VIEWPORT: The islands fill the stage; a quiet top bar and bottom camera
 * controls leave the artwork open. Selection reveals only the relevant actions.
 * FORM: User-approved isometric scene; bounded platforms, no projection picker.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CrewSprite } from "../../../components/CrewSprite.tsx";
import { HarnessMark } from "../../../components/HarnessMark.tsx";
import { CAST_MEMBERS, matchCastSlug } from "../../../lib/crew-registry.ts";
import { normalizeAgentState } from "../../../lib/agent-state.ts";
import type { AgentLane } from "../agent-lanes-model.ts";
import { floorCharacterName } from "../floor-character-name.ts";
import { floorActorState } from "../agent-floor-actor.ts";
import { fmtLaneAgeLabel, fmtLaneAgeTitle } from "../../../lib/lane-observe.ts";
import { activityPreview } from "./activity-preview.ts";
import { floorRoutedMessages } from "../floor-message-passes.ts";
import { floorExchanges } from "../floor-exchanges.ts";
import { FloorExchangePanel } from "../FloorExchangePanel.tsx";
import { SceneExchanges } from "./SceneExchanges.tsx";
import { SceneMinimap } from "./SceneMinimap.tsx";
import { useScout } from "../../../scout/Provider.tsx";
import { useWorldMessages } from "../use-world-messages.ts";
import { WorldSky } from "../WorldSky.tsx";
import { publishLaneRoster, setFloorLedgerHandlers } from "../lane-roster-store.ts";
import { buildScene, createRoom, emptyLayout, fitScene, moveActor, moveRoom, removeEmptyRoom, parseLayout, SCENE_STORAGE_KEY, zoomAt, type Camera, type SceneIsland, type SceneLayout, type SceneMemory, type SceneRoom } from "./scene-model.ts";
import { useSceneInteraction } from "./useSceneInteraction.ts";
import { dropDescription, gestureDelta, gestureDestination, gesturePlacement, type Pick } from "./scene-interaction.ts";
import { cameraForActor, cameraForIsland, cameraForRoom, flightCamera, islandHints } from "./scene-camera.ts";
import styles from "./ObservatoryFloor.module.css";

const islandArt = new URL("../assets/world-maps/ring-observatory.png", import.meta.url).href;
// The broad stone silhouette excludes transparent sky around the illustration.
const islandBody = "M 410 322 L 580 309 L 694 355 L 760 408 L 840 421 L 880 443 L 936 486 L 963 540 L 966 641 L 941 750 L 877 819 L 849 879 L 770 927 L 707 996 L 640 980 L 593 1075 L 509 1130 L 457 1084 L 421 1030 L 356 1005 L 314 954 L 246 913 L 209 851 L 145 837 L 91 782 L 39 702 L 28 598 L 63 558 L 84 508 L 126 463 L 160 438 L 216 421 L 285 379 L 350 350 Z";
const readLayout = () => { try { return parseLayout(localStorage.getItem(SCENE_STORAGE_KEY)); } catch { return emptyLayout(); } };
const pickProps = (kind: Pick["kind"], island: string, id: string) => ({ "data-scene-pick": kind, "data-island": island, "data-id": id });

export default function ObservatoryFloor({ lanes, now, onActor }: { lanes: AgentLane[]; now: number; onActor: (lane: AgentLane) => void }) {
  const { openFilePreview } = useScout();
  const [exchangePair, setExchangePair] = useState<[string, string] | null>(null);
  const [layout, setLayout] = useState(readLayout);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: .5 });
  const [size, setSize] = useState({ width: 1000, height: 750 });
  const [selection, setSelection] = useState<Pick | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const [travelling, setTravelling] = useState(false);
  const [announcement, announce] = useState("");
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const memory = useRef<SceneMemory>({});
  const flight = useRef(0);
  const arrivalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cameraRef = useRef(camera); cameraRef.current = camera;
  function stopFlight() { cancelAnimationFrame(flight.current); flight.current = 0; setTravelling(false); }
  function steerCamera(next: Camera) { stopFlight(); setCamera(next); }
  function flyTo(next: Camera, actorId?: string) {
    stopFlight(); setContextMenu(null); setSelection(null); setArrived(null);
    clearTimeout(arrivalTimer.current);
    const arrive = () => { if (actorId) { const island = frame.current.scene.islands.find(item => item.actors.some(actor => actor.lane.id === actorId)); if (island) setSelection({ kind: "actor", island: island.id, id: actorId }); setArrived(actorId); arrivalTimer.current = setTimeout(() => setArrived(null), 2200); } };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setCamera(next); arrive(); return; }
    setTravelling(true);
    const from = cameraRef.current, started = performance.now();
    const tick = (at: number) => {
      const progress = Math.min(1, (at - started) / 1150);
      setCamera(flightCamera(from, next, size, progress));
      if (progress < 1) flight.current = requestAnimationFrame(tick);
      else { flight.current = 0; setTravelling(false); arrive(); }
    };
    flight.current = requestAnimationFrame(tick);
  }
  useEffect(() => () => { cancelAnimationFrame(flight.current); clearTimeout(arrivalTimer.current); }, []);
  const messages = useWorldMessages();
  const minute = Math.floor(now / 60000);
  const edges = useMemo(() => [
    ...floorRoutedMessages(lanes, now, 4 * 60 * 60000, messages).map(message => ({ from: message.from, to: message.to, weight: 1 })),
  ], [lanes, messages, minute]);
  const exchanges = useMemo(() => floorExchanges(lanes, now, messages), [lanes, messages, minute]);
  const currentScene = useMemo(() => buildScene(lanes, edges, layout, memory.current), [lanes, edges, layout]);
  function commit(next: SceneLayout) {
    setLayout(next);
    try { localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(next)); setStorageUnavailable(false); }
    catch { setStorageUnavailable(true); }
    announce("Arrangement saved for this preview.");
  }
  const interaction = useSceneInteraction({ scene: currentScene, layout, camera, setCamera: steerCamera, commit, select: pick => { setExchangePair(null); setSelection(pick); } });
  const { viewport, gesture, hover, previewRoom, handlers } = interaction;
  const scene = gesture?.scene ?? currentScene;
  useEffect(() => {
    if (gesture) { stopFlight(); setContextMenu(null); }
  }, [gesture]);
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest("[data-scene-menu]")) setContextMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [contextMenu]);
  useEffect(() => { if (!gesture) memory.current = currentScene.memory; }, [currentScene, gesture]);
  const frame = useRef({ scene, size }); frame.current = { scene, size };
  const fitted = useRef(false);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width < 1 || entry.contentRect.height < 1) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setSize(next);
      if (!fitted.current && frame.current.scene.islands.length) { setCamera(cameraForIsland([...frame.current.scene.islands].sort((a, b) => b.actors.length - a.actors.length)[0]!, next)); fitted.current = true; }
    });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!fitted.current && scene.islands.length) { setCamera(cameraForIsland([...scene.islands].sort((a, b) => b.actors.length - a.actors.length)[0]!, size)); fitted.current = true; }
  }, [scene.islands.length]);
  const crew = useRef<Record<string, string>>({});
  for (const lane of [...lanes].sort((a, b) => a.id.localeCompare(b.id))) if (!crew.current[lane.id]) {
    const used = Object.values(crew.current);
    crew.current[lane.id] = matchCastSlug(lane.agent.name) ?? CAST_MEMBERS.find(member => !used.includes(member.slug))?.slug ?? CAST_MEMBERS[used.length % CAST_MEMBERS.length]!.slug;
  }
  // The host roster still points to real agents. Only handlers belong to this
  // mounted view, and are released when the operator returns to the old floor.
  useEffect(() => {
    const orderedActors = scene.islands.flatMap(island => [...island.rooms].sort((a, b) => a.slot - b.slot).flatMap(room => island.actors.filter(actor => actor.room === room.id).map(actor => ({ island, room, lane: actor.lane }))));
    publishLaneRoster(orderedActors.map(({ island, room, lane }) => ({ id: lane.id, label: floorCharacterName(lane).label, statusLabel: floorActorState(lane, now).label, tone: normalizeAgentState(lane.agent.state, lane.agent), floor: {
      place: { islandId: island.id, islandLabel: island.label, workspace: island.cwd, roomId: room.id, roomLabel: room.label },
      live: floorActorState(lane, now).posture === "working", harness: lane.agent.harness || null,
      identity: floorCharacterName(lane).label, project: lane.agent.project || null,
      actionGlyph: "", actionLabel: floorActorState(lane, now).label, actionMeta: "", strip: [], countsLabel: "",
    } })));
    setFloorLedgerHandlers({ onHover: () => {}, onSelect: id => {
      const island = scene.islands.find(island => island.actors.some(actor => actor.lane.id === id));
      if (island) flyTo(cameraForActor(island, island.actors.find(actor => actor.lane.id === id)!, frame.current.size), id);
    }, onContextMenu: (id, point) => setContextMenu({ id, ...point }), onPlaceSelect: (islandId, roomId) => {
      const island = scene.islands.find(island => island.id === islandId);
      if (!island) return;
      const room = island.rooms.find(room => room.id === roomId);
      flyTo(room ? cameraForRoom(island, room, frame.current.size) : cameraForIsland(island, frame.current.size));
      setSelection({ kind: roomId ? "room" : "island", island: island.id, id: roomId ?? island.id });
    } });
    return () => setFloorLedgerHandlers(null);
  }, [lanes, now, scene]);
  useEffect(() => {
    if (selection?.kind === "actor" && !lanes.some(lane => lane.id === selection.id)) setSelection(null);
  }, [lanes, selection]);
  function focusIsland(island: SceneIsland) {
    flyTo(cameraForIsland(island, size));
  }
  function keyboard(event: ReactKeyboardEvent, pick: Pick) {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault(); event.stopPropagation();
    const island = scene.islands.find(island => island.id === pick.island)!;
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    if (pick.kind === "island") {
      commit({ ...layout, islands: { ...layout.islands, [island.id]: { x: island.x + (event.key === "ArrowLeft" ? -32 : event.key === "ArrowRight" ? 32 : 0), y: island.y + (event.key === "ArrowUp" ? -32 : event.key === "ArrowDown" ? 32 : 0) } } });
    } else if (pick.kind === "room") {
      const ordered = [...island.rooms].sort((a, b) => a.slot - b.slot), index = ordered.findIndex(room => room.id === pick.id);
      const target = ordered[(index + direction + ordered.length) % ordered.length]!;
      commit(moveRoom(layout, island, pick.id, target));
    } else {
      const actor = island.actors.find(actor => actor.lane.id === pick.id)!;
      const room = island.rooms.find(room => room.id === actor.room)!;
      commit(moveActor(layout, island, pick.id, room, (actor.seat + direction + room.seats.length) % room.seats.length));
    }
  }
  const target = gesture?.moved ? gestureDestination(gesture) : null;
  const placement = gesture?.moved ? gesturePlacement(gesture) : null;
  const delta = gesture?.moved ? gestureDelta(gesture) : { x: 0, y: 0 };
  const selectedIsland = scene.islands.find(island => island.id === selection?.island);
  const selectedActor = selectedIsland?.actors.find(actor => selection?.kind === "actor" && actor.lane.id === selection.id);
  const selectedRoom = selectedIsland?.rooms.find(room => selection?.kind === "room" && room.id === selection.id);
  const activity = selectedActor ? activityPreview(selectedActor.lane, now) : [];
  const hoveredIsland = scene.islands.find(island => hover?.kind === "actor" && island.id === hover.island);
  const hoveredActor = hoveredIsland?.actors.find(actor => actor.lane.id === hover?.id);
  const overhead = hoveredActor && hoveredIsland && !gesture && !travelling ? {
    actor: hoveredActor, latest: activityPreview(hoveredActor.lane, now, 1)[0]!,
    x: Math.max(155, Math.min(size.width - 155, camera.x + (hoveredIsland.x + hoveredActor.x) * camera.scale)),
    y: Math.max(225, Math.min(size.height - 85, camera.y + (hoveredIsland.y + hoveredActor.y - 90) * camera.scale - 12)),
  } : null;
  const activePick = gesture?.pick ?? hover;
  const activeIsland = scene.islands.find(island => island.id === activePick?.island);
  const activeActor = activeIsland?.actors.find(actor => actor.lane.id === activePick?.id);
  const activeRoom = activeIsland?.rooms.find(room => activePick?.kind === "room" && room.id === activePick.id);
  const activeName = activePick?.kind === "island" ? activeIsland?.label : activePick?.kind === "room" ? activeIsland?.rooms.find(room => room.id === activePick.id)?.label : activeActor ? floorCharacterName(activeActor.lane).label : null;
  const actionHint = gesture?.moved ? dropDescription(gesture, lane => floorCharacterName(lane).label)
    : activePick?.kind === "actor" ? `Move ${activeName} · one agent · drop on a person to swap places`
    : activePick?.kind === "room" ? `Move ${activeName} anywhere · ${activeRoom?.actorIds.length ?? 0} agents together · drop on another room to swap`
    : activePick?.kind === "island" ? `Move ${activeName} island · all ${activeIsland?.actors.length ?? 0} agents stay together`
    : "Drag an island to move it · drag empty space to explore";
  const compact = camera.scale < .36;
  const roomCount = scene.islands.reduce((count, island) => count + island.rooms.length, 0);
  const hints = islandHints(scene, camera, size);
  const menuIsland = scene.islands.find(island => island.actors.some(actor => actor.lane.id === contextMenu?.id));
  const menuActor = menuIsland?.actors.find(actor => actor.lane.id === contextMenu?.id);

  return <section className={styles.root} aria-label="Observatory preview" data-observatory-preview="true" data-camera-flight={travelling ? "moving" : "idle"}>
    <div ref={viewport} className={styles.viewport} {...handlers} onPointerDownCapture={stopFlight} data-dragging={gesture?.moved || undefined}>
      <div className={styles.sky}><WorldSky zoom={camera.scale} pan={camera} sparse beacons={[]} beaconStrength={0} /></div>
      <div className={styles.world} style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
        {!gesture?.moved ? <SceneExchanges scene={scene} exchanges={exchanges} focus={activePick ?? selection} onOpen={pair => { setSelection(null); setExchangePair(pair); }} /> : null}
        {scene.islands.map(island => {
          const movingIsland = gesture?.moved && gesture.pick?.kind === "island" && gesture.pick.island === island.id;
          const islandPick: Pick = { kind: "island", island: island.id, id: island.id };
          const actorStack = new Map([...island.actors].sort((a, b) => a.y - b.y).map((actor, index) => [actor.lane.id, index + 3]));
          return <div key={island.id} className={styles.island} data-held={movingIsland || undefined} data-highlight={activePick?.kind === "island" && activePick.island === island.id || undefined} style={{ left: island.x + (movingIsland ? delta.x : 0), top: island.y + (movingIsland ? delta.y : 0), width: island.width, height: island.height, zIndex: movingIsland ? 10 : undefined }}>
            {island.platforms.length > 1 ? <svg className={styles.bridges} width={island.width} height={island.height} aria-hidden="true">{island.platforms.slice(1).map((platform, i) => <path key={i} d={`M ${island.platforms[i]!.x + island.artWidth * .78} ${island.platforms[i]!.y + island.artHeight * .48} L ${platform.x + island.artWidth * .22} ${platform.y + island.artHeight * .48}`} />)}</svg> : null}
            {island.platforms.map((platform, index) => <div key={index} className={styles.platform} style={{ left: platform.x, top: platform.y, width: platform.width, height: platform.height }}>
              <img className={styles.art} src={islandArt} alt="" draggable={false} />
              <svg className={styles.islandHit} viewBox="0 0 1000 1250" aria-hidden="true" {...pickProps("island", island.id, island.id)}><path d={islandBody} /></svg>
              <svg className={styles.rim} viewBox="0 0 1000 1250" aria-hidden="true"><path className={styles.rimOutline} d="M 135 564 C 156 779 844 779 865 564" /></svg>
            </div>)}
            {island.rooms.map(room => {
              const movingRoom = gesture?.moved && gesture.pick?.kind === "room" && gesture.pick.island === island.id && gesture.pick.id === room.id;
              const receiving = gesture?.moved && gesture.pick?.island === island.id && target?.room.id === room.id;
              const roomPick: Pick = { kind: "room", island: island.id, id: room.id };
              const highlighted = activePick?.kind === "room" && activePick.island === island.id && activePick.id === room.id || selection?.kind === "room" && selection.island === island.id && selection.id === room.id;
              const revealed = !room.actorIds.length || highlighted || movingRoom || receiving || !gesture && !travelling && (previewRoom?.island === island.id && previewRoom.id === room.id || activePick?.kind === "actor" && activePick.island === island.id && activeActor?.room === room.id);
              return <div key={room.id} className={styles.room} data-preview={revealed || undefined} data-receiving={receiving || undefined} data-held={movingRoom || undefined} data-highlight={highlighted || undefined} style={{ left: room.x - room.rx + (movingRoom ? delta.x : 0), top: room.y - room.ry + (movingRoom ? delta.y : 0), width: room.rx * 2, height: room.ry * 2 }}>
                <span className={styles.roomRing} />
                <button type="button" className={styles.roomGrip} {...pickProps("room", island.id, room.id)} aria-label={`Move ${room.label}, ${room.actorIds.length} agents together. Place anywhere or drop on another room to swap groups. Arrow keys exchange room positions.`} onKeyDown={event => keyboard(event, roomPick)} onClick={event => { if (event.detail === 0) setSelection(roomPick); }} style={{ transform: `translate(-50%, -50%) scale(${Math.max(1, .78 / camera.scale)}) matrix(.94, -.28, .94, .28, 0, 0)` }}><span aria-hidden="true">⠿</span>{room.label}<small>{room.actorIds.length}</small></button>
              </div>;
            })}
            {placement && gesture?.pick?.kind === "actor" && gesture.pick.island === island.id ? <span className={styles.dropSeat} style={{ left: placement.kind === "actor-swap" ? placement.actor.x : placement.point.x, top: placement.kind === "actor-swap" ? placement.actor.y : placement.point.y }} /> : null}
            {!compact ? island.actors.map(actor => {
              const picked = gesture?.moved && gesture.pick?.kind === "actor" && gesture.pick.id === actor.lane.id;
              const movingRoom = gesture?.moved && gesture.pick?.kind === "room" && gesture.pick.island === island.id && gesture.pick.id === actor.room;
              const pick: Pick = { kind: "actor", island: island.id, id: actor.lane.id };
              const status = floorActorState(actor.lane, now);
              return <button type="button" key={actor.lane.id} className={styles.actor} {...pickProps("actor", island.id, actor.lane.id)} data-held={picked || movingRoom || undefined} data-group-highlight={activePick?.island === island.id && (activePick.kind === "island" || activePick.kind === "room" && activePick.id === actor.room) || undefined} data-selected={selectedActor?.lane.id === actor.lane.id || arrived === actor.lane.id || undefined} data-attention={status.posture === "attention" || status.posture === "blocked" || undefined} style={{ left: actor.x + (picked || movingRoom ? delta.x : 0), top: actor.y + (picked || movingRoom ? delta.y : 0), zIndex: picked ? 5000 : actorStack.get(actor.lane.id) }} onContextMenu={event => { event.preventDefault(); setContextMenu({ id: actor.lane.id, x: event.clientX, y: event.clientY }); }} onKeyDown={event => keyboard(event, pick)} onClick={event => { if (event.detail === 0) { setSelection(pick); } }} aria-label={`${floorCharacterName(actor.lane).label}, ${status.label}. Drag to move, Enter to inspect, arrows to change seat.`}>
                <span className={styles.foot} /><CrewSprite slug={crew.current[actor.lane.id]!} size={78} paused={!!gesture} />
                <span className={styles.actorLabel}><HarnessMark harness={actor.lane.agent.harness} size={12} title={null} />{floorCharacterName(actor.lane).label}</span>
              </button>;
            }) : null}
            <button className={styles.islandName} type="button" {...pickProps("island", island.id, island.id)} style={{ left: island.width / 2, top: island.artHeight * .70, transform: `translateX(-50%) scale(${Math.max(1, .52 / camera.scale)})` }} title={`Drag the island surface, edge or nameplate · ${island.cwd}`} onKeyDown={event => keyboard(event, islandPick)} onClick={event => { if (event.detail === 0) setSelection(islandPick); }} aria-label={`Move ${island.label} island. ${island.actors.length} agents. Arrow keys move the island.`}><span aria-hidden="true">⠿</span><span><strong>{island.label}</strong><small>Move island · {island.actors.length} agents · {island.rooms.length} {island.rooms.length === 1 ? "room" : "rooms"}</small></span></button>
          </div>;
        })}
      </div>
      {overhead ? <div className={styles.overhead} role="tooltip" style={{ left: overhead.x, top: overhead.y }}>
        <strong>{floorCharacterName(overhead.actor.lane).label}</strong>
        <small>{overhead.latest.at !== null ? `Latest activity · ${fmtLaneAgeLabel(overhead.latest.at, now)}` : overhead.latest.label}</small>
        <p>{overhead.latest.text}</p>
      </div> : null}
      {hints.map(hint => <button key={hint.island.id} type="button" className={styles.destination} data-scene-ui="true" data-edge={hint.edge} style={{ left: hint.x, top: hint.y }} onClick={() => focusIsland(hint.island)} aria-label={`Fly to ${hint.island.label}, ${hint.island.actors.length} agents`}><img src={islandArt} alt="" draggable={false} /><span>{hint.island.label}</span><small>{hint.island.actors.length} agents ↗</small></button>)}
      <header className={styles.toolbar} data-scene-ui="true"><div><strong>Observatory</strong><span>Preview</span><small>{lanes.length} agents · {roomCount} rooms</small></div><a href="/ops/world">Return to current Fleet ↗</a></header>
      {exchangePair ? <div className={styles.exchangePanel} data-scene-ui="true"><FloorExchangePanel pair={exchangePair} lanes={lanes} now={now} broker={messages} onClose={() => setExchangePair(null)} onFile={openFilePreview} onSpeaker={() => {}} /></div> : null}
      {selectedIsland ? <aside className={`${styles.inspector} ${selectedActor ? styles.activityPanel : ""}`} data-scene-ui="true" data-scene-inspector="true" aria-label={selectedActor ? "Agent activity preview" : "Selected object"}>
        <button type="button" className={styles.close} aria-label="Close selection" onClick={() => setSelection(null)}>×</button>
        <small>{selectedActor ? "Latest activity" : selectedRoom ? "Room" : "Island"} · {selectedIsland.label}</small>
        <h2>{selectedActor ? floorCharacterName(selectedActor.lane).label : selectedRoom?.label || selectedIsland.label}</h2>
        {selectedActor ? <><span className={styles.agentStatus}>{floorActorState(selectedActor.lane, now).label}</span><ol className={styles.activityList}>{activity.map(item => <li key={item.id}><div><span>{item.label}</span>{item.at !== null ? <time dateTime={new Date(item.at).toISOString()} title={fmtLaneAgeTitle(item.at)}>{fmtLaneAgeLabel(item.at, now)}</time> : null}</div><p>{item.text}</p></li>)}</ol><label>Room<select value={selectedActor.room} onChange={event => {
          const room = selectedIsland.rooms.find(room => room.id === event.target.value)!;
          const empty = room.seats.findIndex((_, seat) => !selectedIsland.actors.some(actor => actor.room === room.id && actor.seat === seat));
          commit(moveActor(layout, selectedIsland, selectedActor.lane.id, room, empty < 0 ? 0 : empty));
        }}>{selectedIsland.rooms.map(room => <option key={room.id} value={room.id}>{room.label}</option>)}</select></label><button type="button" onClick={() => onActor(selectedActor.lane)}>Open activity ↗</button>{layout.actors[selectedActor.lane.id] ? <button type="button" onClick={() => { const actors = { ...layout.actors }, actorPositions = { ...layout.actorPositions }; delete actors[selectedActor.lane.id]; delete actorPositions[selectedActor.lane.id]; commit({ ...layout, actors, actorPositions }); }}>Return to collaboration grouping</button> : null}</> : <><p>{selectedRoom ? selectedRoom.actorIds.length ? `${selectedRoom.actorIds.length} agents in this room. Drag its marker anywhere, including open space. Drop on another room to swap groups.` : "This space is empty. Drag an agent into the highlighted room, or choose it from the agent’s Room menu." : `${selectedIsland.actors.length} agents share this island. Drag its exposed stone surface, edge or nameplate to move the whole island.`}</p><button type="button" onClick={() => focusIsland(selectedIsland)}>Look closer</button><button type="button" onClick={() => {
          const created = createRoom(layout, selectedIsland);
          commit(created.layout);
          const next = buildScene(lanes, edges, created.layout, memory.current).islands.find(island => island.id === selectedIsland.id)!;
          flyTo(cameraForIsland(next, size)); setSelection({ kind: "room", island: selectedIsland.id, id: created.roomId });
          announce("Room created. Drag an agent into its highlighted space.");
        }}>+ Create room</button>{selectedRoom && !selectedRoom.actorIds.length && selectedIsland.rooms.length > 1 ? <button type="button" onClick={() => {
          commit(removeEmptyRoom(layout, selectedIsland, selectedRoom.id));
          setSelection({ kind: "island", island: selectedIsland.id, id: selectedIsland.id });
        }}>Remove empty room</button> : null}{selectedRoom ? <label>Position<select value={selectedRoom.slot} onChange={event => commit(moveRoom(layout, selectedIsland, selectedRoom.id, selectedIsland.rooms.find(room => room.slot === Number(event.target.value))!))}>{[...selectedIsland.rooms].sort((a, b) => a.slot - b.slot).map(room => <option key={room.id} value={room.slot}>Space {room.slot + 1}</option>)}</select></label> : null}</>}
      </aside> : null}
      <div className={styles.hint} data-active={!!activePick || gesture?.moved || undefined} role="status">{actionHint}</div>
      <SceneMinimap scene={scene} camera={camera} size={size} onCamera={steerCamera} onLocate={focusIsland} />
      <nav className={styles.camera} aria-label="Observatory camera" data-scene-ui="true">
        <button type="button" onClick={() => { interaction.cancel(); commit({ ...layout, islands: {} }); setCamera(fitScene(buildScene(lanes, edges, { ...layout, islands: {} }, memory.current), size)); }}>Arrange islands</button>
        <span />
        <button type="button" aria-label="Zoom observatory out" onClick={() => steerCamera(zoomAt(camera, { x: size.width / 2, y: size.height / 2 }, 1 / 1.3))}>−</button>
        <button type="button" onClick={() => flyTo(fitScene(scene, size))}>Fit</button>
        <button type="button" aria-label="Zoom observatory in" onClick={() => steerCamera(zoomAt(camera, { x: size.width / 2, y: size.height / 2 }, 1.3))}>+</button>
      </nav>
      {storageUnavailable ? <p className={styles.saveNotice}>Positions are kept for this visit; browser storage is unavailable.</p> : null}
      {contextMenu && menuIsland && menuActor ? <div className={styles.contextMenu} data-scene-menu="true" data-scene-ui="true" role="menu" aria-label={`${floorCharacterName(menuActor.lane).label} actions`} style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 235)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 125)) }}><strong>{floorCharacterName(menuActor.lane).label}</strong><button autoFocus type="button" role="menuitem" onClick={() => flyTo(cameraForActor(menuIsland, menuActor, size), menuActor.lane.id)}>Fly to agent ↗</button><button type="button" role="menuitem" onClick={() => { setContextMenu(null); onActor(menuActor.lane); }}>Open activity</button></div> : null}
      <span className={styles.srOnly} role="status">{announcement}</span>
    </div>
  </section>;
}

import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { worldPoint, zoomAt, type Camera, type Point, type Scene, type SceneIsland } from "./scene-model.ts";
import { cameraAtMinimapPoint, MINIMAP_SIZE, minimapGeometry, minimapViewport, type MinimapGeometry } from "./scene-minimap.ts";
import styles from "./SceneMinimap.module.css";

type Props = {
  scene: Scene; camera: Camera; size: { width: number; height: number };
  onCamera: (camera: Camera) => void; onLocate: (island: SceneIsland) => void;
};

export function SceneMinimap({ scene, camera, size, onCamera, onLocate }: Props) {
  const map = useRef<HTMLDivElement>(null);
  const geometry = useMemo(() => minimapGeometry(scene), [scene]);
  const rect = minimapViewport(geometry, camera, size);
  const drag = useRef<{ id: number; offset: Point; geometry: MinimapGeometry; camera: Camera; size: Props["size"] } | null>(null);
  const latest = useRef({ camera, size, onCamera }); latest.current = { camera, size, onCamera };
  const center = { x: size.width / 2, y: size.height / 2 };
  const point = (event: { clientX: number; clientY: number }): Point => {
    const bounds = map.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * MINIMAP_SIZE.width / bounds.width, y: (event.clientY - bounds.top) * MINIMAP_SIZE.height / bounds.height };
  };
  useEffect(() => {
    const node = map.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (drag.current) return;
      const { camera, size, onCamera } = latest.current;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      onCamera(zoomAt(camera, { x: size.width / 2, y: size.height / 2 }, Math.exp(-Math.max(-100, Math.min(100, delta)) * .007)));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    const cancel = () => { drag.current = null; };
    window.addEventListener("blur", cancel);
    return () => { node.removeEventListener("wheel", wheel); window.removeEventListener("blur", cancel); };
  }, []);
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest("button") || drag.current) return;
    event.preventDefault(); event.stopPropagation();
    map.current!.focus({ preventScroll: true });
    const at = point(event), inside = at.x >= rect.x && at.x <= rect.x + rect.width && at.y >= rect.y && at.y <= rect.y + rect.height;
    const mapCenter = geometry.point(worldPoint(center, camera));
    drag.current = { id: event.pointerId, offset: inside ? { x: mapCenter.x - at.x, y: mapCenter.y - at.y } : { x: 0, y: 0 }, geometry, camera, size };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!inside) onCamera(cameraAtMinimapPoint(geometry, at, camera, size));
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    const at = point(event);
    onCamera(cameraAtMinimapPoint(held.geometry, { x: at.x + held.offset.x, y: at.y + held.offset.y }, held.camera, held.size));
  }
  function end(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <aside className={styles.minimap} data-scene-ui="true" aria-label="World minimap">
    <div className={styles.caption}><span>World</span><small>{scene.islands.length} {scene.islands.length === 1 ? "island" : "islands"}</small></div>
    <div ref={map} className={styles.map} tabIndex={0} role="group" aria-label="Pan world map. Arrow keys to explore, plus or minus to zoom."
      title="Drag to explore · scroll to zoom · select an island to fly there"
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          onCamera({ ...camera, x: camera.x + (event.key === "ArrowLeft" ? size.width / 4 : event.key === "ArrowRight" ? -size.width / 4 : 0), y: camera.y + (event.key === "ArrowUp" ? size.height / 4 : event.key === "ArrowDown" ? -size.height / 4 : 0) });
        } else if (["+", "=", "-"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); onCamera(zoomAt(camera, center, event.key === "-" ? 1 / 1.3 : 1.3));
        } else if (event.key === "Escape") { drag.current = null; }
      }}>
      <svg viewBox={`0 0 ${MINIMAP_SIZE.width} ${MINIMAP_SIZE.height}`} aria-hidden="true">
        {scene.islands.flatMap(island => island.platforms.map((platform, index) => {
          const at = geometry.point({ x: island.x + platform.x + platform.width / 2, y: island.y + platform.y + platform.height * .46 });
          return <ellipse key={`${island.id}:${index}`} className={styles.platform} cx={at.x} cy={at.y} rx={platform.width * .43 * geometry.scale} ry={platform.height * .2 * geometry.scale} />;
        }))}
        {scene.islands.flatMap(island => island.rooms.map(room => {
          const at = geometry.point({ x: island.x + room.x, y: island.y + room.y });
          return <ellipse key={`${island.id}:${room.id}`} className={styles.space} cx={at.x} cy={at.y} rx={Math.max(2, room.rx * geometry.scale)} ry={Math.max(1, room.ry * geometry.scale)} />;
        }))}
        {scene.islands.flatMap(island => island.actors.map(actor => {
          const at = geometry.point({ x: island.x + actor.x, y: island.y + actor.y });
          return <circle key={actor.lane.id} className={styles.person} cx={at.x} cy={at.y} r="1.25" />;
        }))}
        <rect className={styles.view} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="1" />
      </svg>
      {scene.islands.map(island => {
        const at = geometry.point({ x: island.x + island.width / 2, y: island.y + island.artHeight * .46 });
        return <button key={island.id} type="button" className={styles.island} style={{ left: `${at.x / MINIMAP_SIZE.width * 100}%`, top: `${at.y / MINIMAP_SIZE.height * 100}%` }}
          aria-label={`Fly to ${island.label}, ${island.actors.length} agents from minimap`} title={`${island.cwd} · ${island.actors.length} agents`}
          onClick={() => onLocate(island)}><span /></button>;
      })}
    </div>
  </aside>;
}

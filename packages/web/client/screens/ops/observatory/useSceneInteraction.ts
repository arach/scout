import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { worldPoint, zoomAt, type Camera, type Point, type Scene, type SceneLayout } from "./scene-model.ts";

import { layoutAfterGesture, previewRoomAt, type Pick, type Gesture } from "./scene-interaction.ts";

/** A single pointer owner for the entire scene. Picking happens ONCE at press;
 * live roster updates, overlap and nested targets cannot steal an active drag. */
export function useSceneInteraction({ scene, layout, camera, setCamera, commit, select }: {
  scene: Scene; layout: SceneLayout; camera: Camera;
  setCamera: (camera: Camera) => void; commit: (layout: SceneLayout) => void; select: (pick: Pick | null) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const active = useRef<Gesture | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hover, setHover] = useState<Pick | null>(null);
  const [previewRoom, setPreviewRoom] = useState<Pick | null>(null);
  const clearHover = () => { setHover(null); setPreviewRoom(null); };
  const latest = useRef({ scene, layout, camera, setCamera, commit, select });
  latest.current = { scene, layout, camera, setCamera, commit, select };
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ camera: Camera; center: Point; distance: number } | null>(null);
  const local = (event: { clientX: number; clientY: number }): Point => {
    const bounds = viewport.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const cancel = () => {
    const current = active.current;
    if (current && !current.pick) latest.current.setCamera(current.camera);
    active.current = null; pinch.current = null; pointers.current.clear(); setGesture(null); clearHover();
  };
  useEffect(() => {
    const blur = () => cancel();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { cancel(); latest.current.select(null); } };
    window.addEventListener("blur", blur); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("blur", blur); window.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest("[data-scene-ui]")) return;
      event.preventDefault();
      if (active.current || pinch.current) return;
      clearHover();
      const { camera, setCamera } = latest.current;
      if (event.ctrlKey || event.metaKey) setCamera(zoomAt(camera, local(event), Math.exp(-event.deltaY * .007)));
      else setCamera({ ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  const pickFrom = (target: EventTarget | null): Pick | null => {
    const element = (target as Element)?.closest<HTMLElement>("[data-scene-pick]");
    if (!element) return null;
    return { kind: element.dataset.scenePick as Pick["kind"], island: element.dataset.island!, id: element.dataset.id! };
  };
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest("[data-scene-ui]")) return;
    event.preventDefault();
    clearHover();
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      active.current = null; setGesture(null);
      pinch.current = { camera: latest.current.camera, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
      return;
    }
    if (pointers.current.size > 1) return;
    const next = { pointerId: event.pointerId, pick: pickFrom(event.target), start: point, point, moved: false, camera, scene, layout };
    active.current = next; setGesture(next);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const point = local(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const origin = pinch.current;
      const next = zoomAt(origin.camera, origin.center, Math.hypot(a.x - b.x, a.y - b.y) / origin.distance);
      setCamera({ ...next, x: next.x + (a.x + b.x) / 2 - origin.center.x, y: next.y + (a.y + b.y) / 2 - origin.center.y });
      return;
    }
    const current = active.current;
    if (!current) {
      if (event.pointerType === "touch" || (event.target as Element).closest("[data-scene-ui]")) { clearHover(); return; }
      const pick = pickFrom(event.target);
      setHover(pick);
      const room = previewRoomAt(scene, worldPoint(point, camera), pick);
      setPreviewRoom(previous => previous?.island === room?.island && previous?.id === room?.id ? previous : room);
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    const moved = current.moved || Math.hypot(point.x - current.start.x, point.y - current.start.y) >= 5;
    const next = { ...current, point, moved };
    active.current = next; setGesture(next);
    if (moved && !current.pick) setCamera({ ...current.camera, x: current.camera.x + point.x - current.start.x, y: current.camera.y + point.y - current.start.y });
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    if (pinch.current) { pointers.current.delete(event.pointerId); if (pointers.current.size < 2) pinch.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    const held = active.current;
    const point = local(event);
    const current = held ? { ...held, point, moved: held.moved || Math.hypot(point.x - held.start.x, point.y - held.start.y) >= 5 } : null;
    pointers.current.delete(event.pointerId);
    if (!current || current.pointerId !== event.pointerId) return;
    active.current = null; setGesture(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.moved) { select(current.pick); return; }
    if (!current.pick) return;
    commit(layoutAfterGesture(current));
  }
  return {
    viewport, gesture, hover, previewRoom, cancel,
    handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: cancel,
      onFocus: (event: React.FocusEvent<HTMLDivElement>) => { if (!active.current) setHover(pickFrom(event.target)); },
      onBlur: () => { if (!active.current) clearHover(); },
      onLostPointerCapture: (event: ReactPointerEvent) => { if (active.current?.pointerId === event.pointerId || pointers.current.has(event.pointerId)) cancel(); },
      onPointerLeave: () => { if (!active.current) clearHover(); } },
  };
}

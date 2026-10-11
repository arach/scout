import { sceneBounds, worldPoint, type Camera, type Point, type Scene } from "./scene-model.ts";

export const MINIMAP_SIZE = { width: 184, height: 112 };
type Size = { width: number; height: number };

/** The artwork is already isometric. Map its world coordinates directly rather
 * than applying a second projection. Geometry stays fixed while the camera moves. */
export function minimapGeometry(scene: Scene) {
  const bounds = sceneBounds(scene), padding = 12;
  const scale = Math.min((MINIMAP_SIZE.width - padding * 2) / bounds.width, (MINIMAP_SIZE.height - padding * 2) / bounds.height);
  const x = (MINIMAP_SIZE.width - bounds.width * scale) / 2 - bounds.x * scale;
  const y = (MINIMAP_SIZE.height - bounds.height * scale) / 2 - bounds.y * scale;
  return {
    scale,
    point: (world: Point): Point => ({ x: world.x * scale + x, y: world.y * scale + y }),
    world: (point: Point): Point => ({ x: (point.x - x) / scale, y: (point.y - y) / scale }),
  };
}
export type MinimapGeometry = ReturnType<typeof minimapGeometry>;

export function minimapViewport(geometry: MinimapGeometry, camera: Camera, size: Size) {
  return { ...geometry.point(worldPoint({ x: 0, y: 0 }, camera)), width: size.width / camera.scale * geometry.scale, height: size.height / camera.scale * geometry.scale };
}

export function cameraAtMinimapPoint(geometry: MinimapGeometry, point: Point, camera: Camera, size: Size): Camera {
  const center = geometry.world(point);
  return { ...camera, x: size.width / 2 - center.x * camera.scale, y: size.height / 2 - center.y * camera.scale };
}

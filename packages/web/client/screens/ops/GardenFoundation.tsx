import { useId, useMemo } from "react";
import type { MapProjection } from "./shared-floor-camera.ts";
import { GARDEN_DEPTH, GARDEN_PADDING, gardenRockFaces, type GardenLandscape } from "./garden-geometry.ts";
const stoneUrl = new URL("./assets/world-maps/garden-stone-v3.webp", import.meta.url).href;

/** Stone wraps along the shoreline, so its ledges follow the same perspective
 * as the ground. One shared image supplies every face; no filters or animation. */
export function GardenFoundation({ width, height, projection, landscape }: { width: number; height: number; projection: MapProjection; landscape: GardenLandscape }) {
  const id = useId().replace(/:/g, "");
  const faces = useMemo(() => gardenRockFaces(landscape.contours), [landscape]);
  const left = -Math.sqrt(3) / 2 * (height + GARDEN_PADDING), top = -GARDEN_PADDING;
  const span = Math.sqrt(3) / 2 * (width + height + GARDEN_PADDING * 2), rise = (width + height) / 2 + GARDEN_PADDING + GARDEN_DEPTH + 20;
  const silhouette = useMemo(() => faces.map(f => f.path).join(" "), [faces]);
  const topEdge = useMemo(() => faces.map(f => f.top).join(" "), [faces]);
  if (projection !== "iso" || !faces.length) return null;
  return <div className="shared-floor__foundation" aria-hidden="true">
    <svg width={span} height={rise - top} viewBox={`${left} ${top} ${span} ${rise - top}`} style={{ left, top }}>
      <defs>
        <image id={`${id}-stone`} href={stoneUrl} width="640" height="640" />
        <linearGradient id={`${id}-depth`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={GARDEN_DEPTH}>
          <stop offset="0" stopColor="#17191b" stopOpacity=".28" /><stop offset=".15" stopColor="#17191b" stopOpacity=".02" />
          <stop offset=".64" stopColor="#17191b" stopOpacity=".12" /><stop offset="1" stopColor="#090b0e" stopOpacity=".58" />
        </linearGradient>
        {faces.map((face, index) => <pattern key={index} id={`${id}-face-${index}`} patternUnits="userSpaceOnUse" width="640" height="640" patternTransform={face.materialTransform}>
          <rect width="640" height="640" fill="#8e8b82" />
          <use href={`#${id}-stone`} opacity=".82" />
          <rect width="640" height="640" fill="#101217" opacity={face.shade} />
          <rect width="640" height="640" fill={`url(#${id}-depth)`} />
        </pattern>)}
      </defs>
      <path d={silhouette} fill="#575956" />
      {faces.map((face, index) => <path key={index} d={face.path} fill={`url(#${id}-face-${index})`} />)}
      <path d={topEdge} fill="none" stroke="#33372c" strokeOpacity=".5" strokeWidth="7" />
    </svg>
  </div>;
}

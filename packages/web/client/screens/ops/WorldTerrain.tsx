import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { unprojectFloorPoint, type MapProjection } from "./shared-floor-camera.ts";
import { buildTerrainPlan, TERRAIN_CHUNK, TERRAIN_TILE, terrainChunk, type TerrainBiome, type TerrainPlan, type TerrainWorkspace } from "./world-terrain.ts";
import { GardenFoundation } from "./GardenFoundation.tsx";
import { GARDEN_PADDING, gardenContourPath, gardenEdgePlants, gardenPondPath, type GardenLandscape } from "./garden-geometry.ts";

/* Approved direction: a sculpted meadow island with a quiet ivory gathering
 * terrace, curved teal inlets, painted shoreline plants and a stratified rock
 * foundation. Real workspace geometry and crew remain the source of truth.
 * Materials are world-anchored; chrome and the surrounding sky are neutral black. */
const textureUrls = [
  new URL("./assets/world-maps/garden-meadow-v3.webp", import.meta.url).href,
  new URL("./assets/world-maps/garden-limestone-v2.webp", import.meta.url).href,
  new URL("./assets/world-maps/garden-water-v2.webp", import.meta.url).href,
  new URL("./assets/world-maps/garden-meadow.webp", import.meta.url).href,
];
const gardenUrl = new URL("./assets/world-maps/garden-grove.webp", import.meta.url).href;
const plantingUrl = new URL("./assets/world-maps/garden-planted-lip.webp", import.meta.url).href;
const bankUrl = new URL("./assets/world-maps/garden-bank.webp", import.meta.url).href;
type Deck = { x: number; y: number; width: number; height: number };
type RoomPath = { from: { x: number; y: number }; to: { x: number; y: number } };
type LandscapeShapes = { rim: Path2D; ponds: Path2D[]; routes: Path2D[]; roomRoutes: Path2D[]; rimChunks: Set<string> };
type TexturePyramid = readonly (HTMLImageElement | HTMLCanvasElement)[];
function texturePyramid(image: HTMLImageElement): TexturePyramid {
  const levels: (HTMLImageElement | HTMLCanvasElement)[] = [image];
  while (levels.at(-1)!.width > 128) {
    const previous = levels.at(-1)!;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(previous.width / 2); canvas.height = Math.floor(previous.height / 2);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(previous, 0, 0, canvas.width, canvas.height);
    levels.push(canvas);
  }
  return levels;
}
function materialPattern(ctx: CanvasRenderingContext2D, levels: TexturePyramid | undefined, span: number, density: number, rotate = 0) {
  if (!levels) return null;
  let source = levels[0]!;
  for (const level of levels.slice(1)) { if (level.width < span * density * 1.2) break; source = level; }
  const pattern = ctx.createPattern(source, "repeat");
  pattern?.setTransform(new DOMMatrix().rotate(rotate).scale(span / source.width));
  return pattern;
}
let texturesPromise: Promise<TexturePyramid[]> | undefined;
function loadTextures() {
  return texturesPromise ??= Promise.all(textureUrls.map(src => new Promise<TexturePyramid>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(texturePyramid(image)); image.onerror = reject; image.src = src;
  }))).catch(error => { texturesPromise = undefined; throw error; });
}

const GroundChunk = memo(function GroundChunk({ cx, cy, plan, decks, landscape, shapes, images, density, grid, width: worldWidth, height: worldHeight }: { cx: number; cy: number; plan: TerrainPlan; decks: readonly Deck[]; landscape: GardenLandscape; shapes: LandscapeShapes; images: TexturePyramid[]; density: number; grid: boolean; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const span = TERRAIN_CHUNK * TERRAIN_TILE;
  const pixels = Math.ceil(span * density);
  // Resizing a canvas clears it. Paint before the browser presents that frame,
  // including density changes while zooming, so the ground never flashes blank.
  useLayoutEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext("2d"); if (!canvas || !ctx) return;
    const x = cx * span, y = cy * span, resolution = pixels / span;
    ctx.setTransform(resolution, 0, 0, resolution, -x * resolution, -y * resolution);
    ctx.clearRect(x, y, span, span);
    const rim = shapes.rim;
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const patterns = [1180, 480, 680].map((period, index) => materialPattern(ctx, images[index], period, density));
    ctx.fillStyle = patterns[0] ?? "#7d8b52";
    ctx.fillRect(x, y, span, span);
    // Incommensurate, rotated material passes hide the square repeat. Both
    // sample the same world origin, including when a chunk enters the camera.
    const meadowVariation = materialPattern(ctx, images[0], 1180 * 1.37, density, 90);
    if (meadowVariation) { ctx.globalAlpha = .27; ctx.fillStyle = meadowVariation; ctx.fillRect(x, y, span, span); ctx.globalAlpha = 1; }
    const meadowDetail = materialPattern(ctx, images[3], 920, density, -17);
    if (meadowDetail) { ctx.globalAlpha = .22; ctx.fillStyle = meadowDetail; ctx.fillRect(x, y, span, span); ctx.globalAlpha = 1; }
    const light = ctx.createLinearGradient(-GARDEN_PADDING, -GARDEN_PADDING, worldWidth + GARDEN_PADDING, worldHeight + GARDEN_PADDING);
    light.addColorStop(0, "#eee9bc0d"); light.addColorStop(.48, "#00000000"); light.addColorStop(1, "#273c3022");
    ctx.fillStyle = light; ctx.fillRect(x, y, span, span);
    ctx.lineJoin = "round";
    for (const [index, pond] of landscape.ponds.entries()) {
      if (pond.x + pond.width + 30 < x || pond.x - 30 > x + span || pond.y + pond.height + 30 < y || pond.y - 30 > y + span) continue;
      const shape = shapes.ponds[index]!;
      // Each chunk paints the complete contour, then its canvas crops it.
      // No strokes on internal cell edges, including at chunk boundaries.
      ctx.save(); ctx.shadowColor = "#354b3c55"; ctx.shadowBlur = 13 * resolution;
      ctx.strokeStyle = "#809166"; ctx.lineWidth = 29; ctx.stroke(shape); ctx.restore();
      ctx.strokeStyle = "#c8bd93"; ctx.lineWidth = 18; ctx.stroke(shape);
      ctx.strokeStyle = "#e0d5b3"; ctx.lineWidth = 9; ctx.stroke(shape);
      const deep = ctx.createRadialGradient(pond.x + pond.width * .52, pond.y + pond.height * .48, 0, pond.x + pond.width * .5, pond.y + pond.height * .5, pond.width * .58);
      deep.addColorStop(0, "#5598a8"); deep.addColorStop(.56, "#80b7bd"); deep.addColorStop(1, "#b6d7ca");
      ctx.fillStyle = deep; ctx.fill(shape);
      if (patterns[2]) { ctx.globalAlpha = .5; ctx.fillStyle = patterns[2]; ctx.fill(shape); ctx.globalAlpha = 1; }
      ctx.save(); ctx.clip(shape);
      ctx.strokeStyle = "#cde3d56b"; ctx.lineWidth = 32; ctx.shadowColor = "#c7e1d866"; ctx.shadowBlur = 16 * resolution; ctx.stroke(shape);
      ctx.restore();
    }
    // Curved gravel ribbons connect terrace centers; raised paving covers
    // their ends and any pool intersection, keeping the real deck dry.
    ctx.lineCap = "round";
    for (const [index] of landscape.routes.entries()) {
      const path = shapes.routes[index]!;
      ctx.strokeStyle = "#64704766"; ctx.lineWidth = 84; ctx.stroke(path);
      ctx.strokeStyle = patterns[1] ?? "#c8b99a"; ctx.lineWidth = 68; ctx.stroke(path);
      ctx.strokeStyle = "#9c89613d"; ctx.lineWidth = 62; ctx.stroke(path);
    }
    for (const path of shapes.roomRoutes) {
      ctx.strokeStyle = "#68734c66"; ctx.lineWidth = 43; ctx.stroke(path);
      ctx.strokeStyle = patterns[1] ?? "#c8b99a"; ctx.lineWidth = 34; ctx.stroke(path);
    }
    for (const deck of decks) {
      const { x: left, y: top, width, height } = deck;
      if (left + width + 16 < x || left - 16 > x + span || top + height + 16 < y || top - 16 > y + span) continue;
      const shape = new Path2D(); shape.roundRect(left, top, width, height, 38);
      ctx.save(); ctx.shadowColor = "#35452f55"; ctx.shadowBlur = 14 * resolution;
      ctx.strokeStyle = "#7c885d"; ctx.lineWidth = 24; ctx.stroke(shape); ctx.restore();
      ctx.strokeStyle = "#b4a78a"; ctx.lineWidth = 12; ctx.stroke(shape);
      ctx.fillStyle = patterns[1] ?? "#e2d6bf"; ctx.fill(shape);
      ctx.save(); ctx.clip(shape);
      ctx.fillStyle = "#8974481a"; ctx.fillRect(left, top, width, height);
      ctx.strokeStyle = "#a799731f"; ctx.lineWidth = 1;
      for (let px = Math.floor(left / 72) * 72; px <= left + width; px += 72) { ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, top + height); ctx.stroke(); }
      for (let py = Math.floor(top / 72) * 72; py <= top + height; py += 72) { ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(left + width, py); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = "#eee1ba9c"; ctx.lineWidth = 2; ctx.stroke(shape);
    }
    // Only shoreline chunks paint the lip. A broad grass pass makes its
    // texture continuous; the upright plant accents break the silhouette.
    if (shapes.rimChunks.has(`${cx},${cy}`)) {
      ctx.strokeStyle = "#34452f59"; ctx.lineWidth = 60; ctx.stroke(rim);
      const planted = materialPattern(ctx, images[3], 920, density, -17);
      if (planted) { ctx.globalAlpha = .6; ctx.strokeStyle = planted; ctx.lineWidth = 85; ctx.stroke(rim); ctx.globalAlpha = 1; }
      ctx.strokeStyle = "#7f89525c"; ctx.lineWidth = 5; ctx.stroke(rim);
    }
    if (grid) { ctx.strokeStyle = "#183a4270"; ctx.lineWidth = 1; for (const tile of terrainChunk(plan, cx, cy)) ctx.strokeRect(tile.x * TERRAIN_TILE, tile.y * TERRAIN_TILE, TERRAIN_TILE, TERRAIN_TILE); }
    ctx.restore();
  }, [cx, cy, span, pixels, plan, decks, landscape, shapes, images, grid, density, worldWidth, worldHeight]);
  return <canvas ref={ref} aria-hidden="true" width={pixels} height={pixels} style={{ position: "absolute", left: cx * span + GARDEN_PADDING, top: cy * span + GARDEN_PADDING, width: span, height: span }} />;
});

export function WorldTerrain({ groups, decks: inputDecks, roomPaths, biome, width, height, viewport, pan, scale, projection, grid, landscape, center }: {
  groups: readonly TerrainWorkspace[]; decks: readonly Deck[]; roomPaths: readonly RoomPath[]; biome: TerrainBiome; width: number; height: number;
  viewport: { width: number; height: number }; pan: { x: number; y: number }; scale: number; projection: MapProjection; grid: boolean; landscape: GardenLandscape; center: { x: number; y: number };
}) {
  const [images, setImages] = useState<TexturePyramid[]>([]);
  useEffect(() => { let active = true; loadTextures().then(value => { if (active) setImages(value); }).catch(() => { /* Authored material colors remain a usable fallback. */ }); return () => { active = false; }; }, []);
  const geometryKey = groups.map(g => `${g.key}:${g.x},${g.y},${g.width},${g.height}`).join("|");
  const plan = useMemo(() => buildTerrainPlan(groups, biome), [geometryKey, biome]);
  const deckKey = JSON.stringify(inputDecks), roomPathKey = JSON.stringify(roomPaths);
  const decks = useMemo(() => inputDecks, [deckKey]);
  const shapes = useMemo<LandscapeShapes>(() => {
    const span = TERRAIN_CHUNK * TERRAIN_TILE, rimChunks = new Set<string>();
    for (const p of landscape.contours.flat()) for (const dx of [-85, 0, 85]) for (const dy of [-85, 0, 85]) rimChunks.add(`${Math.floor((p.x + dx) / span)},${Math.floor((p.y + dy) / span)}`);
    return { rim: new Path2D(landscape.path), ponds: landscape.ponds.map(p => new Path2D(gardenPondPath(p))), routes: landscape.routes.map(r => new Path2D(r.path)), roomRoutes: roomPaths.map(({ from, to }) => new Path2D(`M ${from.x} ${from.y} Q ${from.x} ${to.y} ${to.x} ${to.y}`)), rimChunks };
  }, [landscape, roomPathKey]);
  const shoreline = useMemo(() => gardenEdgePlants(landscape), [landscape]);
  const clip = useMemo(() => gardenContourPath(landscape.contours.map(ring => ring.map(p => ({ x: p.x + GARDEN_PADDING, y: p.y + GARDEN_PADDING })))), [landscape]);
  const corners = [-1, 1].flatMap(x => [-1, 1].map(y => {
    const point = unprojectFloorPoint((x * viewport.width / 2 - pan.x) / scale, (y * viewport.height / 2 - pan.y) / scale, projection);
    return { x: point.x + center.x, y: point.y + center.y };
  }));
  const padding = GARDEN_PADDING, span = TERRAIN_TILE * TERRAIN_CHUNK;
  const left = Math.max(-padding, Math.min(...corners.map(p => p.x)) - TERRAIN_TILE);
  const right = Math.min(width + padding, Math.max(...corners.map(p => p.x)) + TERRAIN_TILE);
  const top = Math.max(-padding, Math.min(...corners.map(p => p.y)) - TERRAIN_TILE);
  const bottom = Math.min(height + padding, Math.max(...corners.map(p => p.y)) + TERRAIN_TILE);
  const density = Math.min(2, Math.max(.125, 2 ** Math.ceil(Math.log2(scale * Math.min(window.devicePixelRatio || 1, 2)))));
  const chunks = [];
  for (let y = Math.floor(top / span); y <= Math.floor(bottom / span); y++)
    for (let x = Math.floor(left / span); x <= Math.floor(right / span); x++) chunks.push(<GroundChunk key={`${x},${y}`} cx={x} cy={y} plan={plan} decks={decks} landscape={landscape} shapes={shapes} images={images} density={density} grid={grid} width={width} height={height} />);
  const banks = landscape.ponds.flatMap(pond => [[.08, .4], [.16, .79], [.44, .91], [.81, .99], [.98, .6], [.95, .12]].map(([x, y], index) => ({ key: `${pond.key}:${index}`, x: pond.x + x! * pond.width, y: pond.y + y! * pond.height, width: index % 2 ? 165 : 205 })));
  return <>
    <GardenFoundation width={width} height={height} projection={projection} landscape={landscape} />
    <div className="shared-floor__terrain" aria-hidden="true" data-biome={biome} style={{ left: -padding, top: -padding, width: width + padding * 2, height: height + padding * 2, clipPath: `path(evenodd, "${clip}")`, background: "#7d8b52" }}>{chunks}</div>
    {/* Billboards are outside the clipped ground, anchored by their feet. */}
    {landscape.groves.filter(garden => garden.x >= left - garden.width * 1.5 && garden.x <= right + garden.width * 1.5 && garden.y >= top - garden.width * 1.5 && garden.y <= bottom + garden.width * 1.5).map(garden => <span className="shared-floor__terrain-garden" key={garden.key} style={{ left: garden.x, top: garden.y }}><img src={gardenUrl} alt="" draggable={false} style={{ width: garden.width }} /></span>)}
    {scale >= .085 ? shoreline.filter(plant => plant.x >= left - 160 && plant.x <= right + 160 && plant.y >= top - 160 && plant.y <= bottom + 160 && !plan.terraces.some(r => plant.x >= r.left * TERRAIN_TILE - 65 && plant.x <= (r.right + 1) * TERRAIN_TILE + 65 && plant.y >= r.top * TERRAIN_TILE - 65 && plant.y <= (r.bottom + 1) * TERRAIN_TILE + 65)).map(plant => <span className="shared-floor__terrain-planting" aria-hidden="true" key={plant.key} style={{ left: plant.x, top: plant.y }}><img src={plantingUrl} alt="" draggable={false} style={{ width: plant.width, transform: `translate(-50%, -70%)${plant.mirror ? " scaleX(-1)" : ""}` }} /></span>) : null}
    {banks.filter(bank => bank.x >= left - bank.width && bank.x <= right + bank.width && bank.y >= top - bank.width && bank.y <= bottom + bank.width && !plan.terraces.some(r => bank.x >= r.left * TERRAIN_TILE - 40 && bank.x <= (r.right + 1) * TERRAIN_TILE + 40 && bank.y >= r.top * TERRAIN_TILE - 40 && bank.y <= (r.bottom + 1) * TERRAIN_TILE + 40)).sort((a, b) => a.x + a.y - b.x - b.y).map(bank => <span className="shared-floor__terrain-bank" aria-hidden="true" key={bank.key} style={{ left: bank.x, top: bank.y }}><img src={bankUrl} alt="" draggable={false} style={{ width: bank.width }} /></span>)}
  </>;
}
